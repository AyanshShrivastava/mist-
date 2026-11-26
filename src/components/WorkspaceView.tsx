import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  Copy,
  Cpu,
  Download,
  Eye,
  Loader2,
  Mic,
  MousePointerClick,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type {
  AiProviderConfig,
  AiStreamProgress,
  MistProject,
  MistUser as User,
  PreviewConsoleEntry,
  PreviewHealthSnapshot,
  SelectedVisualElement,
  TerminalLogEntry,
  ViewportSize,
  VisualElementPatch,
  WebSearchMode,
  WorkspaceViewMode,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import { detectGatewayFromBaseUrl } from '../data/models';
import { sanitizeSlug } from '../utils/projectOps';
import CodeEditor from './CodeEditor';
import { MistMark } from './MistLogo';
import VisualInspector from './VisualInspector';
import WorkspaceHeader from './workspace/WorkspaceHeader';
import WorkspaceChatDrawer from './workspace/WorkspaceChatDrawer';
import WorkspaceFileDrawer from './workspace/WorkspaceFileDrawer';
import WorkspaceTerminalPanel from './workspace/WorkspaceTerminalPanel';
import { useAppAiBridge } from './workspace/useAppAiBridge';

interface WorkspaceViewProps {
  user: User | null;
  project: MistProject;
  providerConfig: AiProviderConfig;
  defaultViewMode?: WorkspaceViewMode;
  defaultViewport?: ViewportSize;
  webSearchMode: WebSearchMode;
  hasWebSearchKey: boolean;
  modelIncident: ModelHealthIncident | null;
  bundledHtml: string;
  bundleError: string | null;
  isBundling: boolean;
  isRefining: boolean;
  streamProgress: AiStreamProgress | null;
  refineError: string | null;
  terminalEntries?: TerminalLogEntry[];
  isRunningTerminal?: boolean;
  isVerifyingPreview?: boolean;
  onRunTerminalCommand?: (command: string) => void;
  onClearTerminal?: () => void;
  onVerifyAndFixPreview?: (
    instruction: string,
    consoleEntries: PreviewConsoleEntry[],
    snapshot: PreviewHealthSnapshot | null,
  ) => void;
  onBackHome: () => void;
  onUpdateProjectName: (name: string) => void;
  onChangeFileContent: (path: string, content: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onCommitVisualPatch: (patch: VisualElementPatch) => void;
  onRefineWithAi: (instruction: string, element?: SelectedVisualElement | null) => void;
  onCancelRefine: () => void;
  onChangeWebSearchMode: (mode: WebSearchMode) => void;
  onOpenVoiceChat: () => void;
  onRebundle: () => void;
  onDuplicateProject: () => void;
  onExportZip: () => void;
  onOpenDeploy: () => void;
  onOpenProviders: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}

const REFINEMENT_SUGGESTIONS = [
  'Refine typography, spacing & micro-interactions',
  'Add an interactive AI helper using /api/app-ai',
  'Optimize mobile layout & responsive navigation',
];

export default function WorkspaceView({
  user,
  project,
  providerConfig,
  defaultViewMode = 'preview',
  defaultViewport = 'desktop',
  webSearchMode,
  hasWebSearchKey,
  modelIncident,
  bundledHtml,
  bundleError,
  isBundling,
  isRefining,
  streamProgress,
  refineError,
  terminalEntries = [],
  isRunningTerminal = false,
  isVerifyingPreview = false,
  onRunTerminalCommand,
  onClearTerminal,
  onVerifyAndFixPreview,
  onBackHome,
  onUpdateProjectName,
  onChangeFileContent,
  onCreateFile,
  onDeleteFile,
  onCommitVisualPatch,
  onRefineWithAi,
  onCancelRefine,
  onChangeWebSearchMode,
  onOpenVoiceChat,
  onRebundle,
  onDuplicateProject,
  onExportZip,
  onOpenDeploy,
  onOpenProviders,
  onOpenSettings,
  onOpenAccount,
}: WorkspaceViewProps) {
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>(defaultViewMode);
  const [viewport, setViewport] = useState<ViewportSize>(defaultViewport);
  const [leftTab, setLeftTab] = useState<'ai' | 'files'>('ai');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const detectedGw = detectGatewayFromBaseUrl(providerConfig.baseUrl);
  const shortProviderLabel =
    providerConfig.name?.trim() ||
    (detectedGw === 'openrouter'
      ? 'OpenRouter'
      : detectedGw === 'groq'
        ? 'Groq'
        : detectedGw === 'gemini_byok'
          ? 'Gemini'
          : detectedGw === 'nvidia'
            ? 'NVIDIA'
            : detectedGw === 'openai'
              ? 'OpenAI'
              : 'Custom');

  const [activeFilePath, setActiveFilePath] = useState<string>(
    project.files.find((f) => f.path === 'src/App.tsx')?.path ||
      project.files[0]?.path ||
      'src/App.tsx',
  );
  const [refineInput, setRefineInput] = useState('');
  const [refineValidationError, setRefineValidationError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedVisualElement | null>(null);
  const [activePane, setActivePane] = useState<'chat' | 'preview'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'preview' : 'chat',
  );
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [refineElapsed, setRefineElapsed] = useState(0);

  const hasAppAi = Boolean(
    project.appAiEnabled ||
      project.files.some((f) => /\/api\/app-ai|window\.mistAI/.test(f.content)),
  );

  const [terminalOpen, setTerminalOpen] = useState(false);
  const autoVerifiedBundleRef = React.useRef<string>('');
  const latestConsoleRef = React.useRef<PreviewConsoleEntry[]>([]);

  const {
    iframeRef,
    consoleEntries,
    clearConsoleEntries,
    latestSnapshot,
    capturePreviewSnapshot,
    syncBridgeToIframe,
    handleLivePreviewPatch,
  } = useAppAiBridge({
    hasAppAi,
    providerConfig,
    user,
    viewMode,
    onSelectElement: (el) => {
      setSelectedElement(el);
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setMobileInspectorOpen(true);
      }
    },
  });

  latestConsoleRef.current = consoleEntries;

  // Automatically inspect newly bundled preview and trigger self-heal if runtime errors or a blank screen appear
  useEffect(() => {
    if (!bundledHtml || isBundling || isRefining || isVerifyingPreview || bundleError) {
      return;
    }
    const bundleKey = `${bundledHtml.length}:${bundledHtml.slice(0, 120)}`;
    if (autoVerifiedBundleRef.current === bundleKey) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const snap = await capturePreviewSnapshot();
      const recentErrors = latestConsoleRef.current.filter(
        (c) => c.level === 'runtime_error' || c.level === 'error',
      );
      const isBlank =
        snap !== null &&
        snap.elementCount === 0 &&
        snap.canvasCount === 0 &&
        !snap.rootHtmlLength;

      autoVerifiedBundleRef.current = bundleKey;

      if ((recentErrors.length > 0 || isBlank) && onVerifyAndFixPreview) {
        setTerminalOpen(true);
        const reason =
          recentErrors.length > 0
            ? `Auto-repair ${recentErrors.length} runtime error(s) detected in live preview.`
            : 'Auto-repair blank preview screen detected after render.';
        onVerifyAndFixPreview(reason, recentErrors, snap);
      }
    }, 1100);

    return () => window.clearTimeout(timer);
  }, [
    bundledHtml,
    isBundling,
    isRefining,
    isVerifyingPreview,
    bundleError,
    capturePreviewSnapshot,
    onVerifyAndFixPreview,
  ]);

  useEffect(() => {
    if (!isRefining || !streamProgress) {
      setRefineElapsed(0);
      return;
    }
    const update = () => {
      setRefineElapsed(Math.max(1, Math.floor((Date.now() - streamProgress.startedAt) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isRefining, streamProgress]);

  useEffect(() => {
    if (!project.files.some((f) => f.path === activeFilePath)) {
      setActiveFilePath(project.files[0]?.path || 'src/App.tsx');
    }
  }, [project.files, activeFilePath]);

  const handleRefineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineInput.trim()) {
      setRefineValidationError('Enter a refinement instruction first.');
      return;
    }
    setRefineValidationError(null);
    onRefineWithAi(refineInput.trim(), selectedElement);
    setRefineInput('');
  };

  const handleOpenFileFromChat = (filePath: string) => {
    const clean = filePath.replace(/^\/+/, '');
    if (project.files.some((f) => f.path === clean)) {
      setActiveFilePath(clean);
      setViewMode((prev) => (prev === 'preview' || prev === 'visual' ? 'split' : prev));
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        setViewMode('code');
        setActivePane('preview');
      }
    }
  };

  const iframeWidthClass =
    viewport === 'mobile'
      ? 'w-[390px]'
      : viewport === 'tablet'
        ? 'w-[768px]'
        : 'w-full';

  const previewHostLabel = `${sanitizeSlug(project.publishedSlug || project.name || 'preview')}.mist-sites.com`;

  const renderPreviewFrame = (compactChrome = false) => (
    <div
      className={`${iframeWidthClass} relative flex h-full max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-lg shadow-zinc-950/5 transition-all duration-200 dark:border-white/[0.08] dark:shadow-black/40`}
    >
      {/* Browser Preview Chrome */}
      {!compactChrome && (
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-zinc-200/80 bg-zinc-50/90 px-3 dark:border-white/[0.06] dark:bg-[#141418]">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </div>

          <div className="flex min-w-0 max-w-md flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-200/80 bg-white px-3 py-1 text-[11px] font-mono text-zinc-500 dark:border-white/[0.07] dark:bg-zinc-900/90 dark:text-zinc-400">
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                bundleError ? 'bg-red-500' : isBundling ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
              }`}
              aria-hidden="true"
            />
            <span className="truncate">
              {viewMode === 'visual' ? 'Visual Inspector · Click any element' : previewHostLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {project.isPublished && project.publishedSlug && (
              <button
                type="button"
                onClick={onOpenDeploy}
                className="hidden sm:inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 cursor-pointer"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                <span>{project.publishedSlug}.zip</span>
              </button>
            )}
            <span className="hidden xl:inline font-mono text-[10px] text-zinc-400">
              {viewport === 'mobile' ? '390px' : viewport === 'tablet' ? '768px' : '100%'}
            </span>
            <button
              type="button"
              onClick={onRebundle}
              aria-label="Rebuild live preview"
              title="Rebuild preview"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${isBundling ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span className="hidden sm:inline">Rebuild</span>
            </button>
          </div>
        </div>
      )}

      {/* Actionable Build Error Banner */}
      {bundleError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-200"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
            <span className="truncate font-mono text-[11px]">{bundleError}</span>
          </div>
          <button
            type="button"
            disabled={isRefining}
            onClick={() => {
              setLeftTab('ai');
              setSidebarCollapsed(false);
              onRefineWithAi(
                `Fix this build error in the project and keep everything else intact:\n${bundleError}`,
              );
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>Fix with AI</span>
          </button>
        </div>
      )}

      {/* Live Iframe Canvas */}
      <div className="relative flex-1 min-h-0 bg-white">
        {isBundling && !bundledHtml ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <MistMark className="h-6 w-6 text-(--mist-c2) animate-pulse" title="Building" />
            <span className="font-medium">Compiling live preview...</span>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            title="Mist Live Website Preview"
            srcDoc={bundledHtml}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            onLoad={syncBridgeToIframe}
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#f4f3ef] text-zinc-950 dark:bg-[#09090b] dark:text-zinc-100">
      <WorkspaceHeader
        user={user}
        project={project}
        viewMode={viewMode}
        viewport={viewport}
        shortProviderLabel={shortProviderLabel}
        providerApiKey={providerConfig.apiKey}
        activePane={activePane}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        onBackHome={onBackHome}
        onUpdateProjectName={onUpdateProjectName}
        onSetViewMode={setViewMode}
        onSetViewport={setViewport}
        onSetActivePane={setActivePane}
        onOpenMobileMore={() => setMobileMoreOpen(true)}
        onOpenVoiceChat={onOpenVoiceChat}
        onOpenProviders={onOpenProviders}
        onDuplicateProject={onDuplicateProject}
        onExportZip={onExportZip}
        onOpenDeploy={onOpenDeploy}
        onOpenSettings={onOpenSettings}
        onOpenAccount={onOpenAccount}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Drawer: AI Refine & Source Files */}
        <aside
          className={`${
            activePane === 'chat'
              ? sidebarCollapsed
                ? 'flex w-full lg:hidden'
                : 'flex w-full lg:w-[320px] xl:w-[360px]'
              : sidebarCollapsed
                ? 'hidden'
                : 'hidden lg:flex lg:w-[320px] xl:w-[360px]'
          } shrink-0 flex-col border-r border-zinc-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0e0e12]`}
        >
          <div className="flex border-b border-zinc-200/80 p-1.5 gap-1 bg-zinc-50/70 dark:border-white/[0.06] dark:bg-zinc-900/40">
            <button
              type="button"
              onClick={() => setLeftTab('ai')}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer ${
                leftTab === 'ai'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              AI Refine
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('files')}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all cursor-pointer ${
                leftTab === 'files'
                  ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              Files ({project.files.length})
            </button>
          </div>

          {leftTab === 'ai' ? (
            <WorkspaceChatDrawer
              project={project}
              isRefining={isRefining}
              streamProgress={streamProgress}
              refineElapsed={refineElapsed}
              refineInput={refineInput}
              refineValidationError={refineValidationError}
              refineError={refineError}
              selectedElement={selectedElement}
              webSearchMode={webSearchMode}
              hasWebSearchKey={hasWebSearchKey}
              modelIncident={modelIncident}
              suggestions={REFINEMENT_SUGGESTIONS}
              onChangeRefineInput={setRefineInput}
              onClearSelectedElement={() => setSelectedElement(null)}
              onChangeWebSearchMode={onChangeWebSearchMode}
              onOpenFile={handleOpenFileFromChat}
              onOpenVoiceChat={onOpenVoiceChat}
              onOpenProviders={onOpenProviders}
              onOpenSettings={onOpenSettings}
              onCancelRefine={onCancelRefine}
              onSubmitRefine={handleRefineSubmit}
            />
          ) : (
            <WorkspaceFileDrawer
              project={project}
              activeFilePath={activeFilePath}
              onSelectFile={(path) => {
                setActiveFilePath(path);
                if (viewMode === 'preview' || viewMode === 'visual') {
                  setViewMode('code');
                }
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setActivePane('preview');
                }
              }}
              onCreateFile={(path) => {
                onCreateFile(path);
                setActiveFilePath(path);
                setViewMode((prev) => (prev === 'preview' ? 'code' : prev));
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setActivePane('preview');
                }
              }}
              onDeleteFile={onDeleteFile}
            />
          )}
        </aside>

        {/* Center Canvas: Preview, Visual, Code, or Split */}
        <main
          className={`${
            activePane === 'chat' ? 'hidden lg:flex' : 'flex'
          } flex-1 min-w-0 flex-col bg-[#f4f3ef] dark:bg-[#09090b]`}
        >
          {/* Mobile/Tablet Canvas Mode Sub-Bar (< lg) */}
          <div className="flex lg:hidden shrink-0 items-center justify-between gap-2 border-b border-zinc-200/80 bg-white/95 px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-[#0e0e12]/95">
            <div
              role="tablist"
              aria-label="Canvas mode"
              className="inline-flex items-center gap-0.5 rounded-xl bg-zinc-100 p-0.5 dark:bg-zinc-900"
            >
              {(
                [
                  { id: 'preview', label: 'Preview', icon: Eye },
                  { id: 'visual', label: 'Visual', icon: MousePointerClick },
                  { id: 'code', label: 'Code', icon: Code2 },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={viewMode === id}
                  type="button"
                  onClick={() => setViewMode(id)}
                  className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    viewMode === id
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {viewMode === 'visual' && (
                <button
                  type="button"
                  onClick={() => setMobileInspectorOpen(true)}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  <span>Inspector</span>
                </button>
              )}
              {viewMode !== 'code' && (
                <button
                  type="button"
                  onClick={onRebundle}
                  aria-label="Rebuild live preview"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isBundling ? 'animate-spin' : ''}`} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {viewMode === 'code' ? (
            <div className="flex flex-1 flex-col min-h-0">
              <CodeEditor
                files={project.files}
                activeFilePath={activeFilePath}
                onSelectFile={setActiveFilePath}
                onChangeFileContent={onChangeFileContent}
              />
            </div>
          ) : viewMode === 'split' ? (
            <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200/80 dark:divide-white/[0.08]">
              <div className="min-h-0 overflow-hidden">
                <CodeEditor
                  files={project.files}
                  activeFilePath={activeFilePath}
                  onSelectFile={setActiveFilePath}
                  onChangeFileContent={onChangeFileContent}
                />
              </div>
              <div className="flex flex-col min-h-0 bg-[#f4f3ef] p-3 dark:bg-[#09090b]">
                {renderPreviewFrame(false)}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 justify-center overflow-hidden p-2.5 sm:p-4">
              {renderPreviewFrame(false)}
            </div>
          )}

          <WorkspaceTerminalPanel
            isOpen={terminalOpen}
            onToggleOpen={() => setTerminalOpen((o) => !o)}
            terminalEntries={terminalEntries}
            consoleEntries={consoleEntries}
            latestSnapshot={latestSnapshot}
            isRunningCommand={isRunningTerminal}
            isVerifyingPreview={isVerifyingPreview}
            onRunCommand={(cmd) => onRunTerminalCommand?.(cmd)}
            onClearTerminal={() => onClearTerminal?.()}
            onClearConsole={clearConsoleEntries}
            onCaptureSnapshot={() => void capturePreviewSnapshot()}
            onVerifyAndFixPreview={() => {
              void capturePreviewSnapshot().then((snap) => {
                onVerifyAndFixPreview?.(
                  'Inspect the live preview screenshot, DOM health, and console output; fix any visual defects, layout overlaps, broken states, or console errors.',
                  latestConsoleRef.current,
                  snap,
                );
              });
            }}
            onFixConsoleError={(errSummary) => {
              void capturePreviewSnapshot().then((snap) => {
                onVerifyAndFixPreview?.(
                  `Fix this runtime/console error reported in the live preview:\n${errSummary}`,
                  latestConsoleRef.current,
                  snap,
                );
              });
            }}
          />
        </main>

        {/* Desktop Right Visual Inspector Rail */}
        {viewMode === 'visual' && (
          <aside className="hidden lg:block w-72 xl:w-80 shrink-0 border-l border-zinc-200/80 bg-white dark:border-white/[0.08] dark:bg-[#0e0e12]">
            <VisualInspector
              selectedElement={selectedElement}
              onLivePreviewPatch={handleLivePreviewPatch}
              onCommitPatch={onCommitVisualPatch}
              onAskAiAboutElement={(el) => {
                setSelectedElement(el);
                setLeftTab('ai');
                setSidebarCollapsed(false);
                setActivePane('chat');
                setRefineInput(`Update the <${el.tagName}> "${el.textContent.slice(0, 40)}" to `);
              }}
            />
          </aside>
        )}

        {/* Mobile/Tablet Visual Inspector Sheet (< lg) */}
        <AnimatePresence>
          {viewMode === 'visual' && mobileInspectorOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileInspectorOpen(false)}
              className="fixed inset-0 z-40 flex flex-col justify-end bg-black/55 backdrop-blur-xs lg:hidden"
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="h-[74vh] w-full rounded-t-3xl border-t border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0e0e12] flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <span className="font-display text-xs font-semibold text-zinc-950 dark:text-white">
                    Visual Inspector
                  </span>
                  <button
                    type="button"
                    aria-label="Close inspector sheet"
                    onClick={() => setMobileInspectorOpen(false)}
                    className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <VisualInspector
                    selectedElement={selectedElement}
                    onLivePreviewPatch={handleLivePreviewPatch}
                    onCommitPatch={onCommitVisualPatch}
                    onAskAiAboutElement={(el) => {
                      setSelectedElement(el);
                      setMobileInspectorOpen(false);
                      setActivePane('chat');
                      setLeftTab('ai');
                      setRefineInput(`Update the <${el.tagName}> "${el.textContent.slice(0, 40)}" to `);
                    }}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile/Tablet Workspace Actions Sheet (< lg) */}
        <AnimatePresence>
          {mobileMoreOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMoreOpen(false)}
              className="fixed inset-0 z-40 flex items-end bg-black/55 backdrop-blur-xs lg:hidden"
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded-t-3xl border-t border-zinc-200 bg-white p-4 pb-7 shadow-2xl dark:border-zinc-800 dark:bg-[#111115]"
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-zinc-950 dark:text-white">
                    Workspace Actions
                  </span>
                  <button
                    type="button"
                    aria-label="Close workspace actions"
                    onClick={() => setMobileMoreOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onBackHome();
                    }}
                    className="col-span-2 flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4 text-(--mist-c2)" aria-hidden="true" />
                    <span>Back to Studio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenVoiceChat();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Mic className="h-4 w-4 text-(--mist-c2)" aria-hidden="true" />
                    <span>Voice Studio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenProviders();
                    }}
                    className="flex min-h-[46px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Cpu className="h-4 w-4 text-(--mist-c2) shrink-0" aria-hidden="true" />
                    <span className="truncate">{shortProviderLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onExportZip();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Export ZIP</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onDuplicateProject();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span>Duplicate</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenSettings();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    <span>Settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenAccount();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <UserIcon className="h-4 w-4" aria-hidden="true" />
                    <span>Account</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
