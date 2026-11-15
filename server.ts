import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { compile as compileTailwind } from 'tailwindcss';
import dotenv from 'dotenv';
import type { AiProviderConfig, AiProviderId, ProjectFile } from './src/types/mist';
import { normalizeProviderConfigToStudio, shouldEnableAppAi } from './src/data/models';
import { classifyModelError, redactSecrets, type ModelHealthIncident } from './src/utils/aiErrors';
import { normalizeProjectFilePath, resolveAppEntryPath } from './src/utils/projectOps';
import {
  assertSafeExternalUrl,
  createPreviewAiSession,
  createRateLimiter,
  resolvePreviewAiSession,
  revokePreviewAiSession,
  sanitizeErrorMessage,
  SecurityValidationError,
  verifyFirebaseAuthHeader,
} from './src/utils/serverSecurity';
import { fetchGatewayModelsCatalog } from './src/utils/modelCatalogServer';

dotenv.config();

const require = createRequire(import.meta.url);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DEPLOYMENTS_FILE = path.resolve(process.cwd(), '.mist-deployments.json');

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '6mb' }));
app.use('/src/assets', express.static(path.resolve(process.cwd(), 'src/assets')));

const aiRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, label: 'AI' });
const catalogRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120, label: 'model catalog' });
const deployRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30, label: 'deployment' });

// Track observed model rate-limit & server-outage incidents
const recentModelIncidents = new Map<string, ModelHealthIncident>();

function recordIncident(incident: ModelHealthIncident) {
  if (incident.code === 'RATE_LIMIT' || incident.code === 'SERVER_OUTAGE') {
    recentModelIncidents.set(`${incident.provider}:${incident.model}`, incident);
  }
}

function clearIncident(provider: AiProviderId, model: string) {
  recentModelIncidents.delete(`${provider}:${model}`);
}

// --- 1. Vendor Runtime Cache for Preview & Deployed Sites ---
let cachedVendorBundle: string | null = null;
let reactExportNames: string[] = [];
let lucideExportNames: string[] = [];

async function ensureVendorRuntime(): Promise<string> {
  if (cachedVendorBundle) return cachedVendorBundle;

  const reactMod = require('react');
  const lucideMod = require('lucide-react');

  reactExportNames = Object.keys(reactMod).filter(
    (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && k !== 'default' && k !== '__esModule',
  );
  lucideExportNames = Object.keys(lucideMod).filter(
    (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && k !== 'default' && k !== '__esModule',
  );

  const entrySource = `
    import * as React from 'react';
    import * as ReactDOMClient from 'react-dom/client';
    import * as jsxRuntime from 'react/jsx-runtime';
    import * as LucideReact from 'lucide-react';
    window.__MIST_VENDOR__ = { React, ReactDOMClient, jsxRuntime, LucideReact };
  `;

  const result = await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  cachedVendorBundle = result.outputFiles[0].text;
  return cachedVendorBundle;
}

app.get('/vendor/preview-runtime.js', async (_req, res) => {
  try {
    const bundle = await ensureVendorRuntime();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(bundle);
  } catch (err) {
    res.status(500).send(`console.error("Failed to build vendor runtime: ${String(err)}");`);
  }
});

// --- 2. Tailwind v4 Compiler Cache ---
let cachedTailwindCompiler: Awaited<ReturnType<typeof compileTailwind>> | null = null;

async function getTailwindCompiler() {
  if (cachedTailwindCompiler) return cachedTailwindCompiler;
  const twDir = path.resolve(process.cwd(), 'node_modules/tailwindcss');
  const baseCss = fs.readFileSync(path.join(twDir, 'index.css'), 'utf8');
  cachedTailwindCompiler = await compileTailwind(baseCss, {
    loadStylesheet: async (id, base) => {
      const candidate = path.resolve(twDir, id);
      if (fs.existsSync(candidate)) {
        return { path: candidate, base, content: fs.readFileSync(candidate, 'utf8') };
      }
      return { path: id, base, content: '' };
    },
  });
  return cachedTailwindCompiler;
}

function extractTailwindCandidates(files: ProjectFile[]): string[] {
  const tokens = new Set<string>();
  const regex = /[A-Za-z0-9_:\-/\[\]\.#%]+/g;
  for (const file of files) {
    if (file.language === 'tsx' || file.language === 'ts' || file.language === 'html') {
      const matches = file.content.match(regex);
      if (matches) {
        for (const m of matches) {
          if (m.length > 1 && m.length < 80) {
            tokens.add(m);
          }
        }
      }
    }
  }
  return Array.from(tokens);
}

// --- 3. Multi-File React + TSX + Three.js Bundler ---
const INSPECTOR_BRIDGE_SCRIPT = `
(function() {
  var inspectorActive = false;
  var selectedMistId = null;
  var hoverOverlay = null;
  var selectOverlay = null;
  var tagBadge = null;

  function ensureOverlays() {
    if (!hoverOverlay) {
      hoverOverlay = document.createElement('div');
      hoverOverlay.setAttribute('data-mist-ui', 'true');
      hoverOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:1.5px dashed #2563eb;background:rgba(37,99,235,0.06);border-radius:3px;display:none;transition:all 60ms ease;';
      tagBadge = document.createElement('span');
      tagBadge.style.cssText = 'position:absolute;top:-20px;left:-1px;background:#2563eb;color:#fff;font:600 10px/16px ui-monospace,monospace;padding:0 5px;border-radius:2px;white-space:nowrap;';
      hoverOverlay.appendChild(tagBadge);
      document.body.appendChild(hoverOverlay);
    }
    if (!selectOverlay) {
      selectOverlay = document.createElement('div');
      selectOverlay.setAttribute('data-mist-ui', 'true');
      selectOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #2563eb;background:rgba(37,99,235,0.04);border-radius:3px;display:none;';
      document.body.appendChild(selectOverlay);
    }
  }

  function assignIds() {
    var root = document.getElementById('root');
    if (!root) return;
    var els = root.querySelectorAll('*');
    var idx = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.getAttribute('data-mist-id')) {
        el.setAttribute('data-mist-id', 'el-' + (idx++));
      } else {
        idx++;
      }
    }
  }

  function cssColorToHex(cssColor) {
    if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return '';
    if (/^#[0-9a-fA-F]{6}$/.test(cssColor)) return cssColor.toLowerCase();
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      var ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = cssColor;
        ctx.fillRect(0, 0, 1, 1);
        var d = ctx.getImageData(0, 0, 1, 1).data;
        if (d[3] === 0) return '';
        return '#' + [d[0], d[1], d[2]].map(function(x) {
          return x.toString(16).padStart(2, '0');
        }).join('');
      }
    } catch (err) {}
    return '';
  }

  function positionBox(box, el) {
    if (!box || !el) return;
    var r = el.getBoundingClientRect();
    box.style.top = r.top + 'px';
    box.style.left = r.left + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.style.display = 'block';
  }

  function sendSelection(el) {
    var cs = window.getComputedStyle(el);
    var canEditText = el.children.length === 0;
    var mistId = el.getAttribute('data-mist-id') || '';
    selectedMistId = mistId;
    ensureOverlays();
    positionBox(selectOverlay, el);
    window.parent.postMessage({
      type: 'MIST_SELECT_ELEMENT',
      payload: {
        mistId: mistId,
        tagName: el.tagName.toLowerCase(),
        textContent: canEditText ? (el.textContent || '').trim() : '',
        className: typeof el.className === 'string' ? el.className : '',
        canEditText: canEditText,
        styles: {
          color: cssColorToHex(cs.color) || '#09090b',
          backgroundColor: cssColorToHex(cs.backgroundColor) || '',
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          borderRadius: cs.borderRadius,
          textAlign: cs.textAlign
        }
      }
    }, '*');
  }

  document.addEventListener('mouseover', function(e) {
    if (!inspectorActive) return;
    var target = e.target;
    if (!target || !(target instanceof Element)) return;
    if (target.closest('[data-mist-ui="true"]') || !document.getElementById('root')?.contains(target)) return;
    ensureOverlays();
    tagBadge.textContent = target.tagName.toLowerCase();
    positionBox(hoverOverlay, target);
  }, true);

  document.addEventListener('click', function(e) {
    if (!inspectorActive) return;
    var target = e.target;
    if (!target || !(target instanceof Element)) return;
    if (target.closest('[data-mist-ui="true"]') || !document.getElementById('root')?.contains(target)) return;
    e.preventDefault();
    e.stopPropagation();
    assignIds();
    sendSelection(target);
  }, true);

  window.addEventListener('scroll', function() {
    if (selectedMistId && selectOverlay) {
      var el = document.querySelector('[data-mist-id="' + selectedMistId + '"]');
      if (el) positionBox(selectOverlay, el);
    }
  }, true);

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'MIST_TOGGLE_INSPECTOR') {
      inspectorActive = Boolean(e.data.enabled);
      document.body.style.cursor = inspectorActive ? 'crosshair' : '';
      if (!inspectorActive) {
        if (hoverOverlay) hoverOverlay.style.display = 'none';
        if (selectOverlay) selectOverlay.style.display = 'none';
      } else {
        assignIds();
      }
    } else if (e.data.type === 'MIST_LIVE_PATCH') {
      var patch = e.data.payload || {};
      var target = document.querySelector('[data-mist-id="' + patch.mistId + '"]');
      if (!target) return;
      if (patch.deleted) {
        target.style.display = 'none';
        if (selectOverlay) selectOverlay.style.display = 'none';
        return;
      }
      if (typeof patch.newText === 'string' && target.children.length === 0) {
        target.textContent = patch.newText;
      }
      if (patch.styles) {
        Object.keys(patch.styles).forEach(function(k) {
          if (patch.styles[k] !== undefined && patch.styles[k] !== '') {
            target.style[k] = patch.styles[k];
          }
        });
      }
      if (selectOverlay && inspectorActive) positionBox(selectOverlay, target);
    }
  });

  window.addEventListener('DOMContentLoaded', function() {
    assignIds();
    var root = document.getElementById('root');
    if (root && typeof MutationObserver !== 'undefined') {
      new MutationObserver(assignIds).observe(root, { childList: true, subtree: true });
    }
  });
})();
`;

function collectImportedLucideSymbols(files: ProjectFile[]): string[] {
  const extra = new Set<string>();
  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  for (const f of files) {
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(f.content)) !== null) {
      const parts = match[1].split(',');
      for (const part of parts) {
        const cleaned = part.trim().split(/\s+as\s+/)[0].trim();
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cleaned)) {
          extra.add(cleaned);
        }
      }
    }
  }
  return Array.from(extra);
}

