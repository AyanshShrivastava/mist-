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
  Download,
  FileCode2,
  FolderOpen,
  Gamepad2,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Menu,
  Mic,
  Moon,
  Pause,
  Play,
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
import showcasePromptImg from '../assets/images/mist_showcase_prompt_1794824266440.jpg';
import showcaseBuildImg from '../assets/images/mist_showcase_build_1794824267456.jpg';
import showcaseLaunchImg from '../assets/images/mist_showcase_launch_1794824268004.jpg';

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
  onPublishProject: (project: MistProject) => void;
  onDuplicateProject: (project: MistProject) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenProviders: () => void;
  onOpenSettings: () => void;
  onOpenDeployments: () => void;
  onOpenAccount: () => void;
}

const INTERACTIVE_MODES = [
  {
    id: 'web',
    label: 'Web App',
    detail: 'Landing pages, SaaS tools & dashboards',
    icon: Layers,
    starterPrompt:
      'Minimalist Tokyo specialty coffee roastery website with single-origin menu, brew ratio calculator, and bar reservation.',
  },
  {
    id: 'game',
    label: '2D Canvas Game',
    detail: 'Playable arcade runners & physics games',
    icon: Gamepad2,
    starterPrompt:
      'Interactive Subway Surfers 2D endless runner game on an HTML5 canvas with 3 train lanes, coin pickups, oncoming barriers, keyboard & swipe controls, and Play/Restart buttons.',
  },
  {
    id: '3d',
    label: '3D Scene',
    detail: 'Three.js interactive product & spatial views',
    icon: Box,
    starterPrompt:
      'Interactive Three.js 3D architectural product studio with OrbitControls, real-time PBR materials, camera angle presets, and clean HUD overlay.',
  },
  {
    id: 'research',
    label: 'Live Web App',
    detail: 'Real web research with verified source links',
    icon: Globe,
    starterPrompt:
      'Editorial AI research digest & writing workspace with live web search citations and an in-app assistant powered by POST /api/app-ai.',
  },
] as const;

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Give a Simple Prompt',
    caption: 'Describe your idea in plain English or use Voice Studio.',
    image: showcasePromptImg,
    alt: 'Studio desk showing a prompt composer turning an idea into a web layout plan',
    samplePrompt: '"Build a Tokyo specialty coffee roastery site with a brew ratio calculator."',
    sampleFiles: ['Prompt queued', 'Model ready (BYOK)'],
    outcome: 'Understands layout, interactivity, 2D Canvas, or 3D scene requirements automatically.',
  },
  {
    step: '02',
    title: 'AI Builds & Researches Live',
    caption: 'Generates complete React + TypeScript files and verifies real web sources.',
    image: showcaseBuildImg,
    alt: 'Widescreen monitor displaying React TypeScript code beside a live website preview',
    samplePrompt: 'Writing src/App.tsx, src/components/BrewCalculator.tsx, src/index.css...',
    sampleFiles: ['src/App.tsx', 'src/components/Menu.tsx', 'src/index.css'],
    outcome: 'Edit visually by clicking elements or chatting in AI Refine with Chat & Preview tabs.',
  },
  {
    step: '03',
    title: 'Download ZIP & Host Free',
    caption: 'Clicking Publish downloads your standalone site ready for no-card free hosts.',
    image: showcaseLaunchImg,
    alt: 'Minimalist laptop displaying the finished specialty coffee roastery website live in browser',
    samplePrompt: 'Packaged dist/index.html + render.yaml -> Ready for Netlify Drop or Render Static.',
    sampleFiles: ['dist/index.html', 'render.yaml', 'DEPLOY_FREE.md'],
    outcome: '100% standalone static output — zero visitor load or billing on Mist’s server.',
  },
] as const;

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
  onPublishProject,
  onDuplicateProject,
  onDeleteProject,
  onOpenProviders,
  onOpenSettings,
  onOpenDeployments,
  onOpenAccount,
}: HomeViewProps) {
  const [promptInput, setPromptInput] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('web');
  const [promptValidationError, setPromptValidationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [quickModelOpen, setQuickModelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Interactive Prompt-to-Website Walkthrough state
  const [activeShowcaseStep, setActiveShowcaseStep] = useState(0);
  const [isShowcasePlaying, setIsShowcasePlaying] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return true;
  });
  const [showLoggedInTour, setShowLoggedInTour] = useState(false);

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

  useEffect(() => {
    if (!isShowcasePlaying) return;
    if (user && !showLoggedInTour) return;
    const id = window.setInterval(() => {
      setActiveShowcaseStep((prev) => (prev + 1) % WORKFLOW_STEPS.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, [isShowcasePlaying, user, showLoggedInTour]);

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
  const currentStepData = WORKFLOW_STEPS[activeShowcaseStep] || WORKFLOW_STEPS[0];

  const renderShowcaseWalkthrough = () => (
    <section
      id="walkthrough"
      aria-label="How Mist builds websites"
      className="mx-auto max-w-6xl px-4 sm:px-6 pb-12"
    >
      <div className="rounded-2xl border border-zinc-200/90 bg-white/85 p-4 sm:p-6 dark:border-zinc-800/90 dark:bg-zinc-950/75">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-semibold tracking-tight text-zinc-950 dark:text-white">
              From Prompt to Free Live Website
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
              Watch how Mist turns plain-English prompts into standalone React code ready for free static hosting.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsShowcasePlaying((p) => !p)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
            >
              {isShowcasePlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  <span>Pause Reel</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  <span>Play Reel</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Interactive Step Selector */}
          <div className="lg:col-span-5 flex flex-col justify-between gap-2.5">
            {WORKFLOW_STEPS.map((item, idx) => {
              const isActive = idx === activeShowcaseStep;
              return (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => {
                    setActiveShowcaseStep(idx);
                    setIsShowcasePlaying(false);
                  }}
                  className={`flex-1 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'border-blue-500/80 bg-blue-50/75 dark:border-blue-500/70 dark:bg-blue-950/30'
                      : 'border-zinc-200/80 bg-zinc-50/60 hover:bg-zinc-100/70 dark:border-zinc-800/80 dark:bg-zinc-900/50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-zinc-950 dark:text-white">
                      {item.step}. {item.title}
                    </span>
                    {isActive && (
                      <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        Viewing
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {item.caption}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Synchronized Visual Frame */}
          <div className="lg:col-span-7 relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800 lg:min-h-[340px] flex flex-col justify-end">
            <div className="relative h-48 sm:h-56 lg:absolute lg:inset-0 lg:h-full w-full overflow-hidden">
              <img
                src={currentStepData.image}
                alt={currentStepData.alt}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover object-center transition-opacity duration-300"
              />
              <div
                aria-hidden="true"
                className="hidden lg:block absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/15"
              />
            </div>
            <div className="relative z-10 bg-zinc-950 lg:bg-transparent p-4 sm:p-5 text-white space-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-300 font-mono">
                <span>Step {currentStepData.step} of 03</span>
                <span aria-hidden="true">·</span>
                <span>{currentStepData.sampleFiles.join(' · ')}</span>
              </div>
              <p className="font-mono text-xs sm:text-sm text-zinc-100 bg-black/55 border border-white/15 rounded-lg px-3 py-2">
                {currentStepData.samplePrompt}
              </p>
              <p className="text-xs text-zinc-300 lg:text-zinc-200 leading-relaxed">
                {currentStepData.outcome}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="mist-ambient-canvas min-h-screen text-[#09090B] dark:text-[#FAFAFA] flex flex-col">
      {/* Three-Zone Studio Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#FAFAFA]/85 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-[#09090B]/80 transition-colors">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 h-15">
          <a href="#top" className="focus:outline-none whitespace-nowrap shrink-0">
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
              <span>Free Hosting</span>
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
                  <span>Free Hosting</span>
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
        {/* Hero & Interactive Studio Composer */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 pt-6 pb-8 sm:pt-12 sm:pb-12">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            className="text-center sm:text-left"
          >
            {user ? (
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  Welcome back, {user.displayName?.split(' ')[0] || user.email} · {projects.length} saved {projects.length === 1 ? 'site' : 'sites'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowLoggedInTour((v) => !v)}
                  className="text-xs font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white underline-offset-4 hover:underline cursor-pointer"
                >
                  {showLoggedInTour ? 'Hide Walkthrough' : 'How Mist Works'}
                </button>
              </div>
            ) : (
              <p className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
                <span>Describe Idea</span>
                <span aria-hidden="true">&rarr;</span>
                <span>AI Builds Live</span>
                <span aria-hidden="true">&rarr;</span>
                <span>Download &amp; Host Free</span>
              </p>
            )}

            <h1 className="mt-2 font-display text-[30px] sm:text-5xl lg:text-[52px] font-semibold tracking-tight leading-[1.08] text-zinc-950 dark:text-white [text-wrap:balance]">
              Mist —{' '}
              <span className="bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-500 dark:from-blue-400 dark:via-indigo-300 dark:to-sky-400 bg-clip-text text-transparent">
                Ideas into websites.
              </span>
            </h1>
            <p className="mt-3 text-sm sm:text-base leading-relaxed text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto sm:mx-0">
              {user
                ? 'Pick a starting style below or describe anything in plain English. Publish downloads a standalone bundle ready for free no-card hosting.'
                : 'Type a prompt or speak an idea, watch Mist build React apps, 2D games, or 3D scenes with your encrypted BYOK key, and export for free external hosting.'}
            </p>
          </motion.div>

          {/* Interactive One-Tap Builder Type Picker */}
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {INTERACTIVE_MODES.map((mode) => {
              const Icon = mode.icon;
              const isSelected = selectedMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setSelectedMode(mode.id);
                    setPromptInput(mode.starterPrompt);
                    setPromptValidationError(null);
                    if (mode.id === 'research') {
                      onChangeWebSearchMode('on');
                      onChangeAppAiMode('always');
                    }
                    promptInputRef.current?.focus();
                  }}
                  className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-500/80 bg-blue-50/75 dark:border-blue-500/60 dark:bg-blue-950/30'
                      : 'border-zinc-200/90 bg-white/80 hover:bg-zinc-50 dark:border-zinc-800/90 dark:bg-zinc-900/70 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950 dark:text-white">
                    <Icon className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
                    <span>{mode.label}</span>
                  </span>
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">
                    {mode.detail}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Model Health Warning Banner */}
          <AnimatePresence>
            {modelIncident && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200"
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

          {/* Simple Interactive Prompt Composer */}
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
            className="mist-composer-shell mt-5 rounded-2xl border border-zinc-200/90 p-4 sm:p-5 dark:border-zinc-800/90 focus-within:border-blue-500/70 dark:focus-within:border-blue-500/60 transition-colors"
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
              placeholder="Describe what you want to create (e.g., Tokyo coffee shop, 2D runner game, or portfolio)..."
              className="w-full resize-none bg-transparent text-sm sm:text-base text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />

            {/* Live AI Build Activity Feed while generating */}
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

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-800/80">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  aria-expanded={quickModelOpen}
                  onClick={() => setQuickModelOpen((v) => !v)}
                  className={`inline-flex min-h-[44px] sm:min-h-[34px] items-center justify-between sm:justify-start gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeIncidentMatches(modelIncident, providerConfig)
                      ? 'border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-200'
                      : !hasApiKey
                        ? 'border-blue-400/70 bg-blue-50/90 text-blue-800 dark:border-blue-700/60 dark:bg-blue-950/40 dark:text-blue-200'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span className="max-w-[96px] sm:max-w-[116px] truncate">{providerLabel}</span>
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
                  className="inline-flex min-h-[44px] sm:min-h-[34px] items-center justify-center sm:justify-start gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Mic className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>Voice Chat</span>
                </motion.button>

                <label className="col-span-2 sm:col-span-1 inline-flex min-h-[38px] sm:min-h-[34px] items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
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

                <label className="col-span-2 sm:col-span-1 inline-flex min-h-[38px] sm:min-h-[34px] items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
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

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-2.5 shrink-0">
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
                  className="inline-flex min-h-[48px] sm:min-h-[38px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl mist-primary-gradient px-4 py-2 text-sm font-medium text-white shadow-md shadow-blue-600/20 disabled:opacity-60 transition-all whitespace-nowrap shrink-0 cursor-pointer"
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
        </section>

        {/* Visual Walkthrough Reel (Always visible when signed out; toggleable when signed in) */}
        {(!user || showLoggedInTour) && renderShowcaseWalkthrough()}

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
                    : 'Sign in with Google to save projects and encrypted BYOK keys to your account.'}
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
                    ? 'Pick any mode above, describe an idea in the prompt composer, or open Voice Studio.'
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
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              <span>Exported ({project.publishedSlug}.zip)</span>
                            </span>
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
                        className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] rounded-xl sm:rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Open Editor
                      </button>
                      <button
                        type="button"
                        onClick={() => onPublishProject(project)}
                        className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 rounded-xl sm:rounded-lg mist-primary-gradient px-3 py-1.5 text-xs font-medium text-white shadow-sm cursor-pointer whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Publish</span>
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
            <span>— Ideas into websites. · {projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>
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
