import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as esbuild from 'esbuild';
import type { ProjectFile, TerminalLogEntry } from '../types/mist';
import { createSafeId, inferLanguageFromPath, normalizeProjectFilePath } from './projectOps';
import { redactSecrets } from './aiErrors';
import { SecurityValidationError, validateProjectFilesPayload } from './serverSecurity';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 32_000;
const COMMAND_TIMEOUT_MS = 12_000;
const LINKED_SANDBOX_PACKAGES = [
  'react',
  'react-dom',
  'lucide-react',
  'three',
  '@types/react',
  '@types/react-dom',
  '@types/three',
];

export interface SandboxExecutionResult extends TerminalLogEntry {
  truncated?: boolean;
}

export interface SandboxBuildBundleFn {
  (files: ProjectFile[]): Promise<{ html: string; bundleError: string | null }>;
}

function truncateOutput(text: string): { value: string; truncated: boolean } {
  const clean = redactSecrets(text || '');
  if (clean.length <= MAX_OUTPUT_CHARS) {
    return { value: clean, truncated: false };
  }
  return {
    value: `${clean.slice(0, MAX_OUTPUT_CHARS)}\n... [output truncated at ${MAX_OUTPUT_CHARS} chars]`,
    truncated: true,
  };
}

function assertContainedSandboxPath(rootDir: string, relativePath: string): string {
  const normalized = normalizeProjectFilePath(relativePath);
  if (!normalized || normalized.includes('..') || normalized.includes('\0') || path.isAbsolute(normalized)) {
    throw new SecurityValidationError(400, `Unsafe sandbox path "${relativePath}".`, 'UNSAFE_PATH');
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, normalized);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new SecurityValidationError(400, `Path escapes sandbox boundary: "${relativePath}".`, 'UNSAFE_PATH');
  }
  return resolvedTarget;
}

function buildScrubbedEnv(sandboxDir: string): NodeJS.ProcessEnv {
  const nodeBinDir = path.dirname(process.execPath);
  return {
    PATH: `${nodeBinDir}:/usr/local/bin:/usr/bin:/bin`,
    HOME: sandboxDir,
    TMPDIR: sandboxDir,
    NODE_ENV: 'production',
    LANG: 'en_US.UTF-8',
  };
}

function symlinkSandboxDependencies(sandboxDir: string): void {
  const hostNodeModules = path.resolve(process.cwd(), 'node_modules');
  const sandboxNodeModules = path.join(sandboxDir, 'node_modules');
  fs.mkdirSync(sandboxNodeModules, { recursive: true });

  for (const pkg of LINKED_SANDBOX_PACKAGES) {
    const src = path.join(hostNodeModules, pkg);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(sandboxNodeModules, pkg);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
      fs.symlinkSync(src, dst, 'dir');
    } catch {
      // Ignore if already linked
    }
  }
}

export async function withProjectSandbox<T>(
  files: ProjectFile[],
  fn: (sandboxDir: string, validatedFiles: ProjectFile[]) => Promise<T>,
): Promise<T> {
  const validatedFiles = validateProjectFilesPayload(files);
  const sandboxDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mist-sandbox-')));
  try {
    for (const file of validatedFiles) {
      const targetPath = assertContainedSandboxPath(sandboxDir, file.path);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, file.content, 'utf8');
    }

    symlinkSandboxDependencies(sandboxDir);

    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: false,
        noImplicitAny: false,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        isolatedModules: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      },
      include: ['src/**/*', '*.ts', '*.tsx'],
    };
    fs.writeFileSync(path.join(sandboxDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf8');

    // Provide minimal Mist runtime ambient declarations so window.mistAI typechecks cleanly
    const ambientPath = path.join(sandboxDir, 'src', 'mist-env.d.ts');
    fs.mkdirSync(path.dirname(ambientPath), { recursive: true });
    if (!fs.existsSync(ambientPath)) {
      fs.writeFileSync(
        ambientPath,
        `interface MistAiClient {
  isEnabled: () => boolean;
  complete: (prompt: string, options?: { messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; systemInstruction?: string; jsonMode?: boolean }) => Promise<string>;
  chat: (messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, systemInstruction?: string) => Promise<string>;
}
interface Window {
  mistAI?: MistAiClient;
}
`,
        'utf8',
      );
    }

    return await fn(sandboxDir, validatedFiles);
  } finally {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup
    }
  }
}