function resolveThreeModulePath(specifier: string): string | null {
  const threeDir = path.resolve(process.cwd(), 'node_modules/three');
  if (specifier === 'three') {
    return path.join(threeDir, 'build/three.module.js');
  }
  if (specifier === 'three/addons') {
    return path.join(threeDir, 'examples/jsm/Addons.js');
  }
  if (specifier.startsWith('three/addons/')) {
    const rel = specifier.slice('three/addons/'.length);
    const candidate = path.join(threeDir, 'examples/jsm', rel);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(`${candidate}.js`)) return `${candidate}.js`;
  }
  if (specifier.startsWith('three/examples/jsm/')) {
    const rel = specifier.slice('three/examples/jsm/'.length);
    const candidate = path.join(threeDir, 'examples/jsm', rel);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(`${candidate}.js`)) return `${candidate}.js`;
  }
  if (specifier.startsWith('three/')) {
    const rel = specifier.slice('three/'.length);
    const candidate = path.join(threeDir, rel);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(`${candidate}.js`)) return `${candidate}.js`;
  }
  return null;
}

async function bundleProjectToHtml(params: {
  files: ProjectFile[];
  title: string;
  includeInspector?: boolean;
  enableAppAi?: boolean;
}): Promise<{ html: string; bundleError?: string }> {
  await ensureVendorRuntime();

  const fileMap = new Map<string, ProjectFile>();
  const lowerFileMap = new Map<string, string>();
  const normalizedFiles: ProjectFile[] = params.files.map((f) => {
    const cleanPath = normalizeProjectFilePath(f.path);
    return { ...f, path: cleanPath };
  });

  for (const f of normalizedFiles) {
    fileMap.set(f.path, f);
    lowerFileMap.set(f.path.toLowerCase(), f.path);
  }

  const importedLucideSymbols = collectImportedLucideSymbols(normalizedFiles);
  const allLucideExports = Array.from(new Set([...lucideExportNames, ...importedLucideSymbols]));

  const appEntry = resolveAppEntryPath(normalizedFiles);
  const entryPath = fileMap.has('src/main.tsx') ? 'src/main.tsx' : '__mist_entry.tsx';

  const syntheticEntry = appEntry
    ? `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import * as AppModule from './${appEntry}';

    const ResolvedApp =
      AppModule.default ||
      AppModule.App ||
      Object.values(AppModule).find((val) => typeof val === 'function') ||
      (() => React.createElement('div', { className: 'p-8 text-center font-sans text-zinc-700' }, 'Export a React component from ${appEntry} to render this website.'));

    class MistErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        if (this.state.error) {
          return React.createElement(
            'div',
            { className: 'p-6 m-4 rounded-xl border border-red-200 bg-red-50 text-red-900 font-sans text-sm' },
            React.createElement('strong', null, 'Preview Render Error'),
            React.createElement('pre', { className: 'mt-2 text-xs font-mono whitespace-pre-wrap' }, String(this.state.error?.message || this.state.error))
          );
        }
        return this.props.children;
      }
    }

    const rootEl = document.getElementById('root');
    if (rootEl) {
      createRoot(rootEl).render(
        React.createElement(MistErrorBoundary, null, React.createElement(ResolvedApp))
      );
    }
  `
    : `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    const rootEl = document.getElementById('root');
    if (rootEl) {
      createRoot(rootEl).render(
        React.createElement('div', { className: 'p-12 text-center font-sans text-zinc-600' }, 'Add src/App.tsx to render your website.')
      );
    }
  `;

  const virtualPlugin: esbuild.Plugin = {
    name: 'mist-virtual-fs',
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'mist-vendor' }));
      build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
        path: 'react-dom/client',
        namespace: 'mist-vendor',
      }));
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: 'react/jsx-runtime',
        namespace: 'mist-vendor',
      }));
      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        path: 'react/jsx-runtime',
        namespace: 'mist-vendor',
      }));
      build.onResolve({ filter: /^lucide-react$/ }, () => ({
        path: 'lucide-react',
        namespace: 'mist-vendor',
      }));

      // Three.js & addons resolution from node_modules
      build.onResolve({ filter: /^three(\/.*)?$/ }, (args) => {
        const resolved = resolveThreeModulePath(args.path);
        if (resolved) {
          return { path: resolved, namespace: 'file' };
        }
        return undefined;
      });

      build.onResolve({ filter: /.*/ }, (args) => {
        // Real node_modules imports (e.g., Three.js internal relative imports) use default file resolver
        if (args.resolveDir && args.importer && !fileMap.has(args.importer) && args.importer !== entryPath) {
          return undefined;
        }
        if (args.path === entryPath) {
          return { path: entryPath, namespace: 'mist-fs' };
        }
        if (args.path.endsWith('.css')) {
          return { path: args.path, namespace: 'mist-css-noop' };
        }
        const importerDir =
          args.importer && args.importer !== entryPath
            ? path.posix.dirname(args.importer)
            : '';
        const baseResolved = args.path.startsWith('.')
          ? path.posix.normalize(path.posix.join(importerDir, args.path))
          : args.path.replace(/^(@\/|\/)/, '');

        const rawCandidates = [
          baseResolved,
          `${baseResolved}.tsx`,
          `${baseResolved}.ts`,
          `${baseResolved}.jsx`,
          `${baseResolved}.js`,
          `${baseResolved}/index.tsx`,
          `${baseResolved}/index.ts`,
        ];
        if (!baseResolved.startsWith('src/')) {
          rawCandidates.push(
            `src/${baseResolved}`,
            `src/${baseResolved}.tsx`,
            `src/${baseResolved}.ts`,
            `src/${baseResolved}.jsx`,
            `src/${baseResolved}.js`,
            `src/${baseResolved}/index.tsx`,
          );
        }
        for (const c of rawCandidates) {
          if (fileMap.has(c)) {
            return { path: c, namespace: 'mist-fs' };
          }
          const matched = lowerFileMap.get(c.toLowerCase());
          if (matched) {
            return { path: matched, namespace: 'mist-fs' };
          }
        }
        return { path: args.path, namespace: 'mist-missing' };
      });

      build.onLoad({ filter: /.*/, namespace: 'mist-vendor' }, (args) => {
        if (args.path === 'react') {
          const named = reactExportNames
            .map((k) => `export const ${k} = window.__MIST_VENDOR__.React["${k}"];`)
            .join('\n');
          return {
            contents: `const React = window.__MIST_VENDOR__.React;\nexport default React;\n${named}`,
            loader: 'js',
          };
        }
        if (args.path === 'react-dom/client') {
          return {
            contents: `const RDC = window.__MIST_VENDOR__.ReactDOMClient;\nexport default RDC;\nexport const createRoot = RDC.createRoot;\nexport const hydrateRoot = RDC.hydrateRoot;`,
            loader: 'js',
          };
        }
        if (args.path === 'react/jsx-runtime') {
          return {
            contents: `const J = window.__MIST_VENDOR__.jsxRuntime;\nexport const jsx = J.jsx;\nexport const jsxs = J.jsxs;\nexport const Fragment = J.Fragment;`,
            loader: 'js',
          };
        }
        if (args.path === 'lucide-react') {
          const lucideHeader = `
            const React = window.__MIST_VENDOR__.React;
            const LR = window.__MIST_VENDOR__.LucideReact;
            function FallbackIcon(props) {
              return React.createElement('svg', {
                viewBox: '0 0 24 24',
                width: props?.size || 16,
                height: props?.size || 16,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                className: props?.className || '',
                'aria-hidden': 'true'
              }, React.createElement('circle', { cx: 12, cy: 12, r: 9 }));
            }
          `;
          const icons = allLucideExports
            .map((k) => `export const ${k} = LR["${k}"] || FallbackIcon;`)
            .join('\n');
          return { contents: `${lucideHeader}\n${icons}`, loader: 'js' };
        }
        return { contents: '', loader: 'js' };
      });

      build.onLoad({ filter: /.*/, namespace: 'mist-css-noop' }, () => ({
        contents: '',
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: 'mist-missing' }, (args) => ({
        contents: `export default function MissingModule() { return null; } /* Missing: ${args.path} */`,
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: 'mist-fs' }, (args) => {
        if (args.path === '__mist_entry.tsx') {
          return { contents: syntheticEntry, loader: 'tsx', resolveDir: process.cwd() };
        }
        const file = fileMap.get(args.path);
        if (!file) return { contents: '', loader: 'tsx', resolveDir: process.cwd() };
        const loader = file.path.endsWith('.ts')
          ? 'ts'
          : file.path.endsWith('.json')
            ? 'json'
            : 'tsx';
        return { contents: file.content, loader, resolveDir: process.cwd() };
      });
    },
  };

  let jsBundle = '';
  let bundleError: string | undefined;

  try {
    const buildResult = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: 'iife',
      jsx: 'automatic',
      plugins: [virtualPlugin],
      logLevel: 'silent',
    });
    jsBundle = buildResult.outputFiles[0]?.text || '';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    bundleError = msg;
    jsBundle = `
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div style="padding:32px;font-family:ui-monospace,monospace;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;margin:24px;border-radius:8px;"><strong>Build Error</strong><pre style="margin-top:12px;white-space:pre-wrap;font-size:12px;">' + ${JSON.stringify(msg)} + '</pre></div>';
      }
    `;
  }

  let compiledTwCss = '';
  try {
    const twCompiler = await getTailwindCompiler();
    const candidates = extractTailwindCandidates(params.files);
    compiledTwCss = twCompiler.build(candidates);
  } catch {
    compiledTwCss = '';
  }

  const customCss = params.files
    .filter((f) => f.language === 'css')
    .map((f) => f.content.replace(/@import\s+["']tailwindcss["'];?/g, ''))
    .join('\n');

  const safeTitle = params.title.replace(/[<>]/g, '');

  const initialAppAiEnabled = Boolean(params.enableAppAi);

  // Scoped session runtime bridge (never receives raw API keys) + srcDoc anchor navigation guard
  const MIST_APP_AI_RUNTIME_SCRIPT = `
(function() {
  var activeSessionToken = null;
  var appAiEnabled = ${initialAppAiEnabled ? 'true' : 'false'};
  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (e && e.data && e.data.type === 'MIST_SET_BYOK_SESSION') {
      var payload = e.data.payload || {};
      activeSessionToken = typeof payload.token === 'string' ? payload.token : null;
      if (typeof payload.appAiEnabled === 'boolean') {
        appAiEnabled = payload.appAiEnabled;
      }
    }
  });

  if (origFetch) {
    window.fetch = function(input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/api/app-ai') !== -1 && init && typeof init.body === 'string' && activeSessionToken) {
          var parsed = JSON.parse(init.body);
          if (!parsed.sessionToken && !parsed.providerConfig) {
            parsed.sessionToken = activeSessionToken;
            init = Object.assign({}, init, { body: JSON.stringify(parsed) });
          }
        }
      } catch (err) {}
      return origFetch(input, init);
    };
  }

  document.addEventListener('click', function(e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!el) return;
    var href = el.getAttribute('href') || '';
    if (el.hasAttribute('download') || el.getAttribute('target') === '_blank') return;
    if (href.startsWith('#')) {
      e.preventDefault();
      var id = href.slice(1);
      if (id) {
        var target = document.getElementById(id);
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    if (href.startsWith('/') && !href.startsWith('/p/')) {
      e.preventDefault();
    }
  }, false);

  window.mistAI = {
    isEnabled: function() { return appAiEnabled; },
    complete: async function(prompt, options) {
      if (!appAiEnabled) {
        throw new Error('Live App AI is disabled for this project unless requested or enabled in Mist.');
      }
      var opts = options || {};
      var res = await window.fetch('/api/app-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          messages: opts.messages,
          systemInstruction: opts.systemInstruction,
          jsonMode: Boolean(opts.jsonMode),
          sessionToken: activeSessionToken || undefined
        })
      });
      var data = await res.json();
      if (!res.ok) {
        throw new Error((data && (data.error || (data.incident && data.incident.message))) || 'AI request failed');
      }
      return data.text;
    },
    chat: async function(messages, systemInstruction) {
      return window.mistAI.complete('', { messages: messages, systemInstruction: systemInstruction });
    }
  };
})();
`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <style>${compiledTwCss}</style>
    <style>${customCss}</style>
    <script src="/vendor/preview-runtime.js"></script>
    <script>${MIST_APP_AI_RUNTIME_SCRIPT}</script>
  </head>
  <body>
    <div id="root"></div>
    <script>${jsBundle}</script>
    ${params.includeInspector ? `<script>${INSPECTOR_BRIDGE_SCRIPT}</script>` : ''}
  </body>
</html>`;

  return { html, bundleError };
}

app.post('/api/bundle', catalogRateLimiter, async (req, res) => {
  try {
    const { files, title, includeInspector, enableAppAi } = req.body as {
      files: ProjectFile[];
      title?: string;
      includeInspector?: boolean;
      enableAppAi?: boolean;
    };
    if (!Array.isArray(files)) {
      res.status(400).json({ error: 'Invalid files payload' });
      return;
    }
    const result = await bundleProjectToHtml({
      files,
      title: title || 'Mist Preview',
      includeInspector: includeInspector !== false,
      enableAppAi: Boolean(enableAppAi),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: sanitizeErrorMessage(err) || 'Bundling failed' });
  }
});

// --- 4. Pure BYOK AI Generation, Streaming Progress, Refinement, Voice Turn & Model Health ---
const SYSTEM_GENERATOR_PROMPT = `You are Mist, a senior product designer, interactive game developer, and React + TypeScript + Tailwind CSS + Three.js engineer.
Generate clean, cohesive, responsive, fully playable/interactive web apps with strong contrast, crisp typography, mobile support, and zero broken links.

CRITICAL RULES:
- Use React 19, TypeScript (.tsx), and Tailwind CSS utility classes.
- Allowed imports: 'react', 'react-dom/client', 'lucide-react', 'three', 'three/addons/*' (e.g., OrbitControls, RoomEnvironment), and local relative imports like './components/Navbar'.
- NEVER use Sparkles, Star, or Wand icons from lucide-react; prefer crisp functional icons (Send, Play, RotateCcw, Cpu, ArrowRight, Terminal, Layers, Check, Pause, Trophy, Volume2).
- NEVER return raw HTML documents ('<!doctype html>', '<script>', or raw HTML strings in JSX) — write pure TypeScript React components with working event handlers.
- NEVER use <a href="/..."> links on interactive buttons (such as "Play Game", "Start", "Restart") — ALWAYS use <button type="button" onClick={...}> so clicks never navigate away from the app.
- Ensure src/App.tsx is the default-exported root component and src/index.css starts with @import "tailwindcss";.
- Never use broken external URLs like unsplash.com or external .hdr/.gltf files; use crisp inline SVG graphics, Canvas2D procedural art, or procedural Three.js geometry and CanvasTexture materials.

2D GAME & CANVAS RULES (apply when building 2D games such as Subway Surfers 2D runners, arcade, platformers, or Canvas apps):
- Mount a real <canvas ref={canvasRef} className="block w-full h-full touch-none" /> ALWAYS at the root of the viewport across all screens ('title', 'playing', 'paused', 'gameover') — NEVER conditionally mount <canvas> inside {screen === 'playing' && <canvas>} where useEffect([], []) misses it!
- Keep high-frequency 60 FPS physics, lanes, player velocity, obstacles, coins, score, and input inside useRef objects driven by requestAnimationFrame(loop) with clamped dt = Math.min(rawDt, 0.05). Sync HUD numbers to React state cleanly.
- Support keyboard controls (ArrowLeft/A, ArrowRight/D to switch lanes; ArrowUp/W/Space to jump; ArrowDown/S to slide/roll; Escape/P to pause) AND pointer/touch swipe or mobile tap controls.
- On clicking "Play Game" (also Space/Enter on Title), immediately switch phaseRef.current = 'playing' and react phase state = 'playing', reset obstacles/score cleanly, and start active gameplay on the running canvas!
- Put HUD overlays in a <div className="pointer-events-none fixed inset-0 ..."> wrapper with pointer-events-auto ONLY on buttons; NEVER put backdrop-blur over the active <canvas>.

THREE.JS & 3D RULES (apply when building 3D scenes, viewers, or 3D games):
- Import * as THREE from 'three' (and optional 'three/addons/controls/OrbitControls.js' or 'three/addons/environments/RoomEnvironment.js').
- Mount renderer.domElement inside a dedicated empty <div ref={mountRef} className="w-full h-full" /> inside useEffect(..., []), handle ResizeObserver/resize, cancel animation frame and call renderer.dispose() on unmount.
- Use THREE.ACESFilmicToneMapping, PMREMGenerator + RoomEnvironment for rich metallic/PBR reflections, and a warm DirectionalLight + cool HemisphereLight fill.
- Build multi-part THREE.Group objects and procedural CanvasTextures (zero external 404 texture URLs), and never place CSS backdrop-blur over the WebGL viewport.

LIVE AI FEATURES INSIDE GENERATED APPS (REQUESTED-ONLY POLICY):
- Do NOT add chatbots, "Ask AI" widgets, or /api/app-ai calls to standard websites, portfolios, stores, 2D Canvas games, or Three.js apps unless specifically requested or enabled in the user instructions.
- ONLY when AI features are explicitly requested or enabled in the prompt, implement real fetch('/api/app-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, messages, systemInstruction }) }) calls returning { text } — with real loading & error states, never setTimeout/mock stubs.`;

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Model response did not contain valid JSON.');
  }
}

class ProviderHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getHttpStatusFromError(err: unknown): number {
  if (err instanceof SecurityValidationError) return err.status;
  if (err instanceof ProviderHttpError) return err.status;
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    return (err as { status: number }).status;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('429') || msg.toLowerCase().includes('resource_exhausted')) return 429;
  if (msg.includes('503') || msg.toLowerCase().includes('unavailable')) return 503;
  if (msg.includes('502')) return 502;
  if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('api_key_invalid')) return 401;
  if (msg.includes('404') || msg.toLowerCase().includes('not_found')) return 404;
  return 500;
}

