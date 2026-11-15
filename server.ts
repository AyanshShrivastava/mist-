import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { compile as compileTailwind } from 'tailwindcss';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import type { AiProviderConfig, AiProviderId, ProjectFile } from './src/types/mist';
import { classifyModelError, type ModelHealthIncident } from './src/utils/aiErrors';
import { normalizeProjectFilePath, resolveAppEntryPath } from './src/utils/projectOps';

dotenv.config();

const require = createRequire(import.meta.url);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DEPLOYMENTS_FILE = path.resolve(process.cwd(), '.mist-deployments.json');

app.use(express.json({ limit: '4mb' }));
app.use('/src/assets', express.static(path.resolve(process.cwd(), 'src/assets')));

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

// --- 3. Multi-File React + TSX Bundler ---
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

async function bundleProjectToHtml(params: {
  files: ProjectFile[];
  title: string;
  includeInspector?: boolean;
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

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === entryPath) {
          return { path: entryPath, namespace: 'mist-fs' };
        }
        if (args.path.endsWith('.css')) {
          return { path: args.path, namespace: 'mist-css-noop' };
        }
        const importerDir = args.importer && args.importer !== entryPath
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
          const icons = lucideExportNames
            .map((k) => `export const ${k} = window.__MIST_VENDOR__.LucideReact["${k}"];`)
            .join('\n');
          return { contents: icons, loader: 'js' };
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
          return { contents: syntheticEntry, loader: 'tsx' };
        }
        const file = fileMap.get(args.path);
        if (!file) return { contents: '', loader: 'tsx' };
        const loader = file.path.endsWith('.ts') ? 'ts' : file.path.endsWith('.json') ? 'json' : 'tsx';
        return { contents: file.content, loader };
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
  const MIST_APP_AI_RUNTIME_SCRIPT = `
(function() {
  window.mistAI = {
    complete: async function(prompt, options) {
      var opts = options || {};
      var res = await fetch('/api/app-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          messages: opts.messages,
          systemInstruction: opts.systemInstruction,
          jsonMode: Boolean(opts.jsonMode)
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

app.post('/api/bundle', async (req, res) => {
  try {
    const { files, title, includeInspector } = req.body as {
      files: ProjectFile[];
      title?: string;
      includeInspector?: boolean;
    };
    if (!Array.isArray(files)) {
      res.status(400).json({ error: 'Invalid files payload' });
      return;
    }
    const result = await bundleProjectToHtml({
      files,
      title: title || 'Mist Preview',
      includeInspector: includeInspector !== false,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Bundling failed' });
  }
});

// --- 4. AI Generation, Refinement, Provider Testing, & Model Health Status ---
const SYSTEM_GENERATOR_PROMPT = `You are Mist, a senior product designer and React + TypeScript + Tailwind CSS frontend engineer.
Generate clean, cohesive, responsive, accessible websites with deliberate typography, strong contrast, mobile responsiveness, and crisp layouts.
Rules:
- Use React 19, TypeScript (.tsx), and Tailwind CSS utility classes.
- Allowed imports: 'react', 'lucide-react', and local relative imports like './components/Navbar'. Do NOT import unrequested third-party libraries.
- Never use broken external URLs like unsplash.com or placeholder.com; for imagery use crisp SVG/CSS illustrations or local Mist studio assets if needed.
- Never use Sparkles, Star, or Wand icons from lucide-react; prefer crisp functional icons (Send, MessageSquare, Cpu, ArrowRight, Terminal, Layers, Check).
- Ensure src/App.tsx is the default-exported root component and src/index.css starts with @import "tailwindcss";.
- Real AI Feature Integration: Whenever the user's idea calls for AI functionality (assistant, chat widget, content generator, analyzer, summarizer, planner, quiz builder, smart search, etc.), implement it with a REAL live HTTP call to POST /api/app-ai:
  const res = await fetch('/api/app-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, messages, systemInstruction })
  });
  const data = await res.json(); // returns { text, model, provider } or { error }
  Include real loading state, disabled submit guard while pending, and inline error state. NEVER fake AI replies with setTimeout stubs or canned static arrays.