export async function runSandboxTypecheck(files: ProjectFile[]): Promise<{
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const startedAt = Date.now();
  return withProjectSandbox(files, async (sandboxDir) => {
    const tscBin = path.resolve(process.cwd(), 'node_modules/typescript/bin/tsc');
    if (!fs.existsSync(tscBin)) {
      return {
        ok: true,
        exitCode: 0,
        stdout: 'TypeScript compiler binary not present; skipping static tsc pass.',
        stderr: '',
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [tscBin, '-p', path.join(sandboxDir, 'tsconfig.json'), '--noEmit', '--pretty', 'false'],
        {
          cwd: sandboxDir,
          env: buildScrubbedEnv(sandboxDir),
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 512 * 1024,
        },
      );
      return {
        ok: true,
        exitCode: 0,
        stdout: stdout.trim() || '0 TypeScript errors.',
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      const combinedOut = String(e.stdout || '').replaceAll(sandboxDir + path.sep, '');
      const combinedErr = String(e.stderr || e.message || '').replaceAll(sandboxDir + path.sep, '');
      return {
        ok: false,
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: combinedOut.trim(),
        stderr: combinedErr.trim(),
        durationMs: Date.now() - startedAt,
      };
    }
  });
}

function tokenizeSimpleCommand(rawCommand: string): string[] {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    throw new SecurityValidationError(400, 'Terminal command cannot be empty.');
  }
  if (trimmed.length > 512) {
    throw new SecurityValidationError(400, 'Terminal command exceeds 512 characters.');
  }
  if (/[;&|`$<>]/.test(trimmed)) {
    throw new SecurityValidationError(
      400,
      'Shell chaining and redirection operators (;, &, |, `, $, <, >) are disabled in Mist sandbox terminal.',
      'SANDBOX_POLICY',
    );
  }
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