async function resolveByokRequestParams(rawConfig?: AiProviderConfig): Promise<{
  config: AiProviderConfig;
  providerLabel: string;
  endpoint: string;
  headers: Record<string, string>;
}> {
  const config = normalizeProviderConfigToStudio(
    rawConfig || {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
      apiKey: '',
    },
  );
  const providerLabel = config.name?.trim() || 'Custom BYOK';
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(
      401,
      `Enter your BYOK API key for ${providerLabel} in Models & API Keys or Settings.`,
    );
  }
  const base = (config.baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new ProviderHttpError(
      400,
      `${providerLabel} requires an HTTPS OpenAI-compatible Base URL (e.g. https://openrouter.ai/api/v1).`,
    );
  }

  await assertSafeExternalUrl(base);

  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (endpoint.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
    headers['X-Title'] = 'Mist Website Builder';
  }
  return { config, providerLabel, endpoint, headers };
}

async function callByokCompletionRaw(params: {
  config?: AiProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const { messages, jsonMode = true, temperature = 0.4, maxTokens = 10240 } = params;
  const { config, providerLabel, endpoint, headers } = await resolveByokRequestParams(params.config);

  const runRequest = async (limitTokens: number, useJsonFormat: boolean) => {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature,
      max_tokens: limitTokens,
    };
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let resp = await runRequest(maxTokens, jsonMode);
  if (!resp.ok && resp.status === 400 && jsonMode) {
    // Some custom/OpenAI-compatible models reject response_format json_object
    const errPreview = redactSecrets(await resp.text());
    if (errPreview.toLowerCase().includes('response_format') || errPreview.toLowerCase().includes('json_object')) {
      resp = await runRequest(maxTokens, false);
    } else {
      throw new ProviderHttpError(400, `${providerLabel} error (400): ${errPreview.slice(0, 350)}`);
    }
  }

  if (!resp.ok && resp.status === 402) {
    const errText = redactSecrets(await resp.text());
    const affordMatch = errText.match(/can only afford\s+(\d+)/i);
    const affordable = affordMatch ? Number(affordMatch[1]) : 0;
    if (affordable >= 1024 && maxTokens > affordable - 128) {
      resp = await runRequest(Math.max(1024, affordable - 128), jsonMode);
    } else {
      throw new ProviderHttpError(402, `${providerLabel} error (402): ${errText.slice(0, 350)}`);
    }
  }

  if (!resp.ok) {
    const errText = redactSecrets(await resp.text());
    throw new ProviderHttpError(resp.status, `${providerLabel} error (${resp.status}): ${errText.slice(0, 350)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new ProviderHttpError(502, `${providerLabel} returned an empty response.`);
  }
  return content;
}

async function streamByokCompletion(params: {
  config?: AiProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  onDelta: (accumulatedText: string) => void;
}): Promise<string> {
  const { messages, jsonMode = true, temperature = 0.4, maxTokens = 12288, onDelta } = params;
  const { config, providerLabel, endpoint, headers } = await resolveByokRequestParams(params.config);

  const runStreamRequest = async (limitTokens: number, useJsonFormat: boolean) => {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature,
      max_tokens: limitTokens,
      stream: true,
    };
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' };
    }
    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  };

  let resp = await runStreamRequest(maxTokens, jsonMode);
  if (!resp.ok && resp.status === 400 && jsonMode) {
    const errPreview = redactSecrets(await resp.text());
    if (errPreview.toLowerCase().includes('response_format') || errPreview.toLowerCase().includes('json_object')) {
      resp = await runStreamRequest(maxTokens, false);
    } else {
      throw new ProviderHttpError(400, `${providerLabel} error (400): ${errPreview.slice(0, 350)}`);
    }
  }

  if (!resp.ok && resp.status === 402) {
    const errText = redactSecrets(await resp.text());
    const affordMatch = errText.match(/can only afford\s+(\d+)/i);
    const affordable = affordMatch ? Number(affordMatch[1]) : 0;
    if (affordable >= 1024 && maxTokens > affordable - 128) {
      resp = await runStreamRequest(Math.max(1024, affordable - 128), jsonMode);
    } else {
      throw new ProviderHttpError(402, `${providerLabel} error (402): ${errText.slice(0, 350)}`);
    }
  }

  if (!resp.ok) {
    const errText = redactSecrets(await resp.text());
    throw new ProviderHttpError(resp.status, `${providerLabel} error (${resp.status}): ${errText.slice(0, 350)}`);
  }

  if (!resp.body) {
    const text = await callByokCompletionRaw({ config, messages, jsonMode, temperature, maxTokens });
    onDelta(text);
    return text;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    let nlIndex: number;
    while ((nlIndex = sseBuffer.indexOf('\n')) !== -1) {
      const line = sseBuffer.slice(0, nlIndex).trim();
      sseBuffer = sseBuffer.slice(nlIndex + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          error?: { message?: string };
        };
        if (parsed.error?.message) {
          throw new ProviderHttpError(502, parsed.error.message);
        }
        const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? '';
        if (delta) {
          fullContent += delta;
          onDelta(fullContent);
        }
      } catch (parseErr) {
        if (parseErr instanceof ProviderHttpError) throw parseErr;
      }
    }
  }

  if (!fullContent.trim()) {
    throw new ProviderHttpError(502, `${providerLabel} returned an empty stream.`);
  }
  return fullContent;
}

function detectStreamedPaths(accumulatedText: string): string[] {
  const paths: string[] = [];
  const regex = /"path"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(accumulatedText)) !== null) {
    const clean = normalizeProjectFilePath(match[1]);
    if (!paths.includes(clean)) {
      paths.push(clean);
    }
  }
  return paths;
}

async function postProcessGeneratedProject(params: {
  parsed: Record<string, unknown>;
  prompt: string;
  config: AiProviderConfig;
}): Promise<Record<string, unknown>> {
  const { parsed, prompt, config } = params;
  let normalizedFiles: Array<{ path: string; language: string; content: string }> = Array.isArray(parsed.files)
    ? (parsed.files as Array<{ path?: string; language?: string; content?: string }>).map((f) => {
        const cleanPath = normalizeProjectFilePath(String(f.path || 'src/App.tsx'));
        return {
          path: cleanPath,
          language: String(
            f.language || (cleanPath.endsWith('.css') ? 'css' : cleanPath.endsWith('.ts') ? 'ts' : 'tsx'),
          ),
          content: String(f.content || ''),
        };
      })
    : [];

  const hasRootApp = normalizedFiles.some((f) => {
    const lower = f.path.toLowerCase();
    return lower === 'src/app.tsx' || lower === 'src/app.jsx' || lower === 'app.tsx' || lower === 'app.jsx';
  });

  if (!hasRootApp && normalizedFiles.length > 0) {
    const existingSummary = normalizedFiles
      .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 1800)}`)
      .join('\n\n');
    const repairPrompt = `You generated files for "${prompt.trim()}" but omitted src/App.tsx.
Write the complete root "src/App.tsx" (default-exported function App) that composes the generated components cleanly with full responsive UI and working state.

Existing generated files:
${existingSummary}

Return JSON: { "content": "..." }`;

    let synthesizedAppContent = '';
    try {
      const repairRaw = await callByokCompletionRaw({
        config,
        messages: [
          { role: 'system', content: `${SYSTEM_GENERATOR_PROMPT}\nRespond strictly with valid JSON.` },
          { role: 'user', content: repairPrompt },
        ],
        jsonMode: true,
        maxTokens: 6144,
      });
      const repairJson = extractJsonObject(repairRaw);
      if (typeof repairJson.content === 'string' && repairJson.content.trim()) {
        synthesizedAppContent = repairJson.content;
      }
    } catch {
      // Fallback below guarantees valid src/App.tsx
    }

    if (!synthesizedAppContent) {
      const firstComp = normalizedFiles.find((f) => f.path.endsWith('.tsx'));
      if (firstComp) {
        const rel = './' + firstComp.path.replace(/^src\//, '').replace(/\.tsx$/, '');
        synthesizedAppContent = `import React from 'react';\nimport PrimaryView from '${rel}';\n\nexport default function App() {\n  return <PrimaryView />;\n}\n`;
      }
    }

    if (synthesizedAppContent) {
      normalizedFiles = [
        { path: 'src/App.tsx', language: 'tsx', content: synthesizedAppContent },
        ...normalizedFiles,
      ];
    }
  }

  if (!normalizedFiles.some((f) => f.path.toLowerCase() === 'src/index.css')) {
    normalizedFiles.push({
      path: 'src/index.css',
      language: 'css',
      content: '@import "tailwindcss";\n',
    });
  }

  parsed.files = normalizedFiles;
  if (!parsed.projectName && typeof parsed.title === 'string') {
    parsed.projectName = parsed.title;
  }
  return parsed;
}

function buildGenerateUserPrompt(prompt: string, enableAppAi: boolean): string {
  const aiCapabilityDirective = enableAppAi
    ? '\n- Interactive App AI Runtime is requested/enabled: wire real fetch(\'/api/app-ai\', { method: \'POST\', headers: { \'Content-Type\': \'application/json\' }, body: JSON.stringify({ prompt, messages, systemInstruction }) }) calls directly in the generated UI with real loading & error states.'
    : '\n- Do NOT include AI chatbots, "Ask AI" sidebars, or /api/app-ai calls — build a clean, self-contained application tailored purely to the user request.';

  return `Build a complete, multi-file React + TypeScript + Tailwind CSS web app (or Three.js / Canvas game) for this request:
"${prompt.trim()}"${aiCapabilityDirective}

CRITICAL OUTPUT RULES:
- "src/App.tsx" MUST be the VERY FIRST file in the "files" array and MUST default-export App (export default function App()).
- Complete EVERY component and handler without placeholders or truncation.
- Also include "src/index.css" starting with @import "tailwindcss";.
- Respond strictly with valid JSON matching this shape:
{
  "projectName": "Short site title",
  "description": "One-sentence summary of the site",
  "summary": "Brief note describing what you built",
  "files": [
    { "path": "src/App.tsx", "language": "tsx", "content": "..." },
    { "path": "src/components/Navbar.tsx", "language": "tsx", "content": "..." },
    { "path": "src/index.css", "language": "css", "content": "@import \\"tailwindcss\\";\\n" }
  ]
}`;
}

function buildRefineUserPrompt(
  instruction: string,
  files: ProjectFile[],
  selectedElement?: { tagName: string; textContent: string; className: string },
  enableAppAi?: boolean,
): string {
  const fileBundleText = (files || [])
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
    .join('\n\n');

  const elementContext = selectedElement
    ? `\nFocused element selected by user: <${selectedElement.tagName}> className="${selectedElement.className}" text="${selectedElement.textContent}"`
    : '';

  const aiDirective = enableAppAi
    ? `- Wire real calls to POST /api/app-ai ({ prompt, messages, systemInstruction }) returning { text } if adding/updating live AI features — never fake setTimeout stubs.`
    : `- Do NOT introduce unrequested AI chatbots or /api/app-ai calls unless the instruction asks for them.`;

  return `Refine the existing application according to EVERY detail in this instruction:
"${instruction.trim()}"${elementContext}

MULTI-PART REFINEMENT MANDATE:
- Read every clause in the user's message carefully (e.g., color/palette changes, game/canvas bug fixes, speed/physics tweaks, new buttons or panels, layout changes) and apply ALL of them together in this single pass!
- If fixing a broken game or "Play Game" button: ensure <canvas> is always mounted (never hidden before effect initialization), buttons use <button type="button" onClick={...}> (never <a href="/...">), and requestAnimationFrame loop transitions cleanly into active play.
${aiDirective}

Current files:
${fileBundleText}

Return valid JSON containing ONLY the modified or newly created files (full complete file contents, never ellipses):
{
  "summary": "Concise list of every change applied",
  "files": [
    { "path": "src/App.tsx", "language": "tsx", "content": "..." }
  ]
}`;
}

app.get('/api/ai/status', (_req, res) => {
  res.json({
    byokOnly: true,
    incidents: Array.from(recentModelIncidents.values()),
  });
});

// Live gateway model catalog proxy (OpenRouter, Groq, Gemini BYOK, NVIDIA, OpenAI, Custom)
app.get('/api/ai/models', catalogRateLimiter, async (req, res) => {
  const baseUrl =
    typeof req.query.baseUrl === 'string' && req.query.baseUrl.trim()
      ? req.query.baseUrl.trim()
      : 'https://openrouter.ai/api/v1';
  const forceRefresh = req.query.forceRefresh === 'true';
  try {
    const result = await fetchGatewayModelsCatalog({ baseUrl, forceRefresh });
    res.json(result);
  } catch (err) {
    const status = err instanceof SecurityValidationError ? err.status : 502;
    res.status(status).json({ error: sanitizeErrorMessage(err) });
  }
});

app.post('/api/ai/models', catalogRateLimiter, async (req, res) => {
  const { baseUrl, apiKey, forceRefresh } = req.body as {
    baseUrl?: string;
    apiKey?: string;
    forceRefresh?: boolean;
  };
  const targetUrl = (baseUrl || 'https://openrouter.ai/api/v1').trim();
  try {
    const result = await fetchGatewayModelsCatalog({
      baseUrl: targetUrl,
      apiKey,
      forceRefresh: Boolean(forceRefresh),
    });
    res.json(result);
  } catch (err) {
    const status = err instanceof SecurityValidationError ? err.status : 502;
    res.status(status).json({ error: sanitizeErrorMessage(err) });
  }
});

// Ephemeral scoped preview AI session token endpoints (keeps raw BYOK keys out of preview iframes)
app.post('/api/ai/session', aiRateLimiter, async (req, res) => {
  try {
    const { providerConfig } = req.body as { providerConfig?: AiProviderConfig };
    const { config } = await resolveByokRequestParams(providerConfig);
    const session = createPreviewAiSession(config);
    res.json(session);
  } catch (err) {
    const status = getHttpStatusFromError(err);
    res.status(status).json({ error: sanitizeErrorMessage(err) });
  }
});

app.delete('/api/ai/session/:token', (req, res) => {
  const revoked = revokePreviewAiSession(req.params.token);
  res.json({ ok: true, revoked });
});

app.post('/api/ai/test-provider', aiRateLimiter, async (req, res) => {
  const config = normalizeProviderConfigToStudio(req.body as AiProviderConfig);
  const provider = config.provider;
  const model = config.model;

  try {
    await callByokCompletionRaw({
      config,
      messages: [
        { role: 'system', content: 'Return JSON {"ok": true}' },
        { role: 'user', content: 'Return {"ok": true}' },
      ],
      jsonMode: true,
      maxTokens: 64,
    });
    clearIncident(provider, model);
    res.json({ ok: true, provider, model, name: config.name });
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err);
    const incident = classifyModelError({ status, message, provider, model });
    recordIncident(incident);
    res.status(status).json({ ok: false, error: incident.message, incident });
  }
});

// Streaming website generation (SSE) for real-time progress
app.post('/api/ai/generate/stream', aiRateLimiter, async (req, res) => {
  const { prompt, providerConfig, enableAppAi } = req.body as {
    prompt: string;
    providerConfig?: AiProviderConfig;
    enableAppAi?: boolean;
  };
  const effectiveEnableAppAi = shouldEnableAppAi(
    prompt || '',
    'on_request',
    typeof enableAppAi === 'boolean' ? enableAppAi : undefined,
  );
  const config = normalizeProviderConfigToStudio(
    providerConfig || {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    },
  );

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    if (!prompt || !prompt.trim()) {
      sendEvent({ type: 'error', error: 'Prompt is required.' });
      res.end();
      return;
    }

    const providerTitle = config.name?.trim() || 'BYOK Model';
    sendEvent({
      type: 'phase',
      phase: `Connecting to ${providerTitle} (${config.model})...`,
    });

    const userPrompt = buildGenerateUserPrompt(prompt, effectiveEnableAppAi);
    let seenPaths: string[] = [];
    let lastEmitAt = 0;

    const rawText = await streamByokCompletion({
      config,
      messages: [
        { role: 'system', content: `${SYSTEM_GENERATOR_PROMPT}\nAlways respond strictly with valid JSON.` },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      maxTokens: 12288,
      onDelta: (accumulated) => {
        const currentPaths = detectStreamedPaths(accumulated);
        const now = Date.now();
        if (currentPaths.length > seenPaths.length) {
          if (seenPaths.length > 0) {
            const justFinished = seenPaths[seenPaths.length - 1];
            sendEvent({ type: 'file_done', path: justFinished });
          }
          const active = currentPaths[currentPaths.length - 1];
          seenPaths = currentPaths;
          sendEvent({
            type: 'file_start',
            path: active,
            completedFiles: seenPaths.slice(0, -1),
            chars: accumulated.length,
          });
          lastEmitAt = now;
        } else if (now - lastEmitAt > 250) {
          lastEmitAt = now;
          sendEvent({
            type: 'progress',
            activeFile: seenPaths[seenPaths.length - 1],
            completedFiles: seenPaths.slice(0, -1),
            chars: accumulated.length,
          });
        }
      },
    });

    sendEvent({
      type: 'phase',
      phase: 'Validating files & preparing preview...',
      completedFiles: seenPaths,
      chars: rawText.length,
    });

    const parsed = extractJsonObject(rawText);
    const finalized = await postProcessGeneratedProject({ parsed, prompt, config });
    clearIncident(config.provider, config.model);
    sendEvent({ type: 'complete', result: finalized });
    res.end();
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err) || 'Generation failed';
    const incident = classifyModelError({
      status,
      message,
      provider: config.provider,
      model: config.model,
    });
    recordIncident(incident);
    sendEvent({ type: 'error', error: incident.message, incident });
    res.end();
  }
});