- Use clean, natural copy without fake telemetry tickers or placeholder lorem ipsum.`;

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
  if (err instanceof ProviderHttpError) return err.status;
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
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

async function callOpenAiCompatibleRaw(params: {
  config: AiProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  jsonMode?: boolean;
  temperature?: number;
}): Promise<string> {
  const { config, messages, jsonMode = true, temperature = 0.4 } = params;
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderHttpError(401, `Please add your ${config.provider} API key in Settings.`);
  }

  let endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  if (config.provider === 'groq') {
    endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  } else if (config.provider === 'custom') {
    const base = (config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) {
      throw new ProviderHttpError(400, 'Custom provider requires a Base URL.');
    }
    endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
    headers['X-Title'] = 'Mist Website Builder';
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature,
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new ProviderHttpError(resp.status, `${config.provider} error (${resp.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new ProviderHttpError(502, `${config.provider} returned an empty response.`);
  }
  return content;
}

async function callOpenAiCompatibleProvider(params: {
  config: AiProviderConfig;
  systemInstruction: string;
  userPrompt: string;
}): Promise<Record<string, unknown>> {
  const content = await callOpenAiCompatibleRaw({
    config: params.config,
    messages: [
      { role: 'system', content: params.systemInstruction },
      { role: 'user', content: params.userPrompt },
    ],
    jsonMode: true,
    temperature: 0.4,
  });
  return extractJsonObject(content);
}

app.get('/api/ai/status', (_req, res) => {
  res.json({
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    incidents: Array.from(recentModelIncidents.values()),
  });
});

app.post('/api/ai/test-provider', async (req, res) => {
  const config = req.body as AiProviderConfig;
  const provider = config?.provider || 'gemini';
  const model = config?.model || 'gemini-4-hydrogen';

  try {
    if (provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new ProviderHttpError(503, 'Gemini inference key is unavailable on server.');
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      await ai.models.generateContent({
        model,
        contents: 'Reply with OK',
      });
    } else {
      await callOpenAiCompatibleProvider({
        config,
        systemInstruction: 'Return JSON {"ok": true}',
        userPrompt: 'Return {"ok": true}',
      });
    }
    clearIncident(provider, model);
    res.json({ ok: true, provider, model });
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = err instanceof Error ? err.message : String(err);
    const incident = classifyModelError({ status, message, provider, model });
    recordIncident(incident);
    res.status(status).json({ ok: false, error: incident.message, incident });
  }
});

