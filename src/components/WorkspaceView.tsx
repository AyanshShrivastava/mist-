import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  Columns2,
  Copy,
  Cpu,
  Download,
  Eye,
  FileCode2,
  FolderTree,
  Globe,
  Loader2,
  MessageSquare,
  Mic,
  Monitor,
  MoreHorizontal,
  MousePointerClick,
  Plus,
  RefreshCw,
  Send,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  MistProject,
  SelectedVisualElement,
  ViewportSize,
  VisualElementPatch,
  WorkspaceViewMode,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import CodeEditor from './CodeEditor';
import VisualInspector from './VisualInspector';
import MistLogo from './MistLogo';

interface WorkspaceViewProps {
  project: MistProject;
  user: User | null;
  providerConfig: AiProviderConfig;
  defaultViewMode?: WorkspaceViewMode;
  defaultViewport?: ViewportSize;
  modelIncident: ModelHealthIncident | null;
  bundledHtml: string;
  bundleError: string | null;
  isBundling: boolean;
  isRefining: boolean;
  refineError: string | null;
  isSavingCloud: boolean;
  onBackHome: () => void;
  onUpdateProjectName: (name: string) => void;
  onChangeFileContent: (path: string, content: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onCommitVisualPatch: (patch: VisualElementPatch) => void;
  onRefineWithAi: (instruction: string, element?: SelectedVisualElement | null) => void;
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
  'Make the navbar smaller',
  'Add a live AI assistant using POST /api/app-ai',
  'Polish mobile responsiveness & spacing',
];

export default function WorkspaceView({
  project,
  user: _user,
  providerConfig,
  defaultViewMode = 'preview',
  defaultViewport = 'desktop',
  modelIncident,
  bundledHtml,
  bundleError,
  isBundling,
  isRefining,
  refineError,
  isSavingCloud,
  onBackHome,
  onUpdateProjectName,
  onChangeFileContent,
  onCreateFile,
  onDeleteFile,
  onCommitVisualPatch,
  onRefineWithAi,
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
  const [activeFilePath, setActiveFilePath] = useState<string>(
    project.files.find((f) => f.path === 'src/App.tsx')?.path || project.files[0]?.path || 'src/App.tsx',
  );
  const [refineInput, setRefineInput] = useState('');
  const [refineValidationError, setRefineValidationError] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedVisualElement | null>(null);
  const [newFilePath, setNewFilePath] = useState('');
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [titleSavedToast, setTitleSavedToast] = useState(false);
  const [mobilePane, setMobilePane] = useState<'preview' | 'ai' | 'visual' | 'code'>(
    defaultViewMode === 'visual'
      ? 'visual'
      : defaultViewMode === 'code'
        ? 'code'
        : 'preview',
  );
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!project.files.some((f) => f.path === activeFilePath)) {
      setActiveFilePath(project.files[0]?.path || 'src/App.tsx');
    }
  }, [project.files, activeFilePath]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'MIST_SELECT_ELEMENT') {
        setSelectedElement(event.data.payload as SelectedVisualElement);
        if (window.innerWidth < 768) {
          setMobileInspectorOpen(true);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage(
        { type: 'MIST_TOGGLE_INSPECTOR', enabled: viewMode === 'visual' },
        '*',
      );
    }
  }, [viewMode, bundledHtml]);

  const handleIframeLoad = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage(
        { type: 'MIST_TOGGLE_INSPECTOR', enabled: viewMode === 'visual' },
        '*',
      );
    }
  };

  const handleLivePreviewPatch = (patch: VisualElementPatch) => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: 'MIST_LIVE_PATCH', payload: patch }, '*');
    }
  };

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

  const handleAddFile = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFilePath.trim().replace(/^\/+/, '');
    if (!cleaned || !cleaned.includes('.')) {
      setNewFileError('Enter a valid path such as src/components/Footer.tsx');
      return;
    }
    if (project.files.some((f) => f.path === cleaned)) {
      setNewFileError('A file with that path already exists.');
      return;
    }
    setNewFileError(null);
    onCreateFile(cleaned);
    setActiveFilePath(cleaned);
    setNewFilePath('');
    setShowNewFileInput(false);
    setViewMode((prev) => (prev === 'preview' ? 'code' : prev));
  };

  const iframeWidthClass =
    viewport === 'mobile'
      ? 'w-[390px]'
      : viewport === 'tablet'
        ? 'w-[768px]'
        : 'w-full';

  const handleSelectMobilePane = (pane: 'preview' | 'ai' | 'visual' | 'code') => {
    setMobilePane(pane);
    if (pane === 'preview') setViewMode('preview');
    if (pane === 'visual') setViewMode('visual');
    if (pane === 'code') setViewMode('code');
  };

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#FAFAFA] text-zinc-950 dark:bg-[#09090B] dark:text-zinc-100">
      {/* Compact Mobile Top App Bar (< md) */}
      <header className="flex md:hidden h-13 shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white/95 px-2.5 backdrop-blur-md dark:border-zinc-800 dark:bg-[#0F0F12]/95">
        <button
          type="button"
          onClick={onBackHome}
          aria-label="Back to Mist Home"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800 shrink-0 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <MistLogo size="xs" showWordmark={false} />
        </button>

        <input
          type="text"
          aria-label="Mobile project name"
          value={project.name}
          onChange={(e) => onUpdateProjectName(e.target.value)}
          className="min-w-0 flex-1 truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-center font-display text-sm font-semibold text-zinc-950 focus:border-blue-500 focus:bg-white focus:outline-none dark:text-white dark:focus:bg-zinc-900"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenDeploy}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{project.isPublished ? 'Live' : 'Deploy'}</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMoreOpen(true)}
            aria-label="Open workspace actions"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Default Desktop Studio Top Bar (>= md) */}
      <header className="hidden md:flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-[#0F0F12]">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            aria-label="Back to Mist Home"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <MistLogo size="xs" showWordmark={false} />
            <span className="font-display font-bold text-black dark:text-white">Mist</span>
          </button>

          <span className="text-zinc-300 dark:text-zinc-700">/</span>

          <input
            type="text"
            aria-label="Project name"
            value={project.name}
            onChange={(e) => onUpdateProjectName(e.target.value)}
            onBlur={() => {
              setTitleSavedToast(true);
              setTimeout(() => setTitleSavedToast(false), 1200);
            }}
            className="w-24 sm:w-48 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 font-display text-xs sm:text-sm font-semibold text-zinc-950 hover:border-zinc-200 focus:border-blue-500 focus:bg-white focus:outline-none dark:text-white dark:hover:border-zinc-700 dark:focus:bg-zinc-900"
          />

          {isSavingCloud && (
            <span className="hidden xl:inline text-[11px] text-zinc-400 whitespace-nowrap">
              Syncing...
            </span>
          )}
          {titleSavedToast && !isSavingCloud && (
            <span className="hidden xl:inline text-[11px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              Saved
            </span>
          )}
        </div>

        {/* Center View Mode Switcher */}
        <div
          role="tablist"
          aria-label="Workspace view mode"
          className="flex items-center gap-0.5 sm:gap-1 rounded-lg bg-zinc-100 p-0.5 sm:p-1 dark:bg-zinc-900"
        >
          {(
            [
              { id: 'preview', label: 'Preview', icon: Eye },
              { id: 'visual', label: 'Visual', icon: MousePointerClick },
              { id: 'code', label: 'Code', icon: Code2 },
              { id: 'split', label: 'Split', icon: Columns2 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={viewMode === id}
              aria-label={label}
              type="button"
              onClick={() => {
                setViewMode(id);
                if (id !== 'split') setMobilePane(id);
              }}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === id
                  ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white'
                  : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {viewMode !== 'code' && (
            <div className="hidden xl:flex items-center gap-0.5 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
              {(
                [
                  { id: 'desktop', icon: Monitor, label: 'Desktop viewport' },
                  { id: 'tablet', icon: Tablet, label: 'Tablet viewport' },
                  { id: 'mobile', icon: Smartphone, label: 'Mobile viewport' },
                ] as const
              ).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  onClick={() => setViewport(id)}
                  className={`rounded-md p-1.5 transition-colors cursor-pointer ${
                    viewport === id
                      ? 'bg-zinc-900 text-white dark:bg-zinc-700'
                      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onOpenVoiceChat}
            aria-label="Open voice refinement studio"
            className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
            <span className="hidden lg:inline">Voice</span>
          </button>

          <button
            type="button"
            onClick={onOpenProviders}
            aria-label="Configure AI models"
            className="hidden md:inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Cpu className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
            <span className="capitalize">{providerConfig.provider}</span>
          </button>

          <button
            type="button"
            onClick={onDuplicateProject}
            aria-label="Duplicate project"
            className="hidden lg:inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Duplicate</span>
          </button>

          <button
            type="button"
            onClick={onExportZip}
            aria-label="Export ZIP"
            className="inline-flex h-9 sm:h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 sm:px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Export ZIP</span>
          </button>

          <button
            type="button"
            onClick={onOpenDeploy}
            className="inline-flex h-9 sm:h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 sm:px-3.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{project.isPublished ? 'Published' : 'Deploy'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open Studio Settings"
            className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenAccount}
            aria-label="Account profile"
            className="hidden sm:inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors shrink-0 cursor-pointer"
          >
            <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Main Body: Mobile switches clean single panes; Desktop (>= md) shows default 3-Pane IDE */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden pb-16 md:pb-0">
        {/* Left Sidebar (Full-screen AI/Files pane on mobile when selected, fixed 320px rail on desktop) */}
        <aside
          className={`${
            mobilePane === 'ai' ? 'flex w-full' : 'hidden'
          } md:flex md:w-80 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#0F0F12]`}
        >
          <div className="flex border-b border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setLeftTab('ai')}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                leftTab === 'ai'
                  ? 'border-blue-600 text-zinc-950 dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
              }`}
            >
              AI Refine
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('files')}
              className={`flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                leftTab === 'files'
                  ? 'border-blue-600 text-zinc-950 dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
              }`}
            >
              Files ({project.files.length})
            </button>
          </div>

          {leftTab === 'ai' ? (
            <div className="flex flex-1 flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-4 space-y-3 mist-scrollbar">
                {project.chatHistory.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className={`rounded-xl p-3 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800/90 dark:text-zinc-100'
                        : 'border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                    }`}
                  >
                    <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                      {msg.role === 'user' ? 'You' : 'Mist'}
                    </p>
                    <p>{msg.content}</p>
                    {msg.changedFiles && msg.changedFiles.length > 0 && (
                      <p className="mt-2 font-mono text-[11px] text-blue-600 dark:text-blue-400">
                        Updated: {msg.changedFiles.join(', ')}
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>

              {modelIncident && (
                <div
                  role="alert"
                  className="mx-3 mb-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{modelIncident.title}</p>
                      <button
                        type="button"
                        onClick={onOpenProviders}
                        className="mt-1 font-medium text-amber-800 underline dark:text-amber-300 cursor-pointer"
                      >
                        Switch Model
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Refinement Chips */}
              <div className="border-t border-zinc-100 px-3 pt-3 pb-1 dark:border-zinc-800">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                  Quick refinements
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {REFINEMENT_SUGGESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setRefineInput(item)}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleRefineSubmit}
                className="border-t border-zinc-200 p-3 dark:border-zinc-800"
              >
                {selectedElement && (
                  <div className="mb-2 flex items-center justify-between rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                    <span className="truncate font-mono">
                      Target: &lt;{selectedElement.tagName}&gt;
                    </span>
                    <button
                      type="button"
                      aria-label="Clear selected element"
                      onClick={() => setSelectedElement(null)}
                      className="ml-2 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}

                {(refineValidationError || refineError) && (
                  <p role="alert" className="mb-2 text-[11px] font-medium text-red-600 dark:text-red-400">
                    {refineValidationError || refineError}
                  </p>
                )}

                <label htmlFor="mist-refine-input" className="sr-only">
                  Refine website with AI
                </label>
                <div className="flex items-end gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-2 focus-within:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900">
                  <textarea
                    id="mist-refine-input"
                    rows={2}
                    value={refineInput}
                    onChange={(e) => {
                      setRefineInput(e.target.value);
                      if (refineValidationError) setRefineValidationError(null);
                    }}
                    placeholder='e.g. "Make the navbar smaller"'
                    className="flex-1 resize-none bg-transparent text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={onOpenVoiceChat}
                    aria-label="Voice refine with Mist"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                  >
                    <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  </button>
                  <button
                    type="submit"
                    disabled={isRefining}
                    aria-label="Apply AI refinement"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex flex-1 flex-col min-h-0">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Source Tree</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowNewFileInput((v) => !v)}
                  aria-label="Create new source file"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 cursor-pointer"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>New File</span>
                </button>
              </div>

              {showNewFileInput && (
                <form
                  onSubmit={handleAddFile}
                  className="border-b border-zinc-200 bg-zinc-50 p-3 space-y-2 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <input
                    type="text"
                    aria-label="New file path"
                    value={newFilePath}
                    onChange={(e) => setNewFilePath(e.target.value)}
                    placeholder="src/components/Footer.tsx"
                    className="w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  {newFileError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{newFileError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewFileInput(false)}
                      className="rounded px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </form>
              )}

              <div className="flex-1 overflow-y-auto p-2 space-y-0.5 mist-scrollbar">
                {project.files.map((file) => {
                  const isActive = file.path === activeFilePath;
                  const canDelete = file.path !== 'src/App.tsx' && file.path !== 'src/index.css';
                  return (
                    <div
                      key={file.id}
                      className={`group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-mono ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFilePath(file.path);
                          setMobilePane('code');
                          if (viewMode === 'preview' || viewMode === 'visual') {
                            setViewMode('code');
                          }
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                      >
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                        <span className="truncate">{file.path}</span>
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          aria-label={`Delete ${file.path}`}
                          onClick={() => onDeleteFile(file.path)}
                          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-600 transition-opacity cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* Center Canvas: Preview, Visual, Code, or Split */}
        <main
          className={`${
            mobilePane === 'ai' ? 'hidden md:flex' : 'flex'
          } flex-1 min-w-0 flex-col bg-zinc-100 dark:bg-zinc-950`}
        >
          {viewMode === 'code' ? (
            <CodeEditor
              files={project.files}
              activeFilePath={activeFilePath}
              onSelectFile={setActiveFilePath}
              onChangeFileContent={onChangeFileContent}
            />
          ) : viewMode === 'split' ? (
            <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-800">
              <div className="min-h-0 overflow-hidden">
                <CodeEditor
                  files={project.files}
                  activeFilePath={activeFilePath}
                  onSelectFile={setActiveFilePath}
                  onChangeFileContent={onChangeFileContent}
                />
              </div>
              <div className="flex flex-col min-h-0 bg-zinc-100 p-3 dark:bg-zinc-950">
                <div className="flex items-center justify-between pb-2 text-xs text-zinc-500">
                  <span>Live Preview</span>
                  <button
                    type="button"
                    onClick={onRebundle}
                    className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                  >
                    <RefreshCw className={`h-3 w-3 ${isBundling ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800">
                  <iframe
                    ref={iframeRef}
                    title="Mist Live Website Preview"
                    srcDoc={bundledHtml}
                    onLoad={handleIframeLoad}
                    className="h-full w-full border-0 bg-white"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col min-h-0 p-2.5 sm:p-4">
              {/* Preview Status Bar */}
              <div className="mb-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex min-w-0 items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  <span className="truncate font-mono text-[11px]">
                    {viewMode === 'visual'
                      ? 'Visual Editor active — tap any element to edit'
                      : `Live Preview · ${viewport}`}
                  </span>
                  {bundleError && (
                    <span className="text-red-600 dark:text-red-400 font-medium whitespace-nowrap">
                      Build error
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {viewMode === 'visual' && (
                    <button
                      type="button"
                      onClick={() => setMobileInspectorOpen(true)}
                      className="inline-flex md:hidden items-center gap-1 rounded border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                      <span>Inspector</span>
                    </button>
                  )}
                  {project.isPublished && project.publishedSlug && (
                    <a
                      href={`/p/${project.publishedSlug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>/p/{project.publishedSlug}</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={onRebundle}
                    aria-label="Rebuild live preview"
                    className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
                  >
                    <RefreshCw className={`h-3 w-3 ${isBundling ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span className="hidden sm:inline">Rebuild</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-1 min-h-0 justify-center overflow-hidden">
                <div
                  className={`${iframeWidthClass} relative h-full max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-all duration-200 dark:border-zinc-800`}
                >
                  {isBundling && !bundledHtml ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-white text-xs text-zinc-500">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
                      <span>Building preview...</span>
                    </div>
                  ) : (
                    <iframe
                      ref={iframeRef}
                      title="Mist Live Website Preview"
                      srcDoc={bundledHtml}
                      onLoad={handleIframeLoad}
                      className="h-full w-full border-0 bg-white"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Desktop Right Visual Inspector Rail */}
        {viewMode === 'visual' && (
          <aside className="hidden md:block w-76 shrink-0 border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#0F0F12]">
            <VisualInspector
              selectedElement={selectedElement}
              onLivePreviewPatch={handleLivePreviewPatch}
              onCommitPatch={onCommitVisualPatch}
              onAskAiAboutElement={(el) => {
                setSelectedElement(el);
                setLeftTab('ai');
                setRefineInput(`Update the <${el.tagName}> "${el.textContent.slice(0, 40)}" to `);
              }}
            />
          </aside>
        )}

        {/* Mobile Visual Inspector Bottom Sheet */}
        <AnimatePresence>
          {viewMode === 'visual' && mobileInspectorOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50 md:hidden"
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="h-[72vh] w-full rounded-t-2xl border-t border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#0F0F12] flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                  <span className="font-display text-xs font-semibold text-zinc-900 dark:text-white">
                    Visual Element Inspector
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
                      setMobilePane('ai');
                      setLeftTab('ai');
                      setRefineInput(`Update the <${el.tagName}> "${el.textContent.slice(0, 40)}" to `);
                    }}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile Actions Bottom Sheet (< md) */}
        <AnimatePresence>
          {mobileMoreOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMoreOpen(false)}
              className="fixed inset-0 z-40 flex items-end bg-black/55 backdrop-blur-xs md:hidden"
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
                      onOpenVoiceChat();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Mic className="h-4 w-4 text-blue-500" aria-hidden="true" />
                    <span>Voice Studio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenProviders();
                    }}
                    className="flex min-h-[46px] items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                  >
                    <Cpu className="h-4 w-4 text-blue-500" aria-hidden="true" />
                    <span className="capitalize">{providerConfig.provider} Model</span>
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

      {/* Fixed Mobile Bottom Tab Bar (< md thumb navigation) */}
      <nav
        aria-label="Mobile workspace navigation"
        className="fixed bottom-0 inset-x-0 z-30 grid h-16 grid-cols-4 border-t border-zinc-200 bg-white/95 backdrop-blur-lg md:hidden dark:border-zinc-800 dark:bg-[#0F0F12]/95"
      >
        {(
          [
            { id: 'preview', label: 'Preview', icon: Eye },
            { id: 'ai', label: 'AI & Files', icon: MessageSquare },
            { id: 'visual', label: 'Visual', icon: MousePointerClick },
            { id: 'code', label: 'Code', icon: Code2 },
          ] as const
        ).map(({ id, label, icon: Icon }) => {
          const active = mobilePane === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectMobilePane(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors cursor-pointer ${
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="h-4.5 w-4.5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