// Standard non-streaming website generation endpoint (compat fallback)
app.post('/api/ai/generate', aiRateLimiter, async (req, res) => {
  const { prompt, providerConfig, enableAppAi } = req.body as {
    prompt: string;
    providerConfig?: AiProviderConfig;
    enableAppAi?: boolean;
  };
  const effectiveEnableAppAi = shouldEnableAppAi(
    prompt || '',
    'on_request',
    typeof enableAppAi === 'boolean' ? enableAppAi : undefined,
  );
  const config = normalizeProviderConfigToStudio(
    providerConfig || {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    },
  );

  try {
    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const userPrompt = buildGenerateUserPrompt(prompt, effectiveEnableAppAi);
    const raw = await callByokCompletionRaw({
      config,
      messages: [
        { role: 'system', content: `${SYSTEM_GENERATOR_PROMPT}\nAlways respond strictly with valid JSON.` },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      maxTokens: 12288,
    });

    const parsed = extractJsonObject(raw);
    const finalized = await postProcessGeneratedProject({ parsed, prompt, config });
    clearIncident(config.provider, config.model);
    res.json(finalized);
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err) || 'Generation failed';
    const incident = classifyModelError({
      status,
      message,
      provider: config.provider,
      model: config.model,
    });
    recordIncident(incident);
    res.status(status).json({ error: incident.message, incident });
  }
});

