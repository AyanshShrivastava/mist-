import React, { useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Play,
  Sparkles,
  Terminal,
  Trash2,
} from 'lucide-react';
import type {
  PreviewConsoleEntry,
  PreviewHealthSnapshot,
  TerminalLogEntry,
} from '../../types/mist';

interface WorkspaceTerminalPanelProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  terminalEntries: TerminalLogEntry[];
  consoleEntries: PreviewConsoleEntry[];
  latestSnapshot: PreviewHealthSnapshot | null;
  isRunningCommand: boolean;
  isVerifyingPreview: boolean;
  onRunCommand: (command: string) => void;
  onClearTerminal: () => void;
  onClearConsole: () => void;
  onCaptureSnapshot: () => void;
  onVerifyAndFixPreview: () => void;
  onFixConsoleError: (errSummary: string) => void;
}

type BottomTab = 'terminal' | 'console' | 'preview';

export default function WorkspaceTerminalPanel({
  isOpen,
  onToggleOpen,
  terminalEntries,
  consoleEntries,
  latestSnapshot,
  isRunningCommand,
  isVerifyingPreview,
  onRunCommand,
  onClearTerminal,
  onClearConsole,
  onCaptureSnapshot,
  onVerifyAndFixPreview,
  onFixConsoleError,
}: WorkspaceTerminalPanelProps) {
  const [tab, setTab] = useState<BottomTab>('terminal');
  const [cmdInput, setCmdInput] = useState('');

  const errorCount = consoleEntries.filter(
    (c) => c.level === 'runtime_error' || c.level === 'error',
  ).length;

  const handleSubmitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cmdInput.trim();
    if (!cleaned || isRunningCommand) return;
    onRunCommand(cleaned);
    setCmdInput('');
  };

  return (
    <div className="shrink-0 border-t border-zinc-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0d0d11]">
      {/* Bar Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleOpen}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <Terminal className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
            <span>Mist Sandbox</span>
            {isOpen ? (
              <ChevronDown className="h-3 w-3 text-zinc-400" />
            ) : (
              <ChevronUp className="h-3 w-3 text-zinc-400" />
            )}
          </button>

          <div className="inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => {
                setTab('terminal');
                if (!isOpen) onToggleOpen();
              }}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                tab === 'terminal' && isOpen
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              Terminal ({terminalEntries.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('console');
                if (!isOpen) onToggleOpen();
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                tab === 'console' && isOpen
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              <span>Console</span>
              {errorCount > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 text-[9px] font-bold text-white">
                  {errorCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('preview');
                if (!isOpen) onToggleOpen();
              }}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${
                tab === 'preview' && isOpen
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              Screenshot &amp; DOM
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isRunningCommand}
            onClick={() => {
              setTab('terminal');
              if (!isOpen) onToggleOpen();
              onRunCommand('typecheck');
            }}
            className="hidden sm:inline-flex h-6 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 disabled:opacity-50 cursor-pointer"
          >
            <Play className="h-2.5 w-2.5 text-emerald-500" />
            <span>Typecheck</span>
          </button>

          <button
            type="button"
            disabled={isVerifyingPreview}
            onClick={() => {
              setTab('preview');
              if (!isOpen) onToggleOpen();
              onVerifyAndFixPreview();
            }}
            className="inline-flex h-6 items-center gap-1 rounded-md mist-primary-gradient px-2.5 text-[10px] font-semibold text-white shadow-xs disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="h-2.5 w-2.5" />
            <span>{isVerifyingPreview ? 'Inspecting...' : 'Inspect & Fix Preview'}</span>
          </button>
        </div>
      </div>

      {/* Expandable Body */}
      {isOpen && (
        <div className="h-52 border-t border-zinc-200/70 dark:border-white/[0.06] flex flex-col">
          {tab === 'terminal' && (
            <div className="flex flex-1 flex-col min-h-0">
              <div className="flex items-center justify-between bg-zinc-50 px-3 py-1 text-[10px] text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400 border-b border-zinc-200/60 dark:border-zinc-800/70">
                <span>
                  Mist Isolated Cloud Workspace Terminal · runs <code className="font-mono">typecheck</code>,{' '}
                  <code className="font-mono">build</code>, <code className="font-mono">ls</code>,{' '}
                  <code className="font-mono">cat</code>, <code className="font-mono">grep</code>,{' '}
                  <code className="font-mono">node &lt;file&gt;</code>
                </span>
                <button
                  type="button"
                  onClick={onClearTerminal}
                  className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  <span>Clear</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto bg-[#0b0b0f] p-3 font-mono text-[11px] text-zinc-200 space-y-2.5 mist-scrollbar">
                {terminalEntries.length === 0 ? (
                  <p className="text-zinc-500">
                    No commands executed yet. Mist Agent runs build &amp; TypeScript checks here automatically, or type <code className="text-zinc-300">help</code> below.
                  </p>
                ) : (
                  terminalEntries.map((entry) => (
                    <div key={entry.id} className="space-y-1 border-b border-zinc-800/80 pb-2 last:border-b-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-emerald-400">
                          $ {entry.command}
                        </span>
                        <span
                          className={`text-[10px] ${
                            entry.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          exit {entry.exitCode} · {entry.durationMs}ms · {entry.source}
                        </span>
                      </div>
                      {entry.stdout && (
                        <pre className="whitespace-pre-wrap break-words text-zinc-200 leading-relaxed">
                          {entry.stdout}
                        </pre>
                      )}
                      {entry.stderr && (
                        <pre className="whitespace-pre-wrap break-words text-red-400 leading-relaxed">
                          {entry.stderr}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={handleSubmitCommand}
                className="flex items-center gap-2 border-t border-zinc-800 bg-[#0b0b0f] px-3 py-1.5 font-mono text-xs"
              >
                <span className="text-emerald-400">$</span>
                <input
                  type="text"
                  value={cmdInput}
                  onChange={(e) => setCmdInput(e.target.value)}
                  placeholder="build | typecheck | ls | grep App | help"
                  className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 focus:outline-none text-[11px]"
                />
                <button
                  type="submit"
                  disabled={isRunningCommand || !cmdInput.trim()}
                  className="rounded bg-zinc-800 px-2.5 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 cursor-pointer"
                >
                  {isRunningCommand ? 'Running...' : 'Run'}
                </button>
              </form>
            </div>
          )}

          {tab === 'console' && (
            <div className="flex flex-1 flex-col min-h-0">
              <div className="flex items-center justify-between bg-zinc-50 px-3 py-1 text-[10px] text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400 border-b border-zinc-200/60 dark:border-zinc-800/70">
                <span>Live Preview Console &amp; Runtime Error Stream</span>
                <div className="flex items-center gap-2">
                  {errorCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const errLines = consoleEntries
                          .filter((c) => c.level === 'runtime_error' || c.level === 'error')
                          .slice(-8)
                          .map((c) => `${c.message}${c.source ? ` (${c.source}:${c.line ?? '?'})` : ''}`)
                          .join('\n');
                        onFixConsoleError(errLines);
                      }}
                      className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700 cursor-pointer"
                    >
                      Auto-Fix Errors with AI
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClearConsole}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1.5 mist-scrollbar bg-white dark:bg-[#0b0b0f]">
                {consoleEntries.length === 0 ? (
                  <p className="text-zinc-500">
                    No runtime errors or console warnings captured from live preview.
                  </p>
                ) : (
                  consoleEntries.map((entry) => {
                    const isErr = entry.level === 'runtime_error' || entry.level === 'error';
                    return (
                      <div
                        key={entry.id}
                        className={`rounded-lg px-2.5 py-1.5 border ${
                          isErr
                            ? 'border-red-200 bg-red-50/70 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
                            : entry.level === 'warn'
                              ? 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          {isErr ? (
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          ) : (
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="break-words">{entry.message}</p>
                            {entry.source && (
                              <p className="text-[10px] opacity-75">
                                {entry.source}:{entry.line ?? '?'}:{entry.column ?? '?'}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <div className="flex flex-1 min-h-0 flex-col sm:flex-row gap-3 p-3 overflow-y-auto mist-scrollbar">
              <div className="flex-1 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-950 dark:text-white">
                    Live Preview Visual &amp; DOM Telemetry
                  </span>
                  <button
                    type="button"
                    onClick={onCaptureSnapshot}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Camera className="h-3 w-3" />
                    <span>Take Screenshot</span>
                  </button>
                </div>

                {latestSnapshot ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[10px]">
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
                      <span className="text-zinc-400">Viewport</span>
                      <p className="font-semibold text-zinc-900 dark:text-white">
                        {latestSnapshot.viewportWidth}×{latestSnapshot.viewportHeight}
                      </p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
                      <span className="text-zinc-400">Overflow X</span>
                      <p
                        className={`font-semibold ${
                          latestSnapshot.horizontalOverflowPx > 4
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {latestSnapshot.horizontalOverflowPx}px
                      </p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
                      <span className="text-zinc-400">DOM / Canvas</span>
                      <p className="font-semibold text-zinc-900 dark:text-white">
                        {latestSnapshot.elementCount} els · {latestSnapshot.canvasCount} canvas
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    Click &ldquo;Take Screenshot&rdquo; or &ldquo;Inspect &amp; Fix Preview&rdquo; to capture live DOM health and rendered preview imagery.
                  </p>
                )}
              </div>

              {latestSnapshot?.screenshotDataUrl && (
                <div className="w-full sm:w-56 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950">
                  <img
                    src={latestSnapshot.screenshotDataUrl}
                    alt="Captured live preview snapshot"
                    className="h-36 w-full object-cover object-top"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
