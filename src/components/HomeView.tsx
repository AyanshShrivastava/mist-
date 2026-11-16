import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Cpu,
  FileCode2,
  FolderOpen,
  Globe,
  KeyRound,
  Loader2,
  Menu,
  Mic,
  Moon,
  Search,
  Settings,
  Sun,
  Terminal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  AiStreamProgress,
  AppAiMode,
  CatalogSource,
  DeploymentRecord,
  MistProject,
  WebSearchMode,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  fetchLiveModelCatalog,
  findModelEntry,
  shouldEnableAppAi,
  type CustomGatewayId,
  type ModelCatalogItem,
} from '../data/models';
import MistLogo, { MistMark } from './MistLogo';
import ModelSelectorDropdown from './ModelSelectorDropdown';
import { maskApiKey } from '../utils/projectOps';

interface HomeViewProps {
  user: User | null;
  projects: MistProject[];
  deployments: DeploymentRecord[];
  providerConfig: AiProviderConfig;
  modelIncident: ModelHealthIncident | null;
  isGenerating: boolean;
  streamProgress: AiStreamProgress | null;
  generationError: string | null;
  darkMode: boolean;
  appAiMode: AppAiMode;
  webSearchMode: WebSearchMode;
  hasWebSearchKey: boolean;
  onChangeAppAiMode: (mode: AppAiMode) => void;
  onChangeWebSearchMode: (mode: WebSearchMode) => void;
  onToggleDarkMode: () => void;
  onSaveProvider: (next: AiProviderConfig) => void;
  onGenerate: (prompt: string) => void;
  onCancelGeneration: () => void;
  onOpenVoiceChat: () => void;
  onOpenProject: (project: MistProject) => void;
  onDuplicateProject: (project: MistProject) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenProviders: () => void;
  onOpenSettings: () => void;
  onOpenDeployments: () => void;
  onOpenAccount: () => void;
}

const QUICK_PROMPTS = [
  {
    label: 'Subway Surfers 2D',
    icon: Box,
    prompt:
      'Interactive Subway Surfers 2D endless runner game on an HTML5 canvas with 3 train lanes, coin pickups, oncoming trains & barriers, smooth keyboard/swipe lane switching, jump & slide, combo score HUD, and working Play Game & Restart buttons.',
  },
  {
    label: '3D Three.js Showcase',
    icon: Code2,
    prompt:
      'Interactive Three.js 3D architectural product studio with OrbitControls, real-time PBR materials, lighting presets, camera angles, and clean HUD overlay.',
  },
  {
    label: 'AI Writing Workspace',
    icon: Terminal,
    prompt:
      'Editorial AI writing & editing web app with a clean split workspace, tone controls, and a live AI assistant powered by POST /api/app-ai.',
  },
  {
    label: 'Coffee Roastery',
    icon: Globe,
    prompt:
      'Minimalist Tokyo specialty coffee roastery website with single-origin menu, brew ratio calculator, and bar reservation.',
  },
];