// Streaming website refinement (SSE)
app.post('/api/ai/refine/stream', aiRateLimiter, async (req, res) => {
  const { instruction, files, selectedElement, providerConfig, enableAppAi } = req.body as {
    instruction: string;
    files: ProjectFile[];
    selectedElement?: { tagName: string; textContent: string; className: string };
    providerConfig?: AiProviderConfig;
    enableAppAi?: boolean;
  };
  const effectiveEnableAppAi = shouldEnableAppAi(
    instruction || '',
    'on_request',
    typeof enableAppAi === 'boolean' ? enableAppAi : undefined,
  );
  const config = normalizeProviderConfigToStudio(
    providerConfig || {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    },
  );

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    if (!instruction || !instruction.trim()) {
      sendEvent({ type: 'error', error: 'Refinement instruction is required.' });
      res.end();
      return;
    }

    const providerTitle = config.name?.trim() || 'BYOK Model';
    sendEvent({
      type: 'phase',
      phase: `Analyzing codebase with ${providerTitle} (${config.model})...`,
    });

    const userPrompt = buildRefineUserPrompt(instruction, files, selectedElement, effectiveEnableAppAi);
    let seenPaths: string[] = [];
    let lastEmitAt = 0;

    const rawText = await streamByokCompletion({
      config,
      messages: [
        { role: 'system', content: `${SYSTEM_GENERATOR_PROMPT}\nAlways respond strictly with valid JSON.` },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      maxTokens: 12288,
      onDelta: (accumulated) => {
        const currentPaths = detectStreamedPaths(accumulated);
        const now = Date.now();
        if (currentPaths.length > seenPaths.length) {
          if (seenPaths.length > 0) {
            sendEvent({ type: 'file_done', path: seenPaths[seenPaths.length - 1] });
          }
          const active = currentPaths[currentPaths.length - 1];
          seenPaths = currentPaths;
          sendEvent({
            type: 'file_start',
            path: active,
            completedFiles: seenPaths.slice(0, -1),
            chars: accumulated.length,
          });
          lastEmitAt = now;
        } else if (now - lastEmitAt > 250) {
          lastEmitAt = now;
          sendEvent({
            type: 'progress',
            activeFile: seenPaths[seenPaths.length - 1],
            completedFiles: seenPaths.slice(0, -1),
            chars: accumulated.length,
          });
        }
      },
    });

    const parsed = extractJsonObject(rawText);
    if (Array.isArray(parsed.files)) {
      parsed.files = (parsed.files as Array<{ path?: string; language?: string; content?: string }>).map((f) => ({
        ...f,
        path: normalizeProjectFilePath(String(f.path || 'src/App.tsx')),
      }));
    }

    clearIncident(config.provider, config.model);
    sendEvent({ type: 'complete', result: parsed });
    res.end();
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err) || 'Refinement failed';
    const incident = classifyModelError({
      status,
      message,
      provider: config.provider,
      model: config.model,
    });
    recordIncident(incident);
    sendEvent({ type: 'error', error: incident.message, incident });
    res.end();
  }
});