export async function executeSandboxTerminalCommand(params: {
  files: ProjectFile[];
  command: string;
  source?: 'agent' | 'user' | 'auto_verify';
  runBundle?: SandboxBuildBundleFn;
}): Promise<SandboxExecutionResult> {
  const startedAt = Date.now();
  const source = params.source || 'agent';
  const rawCmd = (params.command || '').trim();
  const tokens = tokenizeSimpleCommand(rawCmd);
  const head = (tokens[0] || '').toLowerCase();
  const rest = tokens.slice(1);

  const finalize = (stdout: string, stderr: string, exitCode: number): SandboxExecutionResult => {
    const out = truncateOutput(stdout);
    const err = truncateOutput(stderr);
    return {
      id: createSafeId('term'),
      command: rawCmd,
      cwd: '/mist-project',
      stdout: out.value,
      stderr: err.value,
      exitCode,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      source,
      truncated: out.truncated || err.truncated,
    };
  };

  // Normalize npm/npx shortcuts into sandboxed commands
  let canonical = head;
  let args = rest;
  if (head === 'npm' && rest[0] === 'run' && rest[1]) {
    canonical = rest[1].toLowerCase();
    args = rest.slice(2);
  } else if (head === 'npx' && rest[0]) {
    canonical = rest[0].toLowerCase();
    args = rest.slice(1);
  } else if (head === 'help') {
    return finalize(
      [
        'Mist Isolated Project Terminal — Supported Commands:',
        '  typecheck | tsc       Run strict TypeScript compiler checks across project files',
        '  build | verify        Run TypeScript check + production esbuild & Tailwind v4 bundle',
        '  ls [prefix]           List project files and line counts',
        '  cat <path>            Print file contents with line numbers',
        '  grep <pattern> [path] Search project files (regex or plain text)',
        '  wc [path]             Count lines and characters in project files',
        '  node <script.ts|js>   Execute a self-contained script inside isolated project sandbox',
      ].join('\n'),
      '',
      0,
    );
  }

  const validatedFiles = validateProjectFilesPayload(params.files);

  if (canonical === 'tsc' || canonical === 'typecheck') {
    const tscRes = await runSandboxTypecheck(validatedFiles);
    return finalize(tscRes.stdout, tscRes.stderr, tscRes.exitCode);
  }

  if (canonical === 'build' || canonical === 'verify') {
    const tscRes = await runSandboxTypecheck(validatedFiles);
    let bundleOut = '';
    let bundleErr = '';
    let exitCode = tscRes.exitCode;
    if (params.runBundle) {
      const b = await params.runBundle(validatedFiles);
      if (b.bundleError) {
        bundleErr = `esbuild bundle error:\n${b.bundleError}`;
        exitCode = exitCode === 0 ? 1 : exitCode;
      } else {
        bundleOut = `Bundled successfully (${Math.round(b.html.length / 1024)} KB standalone preview).`;
      }
    }
    const combinedStdout = [tscRes.stdout, bundleOut].filter(Boolean).join('\n');
    const combinedStderr = [tscRes.stderr, bundleErr].filter(Boolean).join('\n');
    return finalize(combinedStdout, combinedStderr, exitCode);
  }

  if (canonical === 'ls') {
    const prefix = args[0] ? normalizeProjectFilePath(args[0]) : '';
    const matching = validatedFiles
      .filter((f) => !prefix || f.path.startsWith(prefix))
      .map((f) => {
        const lines = f.content.split('\n').length;
        return `${f.path.padEnd(36)} ${String(lines).padStart(4)} lines  ${String(f.content.length).padStart(6)} bytes`;
      });
    if (matching.length === 0) {
      return finalize('', `No files matching prefix "${prefix}"`, 1);
    }
    return finalize(matching.join('\n'), '', 0);
  }

  if (canonical === 'cat' || canonical === 'head') {
    if (!args[0]) {
      return finalize('', `Usage: ${canonical} <file-path>`, 1);
    }
    const clean = normalizeProjectFilePath(args[0]);
    const file = validatedFiles.find((f) => f.path.toLowerCase() === clean.toLowerCase());
    if (!file) {
      return finalize('', `File not found in project sandbox: ${clean}`, 1);
    }
    const allLines = file.content.split('\n');
    const slice = canonical === 'head' ? allLines.slice(0, 80) : allLines;
    const numbered = slice.map((line, i) => `${String(i + 1).padStart(4)} | ${line}`).join('\n');
    return finalize(numbered, '', 0);
  }

  if (canonical === 'wc') {
    const target = args[0] ? normalizeProjectFilePath(args[0]) : '';
    const subset = target
      ? validatedFiles.filter((f) => f.path.toLowerCase() === target.toLowerCase())
      : validatedFiles;
    if (subset.length === 0) {
      return finalize('', `File not found: ${target}`, 1);
    }
    const lines = subset.map((f) => {
      const l = f.content.split('\n').length;
      const w = f.content.trim() ? f.content.trim().split(/\s+/).length : 0;
      return `${String(l).padStart(6)} ${String(w).padStart(7)} ${String(f.content.length).padStart(8)} ${f.path}`;
    });
    return finalize(lines.join('\n'), '', 0);
  }

  if (canonical === 'grep') {
    if (!args[0]) {
      return finalize('', 'Usage: grep <pattern> [file-path]', 1);
    }
    let pattern: RegExp;
    try {
      pattern = new RegExp(args[0], 'i');
    } catch {
      const esc = args[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pattern = new RegExp(esc, 'i');
    }
    const filterPath = args[1] ? normalizeProjectFilePath(args[1]).toLowerCase() : '';
    const hits: string[] = [];
    for (const file of validatedFiles) {
      if (filterPath && !file.path.toLowerCase().includes(filterPath)) continue;
      const fileLines = file.content.split('\n');
      for (let idx = 0; idx < fileLines.length; idx++) {
        if (pattern.test(fileLines[idx])) {
          hits.push(`${file.path}:${idx + 1}: ${fileLines[idx].trim().slice(0, 200)}`);
          if (hits.length >= 120) break;
        }
      }
      if (hits.length >= 120) break;
    }
    return finalize(hits.length > 0 ? hits.join('\n') : '(no matches)', '', hits.length > 0 ? 0 : 1);
  }

  if (canonical === 'node') {
    if (!args[0]) {
      return finalize('', 'Usage: node <sandbox-file-path>', 1);
    }
    const cleanTarget = normalizeProjectFilePath(args[0]);
    const file = validatedFiles.find((f) => f.path.toLowerCase() === cleanTarget.toLowerCase());
    if (!file) {
      return finalize('', `Script not found in project sandbox: ${cleanTarget}`, 1);
    }
    return withProjectSandbox(validatedFiles, async (sandboxDir) => {
      try {
        const entryFile = assertContainedSandboxPath(sandboxDir, file.path);
        const compiledOut = path.join(sandboxDir, '.mist-run-entry.mjs');
        await esbuild.build({
          entryPoints: [entryFile],
          outfile: compiledOut,
          bundle: true,
          platform: 'node',
          format: 'esm',
          external: ['react', 'react-dom', 'three', 'lucide-react'],
        });
        const nodeArgs = [
          '--no-warnings',
          ...(process.versions.node.startsWith('20.') || Number(process.versions.node.split('.')[0]) >= 20
            ? [
                '--experimental-permission',
                `--allow-fs-read=${sandboxDir}`,
                `--allow-fs-write=${sandboxDir}`,
              ]
            : []),
          compiledOut,
        ];
        const { stdout, stderr } = await execFileAsync(process.execPath, nodeArgs, {
          cwd: sandboxDir,
          env: buildScrubbedEnv(sandboxDir),
          timeout: 5_000,
          maxBuffer: 256 * 1024,
        });
        return finalize(stdout, stderr, 0);
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        return finalize(
          String(e.stdout || '').replaceAll(sandboxDir + path.sep, ''),
          String(e.stderr || e.message || 'Execution failed').replaceAll(sandboxDir + path.sep, ''),
          typeof e.code === 'number' ? e.code : 1,
        );
      }
    });
  }

  return finalize(
    '',
    `Unsupported sandbox command "${rawCmd}". Run "help" to list Mist isolated terminal commands (typecheck, build, ls, cat, grep, wc, node).`,
    127,
  );
}

/**
 * Shared project VFS operations used by Mist's agent builder tools.
 */
export function applyVfsEditFile(params: {
  files: ProjectFile[];
  path: string;
  target: string;
  replacement: string;
}): { files: ProjectFile[]; changedPath: string; replacements: number } {
  const cleanPath = normalizeProjectFilePath(params.path);
  const existing = params.files.find((f) => f.path.toLowerCase() === cleanPath.toLowerCase());
  if (!existing) {
    throw new Error(`Cannot edit "${cleanPath}": file does not exist. Use list_files or write_file.`);
  }
  if (!params.target) {
    throw new Error('edit_file requires a non-empty target string.');
  }
  if (!existing.content.includes(params.target)) {
    throw new Error(
      `Target snippet not found in "${existing.path}". Call read_file to inspect exact lines before editing.`,
    );
  }
  const occurrences = existing.content.split(params.target).length - 1;
  if (occurrences > 1) {
    throw new Error(
      `Target snippet matched ${occurrences} locations in "${existing.path}". Provide more surrounding context so the edit is unambiguous.`,
    );
  }
  const updatedContent = existing.content.replace(params.target, params.replacement);
  const nextFiles = validateProjectFilesPayload(
    params.files.map((f) => (f.path === existing.path ? { ...f, content: updatedContent } : f)),
  );
  return {
    files: nextFiles,
    changedPath: existing.path,
    replacements: 1,
  };
}

export function applyVfsWriteFile(params: {
  files: ProjectFile[];
  path: string;
  content: string;
}): { files: ProjectFile[]; changedPath: string } {
  const cleanPath = normalizeProjectFilePath(params.path);
  const language = inferLanguageFromPath(cleanPath);
  const existingIdx = params.files.findIndex((f) => f.path.toLowerCase() === cleanPath.toLowerCase());
  const nextRaw =
    existingIdx >= 0
      ? params.files.map((f, idx) =>
          idx === existingIdx ? { ...f, path: cleanPath, language, content: params.content } : f,
        )
      : [
          ...params.files,
          {
            id: createSafeId('file'),
            path: cleanPath,
            language,
            content: params.content,
          },
        ];
  const validated = validateProjectFilesPayload(nextRaw);
  return { files: validated, changedPath: cleanPath };
}