export default function HomeView({
  user,
  projects,
  deployments,
  providerConfig,
  modelIncident,
  isGenerating,
  streamProgress,
  generationError,
  darkMode,
  appAiMode,
  webSearchMode,
  hasWebSearchKey,
  onChangeAppAiMode,
  onChangeWebSearchMode,
  onToggleDarkMode,
  onSaveProvider,
  onGenerate,
  onCancelGeneration,
  onOpenVoiceChat,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onOpenProviders,
  onOpenSettings,
  onOpenDeployments,
  onOpenAccount,
}: HomeViewProps) {
  const [promptInput, setPromptInput] = useState('');
  const [promptValidationError, setPromptValidationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [quickModelOpen, setQuickModelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveModels, setLiveModels] = useState<ModelCatalogItem[] | null>(null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('preset');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [isOutdatedFallback, setIsOutdatedFallback] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogNote, setCatalogNote] = useState<string | undefined>(undefined);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const catalogSeqRef = useRef(0);

  const loadQuickCatalog = useCallback(
    async (forceRefresh = false) => {
      catalogAbortRef.current?.abort();
      const seq = ++catalogSeqRef.current;

      const cleanUrl = (providerConfig.baseUrl || '').trim();
      if (!cleanUrl) {
        setLiveModels(null);
        setCatalogSource('preset');
        setLastRefreshedAt(null);
        setIsOutdatedFallback(false);
        setCatalogError(null);
        setIsLoadingCatalog(false);
        setCatalogNote('Enter a custom endpoint URL in Models & Keys to fetch models.');
        return;
      }

      const controller = new AbortController();
      catalogAbortRef.current = controller;
      setIsLoadingCatalog(true);
      setCatalogError(null);

      try {
        const idToken = user ? await user.getIdToken() : undefined;
        if (seq !== catalogSeqRef.current || controller.signal.aborted) return;
        const res = await fetchLiveModelCatalog({
          baseUrl: cleanUrl,
          apiKey: providerConfig.apiKey,
          forceRefresh,
          idToken,
          signal: controller.signal,
        });
        if (seq !== catalogSeqRef.current || controller.signal.aborted) return;
        setLiveModels(res.models);
        setCatalogSource(res.source);
        setLastRefreshedAt(res.fetchedAt);
        setIsOutdatedFallback(Boolean(res.isOutdatedFallback));
        setCatalogNote(res.note);
      } catch (err) {
        if (seq !== catalogSeqRef.current || controller.signal.aborted) return;
        setCatalogSource('preset');
        setIsOutdatedFallback(true);
        setCatalogError(err instanceof Error ? err.message : 'Unable to refresh catalog.');
      } finally {
        if (seq === catalogSeqRef.current) {
          setIsLoadingCatalog(false);
        }
      }
    },
    [providerConfig.baseUrl, providerConfig.apiKey, user],
  );

  useEffect(() => {
    if (!quickModelOpen) {
      catalogAbortRef.current?.abort();
      return;
    }
    void loadQuickCatalog(false);
    return () => {
      catalogAbortRef.current?.abort();
    };
  }, [quickModelOpen, loadQuickCatalog]);

  useEffect(() => {
    if (!isGenerating || !streamProgress) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - streamProgress.startedAt) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating, streamProgress]);

  const filteredProjects = useMemo(() => {
    return projects.filter((proj) => {
      const matchesFilter =
        projectFilter === 'all' ||
        (projectFilter === 'published' && proj.isPublished) ||
        (projectFilter === 'draft' && !proj.isPublished);
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        proj.name.toLowerCase().includes(q) ||
        proj.description.toLowerCase().includes(q) ||
        proj.prompt.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [projects, projectFilter, searchQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim()) {
      setPromptValidationError('Describe the website you want Mist to build before generating.');
      return;
    }
    setPromptValidationError(null);
    onGenerate(promptInput.trim());
  };

  const activeGatewayId: CustomGatewayId = detectGatewayFromBaseUrl(providerConfig.baseUrl);
  const activeGateway =
    CUSTOM_GATEWAY_PRESETS.find((g) => g.id === activeGatewayId) || CUSTOM_GATEWAY_PRESETS[0];
  const currentModelMeta = findModelEntry(
    providerConfig.provider,
    providerConfig.model,
    providerConfig.baseUrl,
    liveModels || undefined,
  );
  const providerDisplayName = providerConfig.name?.trim() || activeGateway.name;
  const hasApiKey = Boolean(providerConfig.apiKey?.trim());
  const providerLabel = `${providerDisplayName} · ${
    providerConfig.model ? currentModelMeta?.label || providerConfig.model : 'Select model'
  }`;
  const appAiActiveForPrompt = shouldEnableAppAi(promptInput, appAiMode);

  return (
    <div className="mist-ambient-canvas min-h-screen text-[#09090B] dark:text-[#FAFAFA] flex flex-col">
      {/* Three-Zone Studio Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#FAFAFA]/85 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-[#09090B]/80 transition-colors">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 h-15">
          <a href="#top" className="focus:outline-none">
            <MistLogo size="md" />
          </a>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            <a
              href="#projects"
              className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Projects
            </a>
            <button
              type="button"
              onClick={onOpenVoiceChat}
              className="inline-flex items-center gap-1.5 hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mic className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Voice Studio</span>
            </button>
            <button
              type="button"
              onClick={onOpenProviders}
              className="inline-flex items-center gap-1.5 hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              <span>Models &amp; Keys</span>
            </button>
            <button
              type="button"
              onClick={onOpenDeployments}
              className="inline-flex items-center gap-1.5 hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>Deployments</span>
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Settings</span>
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light studio' : 'Switch to dark studio'}
              className="inline-flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {darkMode ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={onOpenAccount}
              className="inline-flex min-h-[40px] sm:min-h-[36px] items-center gap-2 rounded-xl bg-zinc-950 px-3.5 sm:px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{user ? user.displayName?.split(' ')[0] || 'Account' : 'Sign In'}</span>
            </motion.button>

            <button
              type="button"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle studio navigation menu"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex md:hidden h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Navigation Drawer */}
        <AnimatePresence initial={false}>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="md:hidden overflow-hidden border-t border-zinc-200/80 bg-white/95 dark:border-zinc-800/80 dark:bg-zinc-950/95 backdrop-blur-xl"
            >
              <div className="grid grid-cols-2 gap-2 p-3 text-xs font-medium">
                <a
                  href="#projects"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Projects ({projects.length})</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenVoiceChat();
                  }}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                >
                  <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  <span>Voice Studio</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenProviders();
                  }}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                  <span>Models &amp; Keys</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenDeployments();
                  }}
                  className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3.5 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                  <span>Deployments</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="col-span-2 flex min-h-[44px] items-center justify-center gap-2 rounded-xl mist-primary-gradient text-white cursor-pointer"
                >
                  <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Open Studio Settings</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Prompt Composer */}
        <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-6 pb-9 sm:pt-14 sm:pb-14 lg:pt-20 lg:pb-20">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="text-center sm:text-left"
          >
            <p className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
              <span>Prompt</span>
              <span aria-hidden="true">&rarr;</span>
              <span>Create</span>
              <span aria-hidden="true">&rarr;</span>
              <span>Deploy</span>
            </p>
            <h1 className="mt-2.5 sm:mt-3 font-display text-[30px] sm:text-5xl lg:text-[56px] font-semibold tracking-tight leading-[1.08] text-zinc-950 dark:text-white [text-wrap:balance]">
              Mist —{' '}
              <span className="bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-500 dark:from-blue-400 dark:via-indigo-300 dark:to-sky-400 bg-clip-text text-transparent">
                Ideas into websites.
              </span>
            </h1>
            <p className="mt-3 sm:mt-4 text-sm sm:text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto sm:mx-0">
              Build React apps, interactive 2D Canvas games, Three.js 3D experiences, and AI-enabled tools on your own BYOK model and API key.
            </p>

            {/* Clean Capability Markers (Unboxed typography + functional symbols) */}
            <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                <span>React + TypeScript</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Box className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                <span>Three.js &amp; 2D Canvas</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                <span>Live /api/app-ai</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                <span>100% BYOK</span>
              </span>
            </div>
          </motion.div>

          {/* Model Health Warning Banner (Rate Limits / Server Outages) */}
          <AnimatePresence>
            {modelIncident && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">{modelIncident.title}</p>
                    <p className="mt-0.5 text-[11px] opacity-90">{modelIncident.message}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQuickModelOpen(true)}
                  className="self-start sm:self-center min-h-[36px] rounded-lg border border-amber-400/70 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-amber-950 hover:bg-white dark:border-amber-600/50 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Switch Model
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
            className="mist-composer-shell mt-7 rounded-2xl border border-zinc-200/90 p-4 sm:p-5 dark:border-zinc-800/90 focus-within:border-blue-500/70 dark:focus-within:border-blue-500/60 transition-colors"
          >
            <label htmlFor="mist-prompt-input" className="sr-only">
              Describe the website you want to build
            </label>
            <textarea
              ref={promptInputRef}
              id="mist-prompt-input"
              rows={4}
              value={promptInput}
              onChange={(e) => {
                setPromptInput(e.target.value);
                if (promptValidationError) setPromptValidationError(null);
              }}
              placeholder="Describe your website, 2D game, or Three.js scene: e.g., Subway Surfers 2D runner with coins and lane switching, or a SaaS dashboard with live AI..."
              className="w-full resize-none bg-transparent text-sm sm:text-base text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />

            {/* Live Lovable / Base44 Build Activity Feed while generating */}
            <AnimatePresence>
              {isGenerating && streamProgress && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  aria-live="polite"
                  className="mt-3 overflow-hidden rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-50/90 via-indigo-50/70 to-white p-3.5 text-xs dark:border-blue-500/30 dark:from-blue-950/35 dark:via-indigo-950/25 dark:to-zinc-900/90"
                >
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-blue-500/15 mb-3">
                    <div className="mist-shimmer-bar absolute inset-y-0 left-0 w-1/2 rounded-full mist-primary-gradient" />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MistMark className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 animate-pulse" title="Building" />
                      <span className="font-semibold text-zinc-950 dark:text-white truncate">
                        {streamProgress.activeFile
                          ? `Writing ${streamProgress.activeFile}...`
                          : streamProgress.phase}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {elapsedSeconds}s
                        {streamProgress.charsReceived > 0
                          ? ` · ${Math.max(1, Math.round(streamProgress.charsReceived / 1024))} KB`
                          : ''}
                      </span>
                      <button
                        type="button"
                        onClick={onCancelGeneration}
                        className="rounded-lg border border-zinc-300/80 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  {streamProgress.searchState && streamProgress.searchState !== 'idle' && (
                    <div className="mt-2 rounded-lg border border-zinc-200/80 bg-white/80 px-2.5 py-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-950/60">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                          {streamProgress.searchState === 'searching' ? (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-500" aria-hidden="true" />
                          ) : streamProgress.searchState === 'failed' ? (
                            <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden="true" />
                          ) : (
                            <Globe className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                          )}
                          <span>
                            {streamProgress.searchState === 'searching'
                              ? 'Searching live web sources...'
                              : streamProgress.searchState === 'failed'
                                ? 'Web search failed'
                                : `Retrieved ${streamProgress.searchSources?.length ?? 0} verified web source${
                                    (streamProgress.searchSources?.length ?? 0) === 1 ? '' : 's'
                                  }`}
                          </span>
                        </span>
                      </div>
                      {streamProgress.searchQueries && streamProgress.searchQueries.length > 0 && (
                        <p className="mt-1 font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                          {streamProgress.searchQueries.join(' · ')}
                        </p>
                      )}
                      {streamProgress.searchError && (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          {streamProgress.searchError}
                        </p>
                      )}
                    </div>
                  )}

                  {streamProgress.completedFiles.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2 text-[11px]">
                      {streamProgress.completedFiles.map((filePath) => (
                        <span
                          key={filePath}
                          className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-400"
                        >
                          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{filePath}</span>
                        </span>
                      ))}
                      {streamProgress.activeFile && (
                        <span className="inline-flex items-center gap-1 font-mono text-blue-600 dark:text-blue-400">
                          <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden="true" />
                          <span>{streamProgress.activeFile}</span>
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {(promptValidationError || generationError) && (
              <div
                role="alert"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
              >
                <span>{promptValidationError || generationError}</span>
                {!hasApiKey && (
                  <button
                    type="button"
                    onClick={onOpenProviders}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 cursor-pointer"
                  >
                    Configure BYOK Key
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-800/80">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 min-w-0">
                <button
                  type="button"
                  aria-expanded={quickModelOpen}
                  onClick={() => setQuickModelOpen((v) => !v)}
                  className={`inline-flex min-h-[44px] sm:min-h-[34px] items-center justify-between sm:justify-start gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeIncidentMatches(modelIncident, providerConfig)
                      ? 'border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-200'
                      : !hasApiKey
                        ? 'border-blue-400/70 bg-blue-50/90 text-blue-800 dark:border-blue-700/60 dark:bg-blue-950/40 dark:text-blue-200'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span className="max-w-[96px] sm:max-w-[180px] truncate">{providerLabel}</span>
                    {!hasApiKey ? (
                      <span className="hidden sm:inline text-[10px] font-semibold text-blue-600 dark:text-blue-300">
                        · Add key
                      </span>
                    ) : currentModelMeta ? (
                      <span
                        className={`hidden sm:inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          currentModelMeta.billing === 'free'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : currentModelMeta.billing === 'paid'
                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                              : currentModelMeta.billing === 'provider_billed'
                                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                : 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {currentModelMeta.billingLabel}
                      </span>
                    ) : null}
                  </span>
                  <motion.span
                    animate={{ rotate: quickModelOpen ? 180 : 0 }}
                    transition={{ duration: 0.18 }}
                    className="inline-flex shrink-0"
                  >
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                  </motion.span>
                </button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={onOpenVoiceChat}
                  className="inline-flex min-h-[44px] sm:min-h-[34px] items-center justify-center sm:justify-start gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Mic className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>Voice Chat</span>
                </motion.button>

                <label className="col-span-2 sm:col-span-1 inline-flex min-h-[38px] sm:min-h-[34px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  <Terminal
                    className={`h-3.5 w-3.5 shrink-0 ${
                      appAiActiveForPrompt ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'
                    }`}
                    aria-hidden="true"
                  />
                  <select
                    aria-label="Generated App AI behavior"
                    value={appAiMode}
                    onChange={(e) => onChangeAppAiMode(e.target.value as AppAiMode)}
                    className="bg-transparent text-[11px] font-medium text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    <option value="on_request" className="bg-white dark:bg-zinc-900">
                      App AI: On Request
                    </option>
                    <option value="off" className="bg-white dark:bg-zinc-900">
                      App AI: Off
                    </option>
                    <option value="always" className="bg-white dark:bg-zinc-900">
                      App AI: Always
                    </option>
                  </select>
                </label>

                <label className="col-span-2 sm:col-span-1 inline-flex min-h-[38px] sm:min-h-[34px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  <Globe
                    className={`h-3.5 w-3.5 shrink-0 ${
                      webSearchMode === 'on'
                        ? 'text-blue-600 dark:text-blue-400'
                        : webSearchMode === 'auto'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400'
                    }`}
                    aria-hidden="true"
                  />
                  <select
                    aria-label="Search Web mode"
                    value={webSearchMode}
                    onChange={(e) => onChangeWebSearchMode(e.target.value as WebSearchMode)}
                    className="bg-transparent text-[11px] font-medium text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                  >
                    <option value="auto" className="bg-white dark:bg-zinc-900">
                      Search: Auto
                    </option>
                    <option value="on" className="bg-white dark:bg-zinc-900">
                      Search: On
                    </option>
                    <option value="off" className="bg-white dark:bg-zinc-900">
                      Search: Off
                    </option>
                  </select>
                </label>
                {webSearchMode === 'on' && !hasWebSearchKey && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="col-span-2 sm:col-span-1 inline-flex min-h-[34px] items-center justify-center rounded-xl border border-amber-300/80 bg-amber-50 px-2.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer whitespace-nowrap"
                  >
                    Configure Search Key
                  </button>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0">
                {!user && (
                  <span className="text-center sm:text-right text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    Sign in to generate
                  </span>
                )}
                <motion.button
                  type="submit"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  disabled={isGenerating}
                  className="inline-flex min-h-[48px] sm:min-h-[40px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl mist-primary-gradient px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-blue-600/20 disabled:opacity-60 transition-all whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Building Website...</span>
                    </>
                  ) : (
                    <>
                      <MistMark className="h-4 w-4" title="Generate" />
                      <span>Generate Website</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </>
                  )}
                </motion.button>
              </div>
            </div>

            {/* Expandable Quick BYOK Model & Gateway Drawer */}
            <AnimatePresence initial={false}>
              {quickModelOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 space-y-3 rounded-xl border border-zinc-200 bg-white/95 p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-950/95">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mr-1">
                          Preset:
                        </span>
                        {CUSTOM_GATEWAY_PRESETS.map((gw) => (
                          <button
                            key={gw.id}
                            type="button"
                            onClick={() => {
                              catalogAbortRef.current?.abort();
                              catalogSeqRef.current += 1;
                              setLiveModels(null);
                              setCatalogSource('preset');
                              setLastRefreshedAt(null);
                              setIsOutdatedFallback(false);
                              setCatalogError(null);
                              onSaveProvider({
                                ...providerConfig,
                                provider: 'custom',
                                name: gw.name,
                                baseUrl: gw.baseUrl || providerConfig.baseUrl || '',
                                model: gw.models[0]?.id || '',
                              });
                            }}
                            className={`min-h-[28px] rounded-lg border px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                              activeGatewayId === gw.id
                                ? 'border-blue-500/70 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'
                            }`}
                          >
                            {gw.name}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={onOpenProviders}
                        className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                      >
                        Configure Name, URL &amp; Key &rarr;
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                      <span>
                        Active Key:{' '}
                        <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                          {maskApiKey(providerConfig.apiKey) || 'Not set'}
                        </span>
                      </span>
                      <span>
                        {user?.email
                          ? providerConfig.sessionOnlyKey
                            ? 'Session RAM only'
                            : `Encrypted vault: ${user.email}`
                          : 'Sign in to sync key to account'}
                      </span>
                    </div>

                    <ModelSelectorDropdown
                      provider="custom"
                      value={providerConfig.model}
                      modelsOverride={liveModels !== null ? liveModels : activeGateway.models}
                      gatewayLabel={providerDisplayName}
                      isLoadingCatalog={isLoadingCatalog}
                      isLiveCatalog={catalogSource === 'live'}
                      catalogSource={catalogSource}
                      lastRefreshedAt={lastRefreshedAt}
                      isOutdatedFallback={isOutdatedFallback}
                      catalogError={catalogError}
                      catalogNote={catalogNote}
                      onRefreshCatalog={() => void loadQuickCatalog(true)}
                      compact
                      onChange={(nextModel) =>
                        onSaveProvider({
                          ...providerConfig,
                          provider: 'custom',
                          model: nextModel,
                        })
                      }
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.form>

          {/* Starter Prompt Suggestions */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.14 }}
            className="mt-5 space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:justify-start sm:gap-2"
          >
            <span className="block sm:inline text-center sm:text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 sm:mr-1">
              Try a prompt:
            </span>
            <div className="grid grid-cols-2 gap-2 sm:contents">
              {QUICK_PROMPTS.map((item) => {
                const Icon = item.icon;
                return (
                  <motion.button
                    key={item.label}
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setPromptInput(item.prompt);
                      setPromptValidationError(null);
                      promptInputRef.current?.focus();
                    }}
                    className="inline-flex min-h-[42px] sm:min-h-[32px] items-center justify-center sm:justify-start gap-1.5 rounded-xl sm:rounded-lg border border-zinc-200/90 bg-white/90 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-blue-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:border-blue-700/60 dark:hover:bg-zinc-900 transition-colors truncate sm:whitespace-nowrap sm:shrink-0 cursor-pointer"
                  >
                    <Icon className="h-3.5 w-3.5 text-blue-500 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </section>

        {/* Saved Websites Management */}
        <section
          id="projects"
          className="border-t border-zinc-200/80 bg-white/60 py-12 sm:py-14 dark:border-zinc-800/80 dark:bg-zinc-950/45 transition-colors"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">
                  Your Websites
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {user
                    ? `Projects created for ${user.email}`
                    : 'Sign in with Google to keep your websites saved across devices.'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 w-full md:w-auto">
                <div className="relative w-full sm:w-auto">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    aria-label="Search projects"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter projects..."
                    className="w-full sm:w-52 min-h-[44px] sm:min-h-[34px] rounded-xl border border-zinc-200 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>

                <div className="grid grid-cols-3 sm:flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                  {(['all', 'published', 'draft'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setProjectFilter(tab)}
                      className={`relative min-h-[36px] sm:min-h-0 rounded-lg px-3 py-1.5 sm:py-1 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        projectFilter === tab
                          ? 'text-zinc-950 dark:text-white'
                          : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
                      }`}
                    >
                      {projectFilter === tab && (
                        <motion.span
                          layoutId="mist-project-filter-pill"
                          transition={{ type: 'spring', bounce: 0.18, duration: 0.35 }}
                          className="absolute inset-0 rounded-lg bg-white shadow-sm dark:bg-zinc-800"
                        />
                      )}
                      <span className="relative z-10">{tab}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/85 p-8 sm:p-10 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
                <FolderOpen className="mx-auto h-7 w-7 text-zinc-400" aria-hidden="true" />
                <h3 className="mt-3 font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {projects.length === 0 ? 'No websites created yet' : 'No matching websites'}
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                  {projects.length === 0
                    ? 'Describe an idea in the prompt composer above or open Voice Studio to talk through your website design.'
                    : 'Clear your search filter to view all saved websites.'}
                </p>
                {projects.length === 0 && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        promptInputRef.current?.focus();
                      }}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl mist-primary-gradient px-4 py-2 text-xs font-medium text-white shadow-sm cursor-pointer"
                    >
                      <MistMark className="h-3.5 w-3.5" title="Start" />
                      <span>Start from a Prompt</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenVoiceChat}
                      className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                      <span>Try Voice Chat</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/75 overflow-hidden">
                {filteredProjects.map((project, index) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.18) }}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenProject(project)}
                          className="font-display text-sm font-semibold text-zinc-950 hover:text-blue-600 dark:text-white dark:hover:text-blue-400 truncate cursor-pointer"
                        >
                          {project.name}
                        </button>
                        <span className="text-xs text-zinc-400">·</span>
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                          <FileCode2 className="h-3 w-3 opacity-70" aria-hidden="true" />
                          <span>{project.files.length} files</span>
                        </span>
                        {project.isPublished && project.publishedSlug && (
                          <>
                            <span className="text-xs text-zinc-400">·</span>
                            <a
                              href={`/${project.publishedSlug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                            >
                              <Globe className="h-3 w-3" aria-hidden="true" />
                              <span>/{project.publishedSlug}</span>
                            </a>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {project.description || project.prompt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project)}
                        className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] rounded-xl sm:rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                      >
                        Open Editor
                      </button>
                      <button
                        type="button"
                        aria-label={`Duplicate ${project.name}`}
                        onClick={() => onDuplicateProject(project)}
                        className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center rounded-xl sm:rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => onDeleteProject(project.id)}
                        className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center rounded-xl sm:rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:bg-red-950/60 dark:hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200/80 bg-white/75 py-6 dark:border-zinc-800/80 dark:bg-[#09090B]/90">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-6 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2.5 text-center sm:text-left">
            <MistLogo size="sm" />
            <span>— Ideas into websites. · {deployments.length} published {deployments.length === 1 ? 'site' : 'sites'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light studio theme' : 'Switch to dark studio theme'}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {darkMode ? (
                <>
                  <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Dark Mode</span>
                </>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function activeIncidentMatches(
  incident: ModelHealthIncident | null,
  config: AiProviderConfig,
): boolean {
  return Boolean(
    incident &&
      incident.provider === config.provider &&
      incident.model === config.model,
  );
}