// Standard non-streaming refine endpoint
app.post('/api/ai/refine', aiRateLimiter, async (req, res) => {
  const { instruction, files, selectedElement, providerConfig, enableAppAi } = req.body as {
    instruction: string;
    files: ProjectFile[];
    selectedElement?: { tagName: string; textContent: string; className: string };
    providerConfig?: AiProviderConfig;
    enableAppAi?: boolean;
  };
  const effectiveEnableAppAi = shouldEnableAppAi(
    instruction || '',
    'on_request',
    typeof enableAppAi === 'boolean' ? enableAppAi : undefined,
  );
  const config = normalizeProviderConfigToStudio(
    providerConfig || {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    },
  );

  try {
    if (!instruction || !instruction.trim()) {
      res.status(400).json({ error: 'Refinement instruction is required.' });
      return;
    }

    const userPrompt = buildRefineUserPrompt(instruction, files, selectedElement, effectiveEnableAppAi);
    const raw = await callByokCompletionRaw({
      config,
      messages: [
        { role: 'system', content: `${SYSTEM_GENERATOR_PROMPT}\nAlways respond strictly with valid JSON.` },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
      maxTokens: 12288,
    });

    const parsed = extractJsonObject(raw);
    if (Array.isArray(parsed.files)) {
      parsed.files = (parsed.files as Array<{ path?: string; language?: string; content?: string }>).map(
        (f) => ({
          ...f,
          path: normalizeProjectFilePath(String(f.path || 'src/App.tsx')),
        }),
      );
    }

    clearIncident(config.provider, config.model);
    res.json(parsed);
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err) || 'Refinement failed';
    const incident = classifyModelError({
      status,
      message,
      provider: config.provider,
      model: config.model,
    });
    recordIncident(incident);
    res.status(status).json({ error: incident.message, incident });
  }
});