app.post('/api/ai/generate', async (req, res) => {
  const { prompt, providerConfig, enableAppAi = true } = req.body as {
    prompt: string;
    providerConfig?: AiProviderConfig;
    enableAppAi?: boolean;
  };
  const config: AiProviderConfig = providerConfig || {
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
  };

  try {
    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const aiCapabilityDirective = enableAppAi
      ? '\n- Interactive App AI Runtime is enabled: whenever the site benefits from live AI (chatbots, content generators, smart search, summarizers, analyzers), wire real fetch(\'/api/app-ai\', { method: \'POST\', headers: { \'Content-Type\': \'application/json\' }, body: JSON.stringify({ prompt, systemInstruction }) }) calls directly in the generated UI.'
      : '';

    const userPrompt = `Build a complete, multi-file React + TypeScript + Tailwind CSS website for this request:
"${prompt.trim()}"${aiCapabilityDirective}

CRITICAL OUTPUT RULES:
- "src/App.tsx" MUST be the VERY FIRST file in the "files" array and MUST default-export App (export default function App()).
- Keep mock/seed datasets concise (4-6 realistic items max) so every file, especially src/App.tsx and all imported components, completes without truncation.
- Also include "src/index.css" starting with @import "tailwindcss";.

Return JSON with this exact shape:
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

    let parsed: Record<string, unknown>;

    if (config.provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new ProviderHttpError(503, 'Server GEMINI_API_KEY is not configured.');
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: config.model || 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          systemInstruction: SYSTEM_GENERATOR_PROMPT,
          maxOutputTokens: 32768,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              projectName: { type: Type.STRING },
              description: { type: Type.STRING },
              summary: { type: Type.STRING },
              files: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: { type: Type.STRING },
                    language: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                  required: ['path', 'language', 'content'],
                },
              },
            },
            required: ['projectName', 'description', 'summary', 'files'],
          },
        },
      });
      parsed = extractJsonObject(response.text || '{}');
    } else {
      parsed = await callOpenAiCompatibleProvider({
        config,
        systemInstruction: `${SYSTEM_GENERATOR_PROMPT}\nAlways respond strictly with valid JSON.`,
        userPrompt,
      });
    }

    let normalizedFiles: Array<{ path: string; language: string; content: string }> = Array.isArray(parsed.files)
      ? (parsed.files as Array<{ path?: string; language?: string; content?: string }>).map((f) => {
          const cleanPath = normalizeProjectFilePath(String(f.path || 'src/App.tsx'));
          return {
            path: cleanPath,
            language: String(f.language || (cleanPath.endsWith('.css') ? 'css' : cleanPath.endsWith('.ts') ? 'ts' : 'tsx')),
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
        if (config.provider === 'gemini' && process.env.GEMINI_API_KEY) {
          const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });
          const repairResp = await ai.models.generateContent({
            model: config.model || 'gemini-4-hydrogen',
            contents: repairPrompt,
            config: {
              systemInstruction: SYSTEM_GENERATOR_PROMPT,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  content: { type: Type.STRING },
                },
                required: ['content'],
              },
            },
          });
          const repairJson = extractJsonObject(repairResp.text || '{}');
          if (typeof repairJson.content === 'string' && repairJson.content.trim()) {
            synthesizedAppContent = repairJson.content;
          }
        } else if (config.provider !== 'gemini') {
          const repairJson = await callOpenAiCompatibleProvider({
            config,
            systemInstruction: `${SYSTEM_GENERATOR_PROMPT}\nRespond strictly with valid JSON.`,
            userPrompt: repairPrompt,
          });
          if (typeof repairJson.content === 'string' && repairJson.content.trim()) {
            synthesizedAppContent = repairJson.content;
          }
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

    clearIncident(config.provider, config.model);
    res.json(parsed);
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = err instanceof Error ? err.message : 'Generation failed';
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

app.post('/api/ai/refine', async (req, res) => {
  const { instruction, files, selectedElement, providerConfig } = req.body as {
    instruction: string;
    files: ProjectFile[];
    selectedElement?: { tagName: string; textContent: string; className: string };
    providerConfig?: AiProviderConfig;
  };
  const config: AiProviderConfig = providerConfig || {
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
  };

  try {
    if (!instruction || !instruction.trim()) {
      res.status(400).json({ error: 'Refinement instruction is required.' });
      return;
    }

    const fileBundleText = (files || [])
      .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
      .join('\n\n');

    const elementContext = selectedElement
      ? `\nFocused element selected by user: <${selectedElement.tagName}> className="${selectedElement.className}" text="${selectedElement.textContent}"`
      : '';

    const userPrompt = `Refine the existing website according to this instruction:
"${instruction.trim()}"${elementContext}

If adding or updating AI features in the website, always integrate real calls to POST /api/app-ai ({ prompt, messages, systemInstruction }) returning { text } — never fake setTimeout stubs.

Current files:
${fileBundleText}

Return JSON containing ONLY the modified or newly created files (full file contents, never ellipses):
{
  "summary": "Brief description of the change made",
  "files": [
    { "path": "src/App.tsx", "language": "tsx", "content": "..." }
  ]
}`;

    let parsed: Record<string, unknown>;

    if (config.provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new ProviderHttpError(503, 'Server GEMINI_API_KEY is not configured.');
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: config.model || 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          systemInstruction: SYSTEM_GENERATOR_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              files: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    path: { type: Type.STRING },
                    language: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                  required: ['path', 'language', 'content'],
                },
              },
            },
            required: ['summary', 'files'],
          },
        },
      });
      parsed = extractJsonObject(response.text || '{}');
    } else {
      parsed = await callOpenAiCompatibleProvider({
        config,
        systemInstruction: `${SYSTEM_GENERATOR_PROMPT}\nAlways respond strictly with valid JSON.`,
        userPrompt,
      });
    }

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
    const message = err instanceof Error ? err.message : 'Refinement failed';
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

// Live AI runtime endpoint called directly by generated apps (Preview & Published /p/:slug)
app.post('/api/app-ai', async (req, res) => {
  const { prompt, messages, systemInstruction, jsonMode, providerConfig } = req.body as {
    prompt?: string;
    messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    systemInstruction?: string;
    jsonMode?: boolean;
    providerConfig?: AiProviderConfig;
  };
  const config: AiProviderConfig = providerConfig || {
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
  };

  try {
    const trimmedPrompt = (prompt || '').trim();
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!trimmedPrompt && !hasMessages) {
      res.status(400).json({ error: 'Provide either prompt or messages.' });
      return;
    }

    let text = '';
    if (config.provider === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new ProviderHttpError(503, 'Server GEMINI_API_KEY is not configured.');
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const contents = hasMessages
        ? messages!
            .filter((m) => m.role !== 'system')
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n')
        : trimmedPrompt;
      const response = await ai.models.generateContent({
        model: config.model || 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction:
            systemInstruction ||
            'You are a concise, helpful backend AI powering an interactive web application built with Mist.',
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      });
      text = response.text || '';
    } else {
      const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        {
          role: 'system',
          content:
            systemInstruction ||
            'You are a concise, helpful backend AI powering an interactive web application built with Mist.',
        },
        ...(hasMessages ? messages! : [{ role: 'user' as const, content: trimmedPrompt }]),
      ];
      text = await callOpenAiCompatibleRaw({
        config,
        messages: chatMessages,
        jsonMode: Boolean(jsonMode),
        temperature: 0.6,
      });
    }

    clearIncident(config.provider, config.model);
    res.json({
      text,
      provider: config.provider,
      model: config.model,
    });
  } catch (err) {
    const status = getHttpStatusFromError(err);
    const message = err instanceof Error ? err.message : 'App AI runtime failed';
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

app.post('/api/deployments', async (req, res) => {
  try {
    const { slug, projectId, title, files } = req.body as {
      slug: string;
      projectId: string;
      title: string;
      files: ProjectFile[];
    };
    const cleanSlug = (slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (cleanSlug.length < 2 || !Array.isArray(files)) {
      res.status(400).json({ error: 'Valid slug and project files are required.' });
      return;
    }

    const { html } = await bundleProjectToHtml({
      files,
      title: title || cleanSlug,
      includeInspector: false,
    });

    const store = readDeploymentsStore();
    const record: StoredDeployment = {
      slug: cleanSlug,
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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Deployment failed' });
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
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(record.htmlBundle);
});

// --- 6. Gemini Live API Voice Chat WebSocket Bridge (/api/voice/live) ---
function setupVoiceLiveWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    if (reqUrl.startsWith('/api/voice/live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const incident = classifyModelError({
        status: 503,
        message: 'Server GEMINI_API_KEY is not configured for voice chat.',
        provider: 'gemini',
        model: 'gemini-3.8-live',
      });
      recordIncident(incident);
      clientWs.send(JSON.stringify({ type: 'error', incident }));
      clientWs.close();
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let isClosed = false;

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction:
            'You are Mist, a sharp, concise AI website builder partner. Help the user brainstorm, structure, and refine their website design through natural spoken conversation. Keep replies crisp, practical, and focused on layout, copy, colors, and features.',
        },
        callbacks: {
          onopen: () => {
            if (!isClosed) {
              clearIncident('gemini', 'gemini-3.8-live');
              clientWs.send(JSON.stringify({ type: 'ready', model: 'gemini-3.8-live' }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (isClosed) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ type: 'inputTranscript', text: content.inputTranscription.text }),
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ type: 'outputTranscript', text: content.outputTranscription.text }),
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ type: 'audio', audio: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ type: 'turnComplete' }));
            }
          },
          onerror: (err: unknown) => {
            if (isClosed) return;
            const msg = err instanceof Error ? err.message : String(err);
            const incident = classifyModelError({
              status: getHttpStatusFromError(err),
              message: msg,
              provider: 'gemini',
              model: 'gemini-3.8-live',
            });
            recordIncident(incident);
            clientWs.send(JSON.stringify({ type: 'error', incident }));
          },
          onclose: () => {
            if (!isClosed) {
              clientWs.send(JSON.stringify({ type: 'closed' }));
            }
          },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to connect to Gemini Live voice API.';
      const incident = classifyModelError({
        status: getHttpStatusFromError(err),
        message: msg,
        provider: 'gemini',
        model: 'gemini-3.8-live',
      });
      recordIncident(incident);
      clientWs.send(JSON.stringify({ type: 'error', incident }));
      clientWs.close();
      return;
    }

    clientWs.on('message', (rawData) => {
      if (isClosed || !liveSession) return;
      try {
        const msg = JSON.parse(rawData.toString()) as { audio?: string; text?: string };
        if (msg.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.text) {
          liveSession.sendRealtimeInput({ text: msg.text });
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    clientWs.on('close', () => {
      isClosed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
    });
  });
}

// --- 7. Vite Dev Middleware / Production Static Serving ---
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
  setupVoiceLiveWebSocket(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Mist server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Mist server:', err);
  process.exit(1);
});