// Pure BYOK Voice Studio conversational turn (zero hardcoded Gemini Live keys)
app.post('/api/ai/voice-turn', aiRateLimiter, async (req, res) => {
  const { messages, mode, projectName, providerConfig } = req.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    mode?: 'create' | 'refine';
    projectName?: string;
    providerConfig?: AiProviderConfig;
  };
  const config = normalizeProviderConfigToStudio(
    providerConfig || {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    },
  );

  try {
    const sys =
      mode === 'refine' && projectName
        ? `You are Mist, a sharp, concise AI website & game design partner speaking aloud with a user refining "${projectName}". Keep each response crisp (1-3 short conversational sentences), practical, and focused on concrete UI, color, physics, or feature decisions.`
        : 'You are Mist, a sharp, concise AI website & game design partner speaking aloud with a user brainstorming a new site or game. Keep each response crisp (1-3 short conversational sentences), helpful, and actionable.';

    const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: sys },
      ...(Array.isArray(messages) ? messages : []),
    ];

    const text = await callByokCompletionRaw({
      config,
      messages: chatMessages,
      jsonMode: false,
      temperature: 0.65,
      maxTokens: 512,
    });

    clearIncident(config.provider, config.model);
    res.json({ text: text.trim(), provider: config.name || config.provider, model: config.model });
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err) || 'Voice request failed';
    const incident = classifyModelError({
      status,
      message,
      provider: config.provider,
      model: config.model,
    });
    recordIncident(incident);
    res.status(status).json({ error: incident.message, incident });
  }
});

// Live BYOK AI runtime endpoint called directly by generated apps (Preview & Published /p/:slug)
app.post('/api/app-ai', aiRateLimiter, async (req, res) => {
  const { prompt, messages, systemInstruction, jsonMode, sessionToken, providerConfig } = req.body as {
    prompt?: string;
    messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    systemInstruction?: string;
    jsonMode?: boolean;
    sessionToken?: string;
    providerConfig?: AiProviderConfig;
  };
  const headerToken =
    typeof req.headers['x-mist-session'] === 'string' ? req.headers['x-mist-session'] : undefined;
  const sessionResolved = resolvePreviewAiSession(sessionToken || headerToken);
  const config = sessionResolved
    ? normalizeProviderConfigToStudio(sessionResolved)
    : normalizeProviderConfigToStudio(
        providerConfig || {
          provider: 'custom',
          name: 'BYOK Provider',
          baseUrl: '',
          model: '',
          apiKey: '',
        },
      );

  try {
    const trimmedPrompt = (prompt || '').trim();
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!trimmedPrompt && !hasMessages) {
      res.status(400).json({ error: 'Provide either prompt or messages.' });
      return;
    }

    const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content:
          systemInstruction ||
          'You are a concise, helpful backend AI powering an interactive web application built with Mist.',
      },
      ...(hasMessages ? messages! : [{ role: 'user' as const, content: trimmedPrompt }]),
    ];

    const text = await callByokCompletionRaw({
      config,
      messages: chatMessages,
      jsonMode: Boolean(jsonMode),
      temperature: 0.6,
      maxTokens: 2048,
    });

    clearIncident(config.provider, config.model);
    res.json({
      text,
      provider: config.name || config.provider,
      model: config.model,
    });
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = sanitizeErrorMessage(err) || 'App AI runtime failed';
    const incident = classifyModelError({
      status,
      message,
      provider: config.provider,
      model: config.model,
    });
    recordIncident(incident);
    res.status(status).json({ error: incident.message, incident });
  }
});

// --- 5. Deployments Persistence & Live Hosting Route (/p/:slug) ---
interface StoredDeployment {
  slug: string;
  ownerUid?: string;
  projectId: string;
  title: string;
  htmlBundle: string;
  updatedAt: string;
}

function readDeploymentsStore(): Record<string, StoredDeployment> {
  try {
    if (!fs.existsSync(DEPLOYMENTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf8')) as Record<string, StoredDeployment>;
  } catch {
    return {};
  }
}

function writeDeploymentsStore(store: Record<string, StoredDeployment>) {
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

app.get('/api/deployments', (_req, res) => {
  const store = readDeploymentsStore();
  const list = Object.values(store)
    .map(({ slug, projectId, title, updatedAt }) => ({
      slug,
      projectId,
      title,
      url: `/p/${slug}`,
      updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ deployments: list });
});

app.post('/api/deployments', deployRateLimiter, async (req, res) => {
  try {
    const authUser = await verifyFirebaseAuthHeader(req.headers.authorization);
    if (!authUser.emailVerified) {
      res.status(403).json({ error: 'A verified Google account is required to publish sites.' });
      return;
    }

    const { slug, projectId, title, files, enableAppAi } = req.body as {
      slug: string;
      projectId: string;
      title: string;
      files: ProjectFile[];
      enableAppAi?: boolean;
    };
    const cleanSlug = (slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (cleanSlug.length < 2 || !Array.isArray(files)) {
      res.status(400).json({ error: 'Valid slug and project files are required.' });
      return;
    }

    const store = readDeploymentsStore();
    const existing = store[cleanSlug];
    if (existing?.ownerUid && existing.ownerUid !== authUser.uid) {
      res.status(403).json({ error: 'This deployment URL is owned by another user.' });
      return;
    }

    const { html } = await bundleProjectToHtml({
      files,
      title: title || cleanSlug,
      includeInspector: false,
      enableAppAi: Boolean(enableAppAi),
    });

    const record: StoredDeployment = {
      slug: cleanSlug,
      ownerUid: authUser.uid,
      projectId: projectId || cleanSlug,
      title: title || cleanSlug,
      htmlBundle: html,
      updatedAt: new Date().toISOString(),
    };
    store[cleanSlug] = record;
    writeDeploymentsStore(store);

    res.json({
      slug: cleanSlug,
      url: `/p/${cleanSlug}`,
      title: record.title,
      updatedAt: record.updatedAt,
      htmlBundle: html,
    });
  } catch (err) {
    const status = err instanceof SecurityValidationError ? err.status : 500;
    res.status(status).json({ error: sanitizeErrorMessage(err) || 'Deployment failed' });
  }
});

app.delete('/api/deployments/:slug', deployRateLimiter, async (req, res) => {
  try {
    const authUser = await verifyFirebaseAuthHeader(req.headers.authorization);
    if (!authUser.emailVerified) {
      res.status(403).json({ error: 'A verified Google account is required to manage deployments.' });
      return;
    }

    const cleanSlug = (req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const store = readDeploymentsStore();
    const existing = store[cleanSlug];
    if (!existing) {
      res.json({ ok: true, slug: cleanSlug });
      return;
    }
    if (existing.ownerUid && existing.ownerUid !== authUser.uid) {
      res.status(403).json({ error: 'Only the deployment owner can unpublish this site.' });
      return;
    }

    delete store[cleanSlug];
    writeDeploymentsStore(store);
    res.json({ ok: true, slug: cleanSlug });
  } catch (err) {
    const status = err instanceof SecurityValidationError ? err.status : 500;
    res.status(status).json({ error: sanitizeErrorMessage(err) || 'Delete deployment failed' });
  }
});

app.get('/p/:slug', (req, res) => {
  const cleanSlug = (req.params.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const store = readDeploymentsStore();
  const record = store[cleanSlug];
  if (!record) {
    res
      .status(404)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:48px;max-width:560px;margin:0 auto;background:#09090b;color:#f4f4f5;"><h1>Site not found</h1><p style="color:#a1a1aa;">No Mist deployment exists at <code>/p/${cleanSlug}</code>.</p><a href="/" style="color:#60a5fa;">Return to Mist</a></body></html>`,
      );
    return;
  }
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none';",
  );
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(record.htmlBundle);
});

// --- 6. Vite Dev Middleware / Production Static Serving ---
async function startServer() {
  await ensureVendorRuntime();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Mist server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Mist server:', err);
  process.exit(1);
});
