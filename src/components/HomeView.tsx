import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Menu,
  Mic,
  Moon,
  MousePointerClick,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type {
  AiProviderConfig,
  AiStreamProgress,
  AppAiMode,
  CatalogSource,
  DeploymentRecord,
  MistProject,
  MistUser as User,
  WebSearchMode,
} from '../types/mist';
import type { MistTemplate } from '../data/templates';
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
import templateCoffeeImg from '../assets/images/template_coffee_roastery_1794659272127.jpg';
import templateAudioImg from '../assets/images/template_audio_hardware_1794659272890.jpg';
import templateArchitectImg from '../assets/images/template_architect_studio_1794659273332.jpg';
import templateSkincareImg from '../assets/images/template_botanical_skincare_1794659273501.jpg';

const TEMPLATE_PREVIEW_IMAGES: Record<string, string> = {
  'kuro-coffee': templateCoffeeImg,
  'nordholm-architects': templateArchitectImg,
  'aether-audio': templateAudioImg,
  'lume-botanicals': templateSkincareImg,
};

interface HomeViewProps {
  user: User | null;
  projects: MistProject[];
  templates: MistTemplate[];
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
  onOpenTemplate: (template: MistTemplate) => void;
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
    detail: 'Sites, SaaS tools & dashboards',
    icon: Layers,
    previewDomain: 'kyoto-roastery.mist.app',
    previewTitle: 'Kuro Coffee · Kiyosumi',
    previewFiles: ['src/App.tsx', 'src/components/BrewCalculator.tsx', 'src/index.css'],
    starterPrompt:
      'Minimalist Tokyo specialty coffee roastery website with single-origin menu, brew ratio calculator, and bar reservation.',
  },
  {
    id: 'game',
    label: '2D Game',
    detail: 'Playable canvas & physics games',
    icon: Gamepad2,
    previewDomain: 'neon-runner.mist.app',
    previewTitle: 'Metro Dash · HTML5 Canvas',
    previewFiles: ['src/App.tsx', 'src/game/Engine.ts', 'src/game/Sprites.ts'],
    starterPrompt:
      'Interactive 2D endless runner game on an HTML5 canvas with 3 lanes, coin pickups, oncoming barriers, keyboard & swipe controls, and Play/Restart buttons.',
  },
  {
    id: '3d',
    label: '3D Scene',
    detail: 'Three.js interactive views',
    icon: Box,
    previewDomain: 'aether-3d.mist.app',
    previewTitle: 'Aether Studio · Three.js PBR',
    previewFiles: ['src/App.tsx', 'src/scene/Viewer3D.tsx', 'src/components/Hud.tsx'],
    starterPrompt:
      'Interactive Three.js 3D architectural product studio with OrbitControls, real-time PBR materials, camera angle presets, and clean HUD overlay.',
  },
  {
    id: 'research',
    label: 'Live Research',
    detail: 'Web search + in-app AI',
    icon: Globe,
    previewDomain: 'digest-ai.mist.app',
    previewTitle: 'Signal Digest · Cited Sources',
    previewFiles: ['src/App.tsx', 'src/components/ResearchFeed.tsx', 'src/api/appAi.ts'],
    starterPrompt:
      'Editorial AI research digest & writing workspace with live web search citations and an in-app assistant powered by POST /api/app-ai.',
  },
] as const;

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Describe in plain English',
    caption: 'Type a sentence or talk through your idea in Voice Studio.',
    image: showcasePromptImg,
    alt: 'Prompt composer turning an idea into a multi-file web app plan',
    samplePrompt: '"Build a Tokyo coffee roastery site with a brew ratio calculator."',
    sampleFiles: ['Prompt queued', 'BYOK model ready'],
    outcome: 'Mist automatically plans layout, components, 2D canvas, or 3D scene structure.',
  },
  {
    step: '02',
    title: 'Refine visually or via chat',
    caption: 'Click any element in the live preview to adjust typography, colors, or spacing — or ask AI to iterate.',
    image: showcaseBuildImg,
    alt: 'React TypeScript code beside a live website preview',
    samplePrompt: 'Writing src/App.tsx, src/components/BrewCalculator.tsx, src/index.css...',
    sampleFiles: ['src/App.tsx', 'src/components/Menu.tsx', 'src/index.css'],
    outcome: 'Switch effortlessly between Live Preview, Visual Editor, Code, and Split View.',
  },
  {
    step: '03',
    title: 'Export or deploy free',
    caption: 'Download clean React + TypeScript source or deploy directly to Render Static Sites.',
    image: showcaseLaunchImg,
    alt: 'Laptop displaying the finished specialty coffee roastery website',
    samplePrompt: 'Packaged dist/index.html + render.yaml → Ready to host anywhere.',
    sampleFiles: ['dist/index.html', 'render.yaml', 'DEPLOY_FREE.md'],
    outcome: '100% standalone static output — you own every line of code with zero lock-in.',
  },
] as const;

function formatRelativeDate(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMin = Math.floor((Date.now() - ts) / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface PillMenuOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

function PillPopoverSelect<T extends string>({
  icon: Icon,
  iconClassName,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  iconClassName: string;
  label: string;
  value: T;
  options: PillMenuOption<T>[];
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-zinc-50/90 px-2.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white cursor-pointer whitespace-nowrap"
      >
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClassName}`} aria-hidden={true} />
        <span>{current.label}</span>
        <ChevronDown
          className={`h-3 w-3 opacity-60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden={true}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 bottom-full mb-2 z-40 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-[#141418]"
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    selected
                      ? 'bg-zinc-100 text-zinc-950 dark:bg-white/10 dark:text-white'
                      : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold">{opt.label}</p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-snug">
                      {opt.description}
                    </p>
                  </div>
                  {selected && (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--mist-c2)" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function HomeView({
  user,
  projects,
  templates,
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
  onOpenTemplate,
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Interactive Walkthrough state
  const [activeShowcaseStep, setActiveShowcaseStep] = useState(0);
  const [showLoggedInTour, setShowLoggedInTour] = useState(false);

  const [liveModels, setLiveModels] = useState<ModelCatalogItem[] | null>(null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('preset');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [isOutdatedFallback, setIsOutdatedFallback] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogNote, setCatalogNote] = useState<string | undefined>(undefined);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const projectSearchRef = useRef<HTMLInputElement | null>(null);
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
        const idToken = user ? (await user.getIdToken()) ?? undefined : undefined;
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
      setPromptValidationError('Describe the website or app you want Mist to build.');
      promptInputRef.current?.focus();
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
  const activeModeObj =
    INTERACTIVE_MODES.find((m) => m.id === selectedMode) || INTERACTIVE_MODES[0];

  // Rotating example prompts for the composer placeholder
  const placeholderIdeas = useMemo(
    () => [
      'a Tokyo coffee roastery site with a brew ratio calculator…',
      'a neon 2D endless runner game with swipe controls…',
      'a 3D product studio for brushed aluminum headphones…',
      'a calm portfolio for a Copenhagen architecture studio…',
      'an AI research digest with live web citations…',
    ],
    [],
  );
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderChars, setPlaceholderChars] = useState(0);

  useEffect(() => {
    if (promptInput) return;
    const full = placeholderIdeas[placeholderIndex];
    const done = placeholderChars >= full.length;
    const t = window.setTimeout(
      () => {
        if (done) {
          setPlaceholderChars(0);
          setPlaceholderIndex((i) => (i + 1) % placeholderIdeas.length);
        } else {
          setPlaceholderChars((c) => c + 1);
        }
      },
      done ? 1800 : 34,
    );
    return () => window.clearTimeout(t);
  }, [placeholderChars, placeholderIndex, placeholderIdeas, promptInput]);

  const animatedPlaceholder = `Ask Mist to build ${placeholderIdeas[placeholderIndex].slice(0, placeholderChars)}`;
  const firstName = user
    ? user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'there'
    : '';

  const focusComposer = (prompt?: string) => {
    if (prompt !== undefined) {
      setPromptInput(prompt);
      setPromptValidationError(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => promptInputRef.current?.focus(), 220);
  };

  const themeButton = (
    <button
      type="button"
      onClick={onToggleDarkMode}
      aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
      title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white transition-colors cursor-pointer"
    >
      {darkMode ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );

  const appAiOptions: PillMenuOption<AppAiMode>[] = [
    {
      value: 'on_request',
      label: 'App AI: Auto',
      description: 'Adds /api/app-ai only when your prompt asks for in-app AI.',
    },
    {
      value: 'always',
      label: 'App AI: Always',
      description: 'Wires live AI capabilities into every generated app.',
    },
    {
      value: 'off',
      label: 'App AI: Off',
      description: 'Generates pure static React / Canvas / Three.js apps.',
    },
  ];

  const webSearchOptions: PillMenuOption<WebSearchMode>[] = [
    {
      value: 'auto',
      label: 'Search: Auto',
      description: 'Searches the live web when current facts are needed.',
    },
    {
      value: 'on',
      label: 'Search: On',
      description: 'Always fetches & cites live web sources.',
    },
    {
      value: 'off',
      label: 'Search: Off',
      description: 'Builds purely from your prompt and model knowledge.',
    },
  ];

  const composerBlock = (
    <div className="space-y-3">
      {/* Model Health Warning Banner */}
      <AnimatePresence>
        {modelIncident && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-4 py-3 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/45 dark:text-amber-200"
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
              className="self-start sm:self-center min-h-[34px] rounded-xl border border-amber-400/70 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-amber-950 hover:bg-white dark:border-amber-600/50 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Switch Model
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Prompt Composer */}
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
        className="mist-composer-shell p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <label htmlFor="mist-prompt-input" className="sr-only">
            Describe the website or app you want to build
          </label>
          <textarea
            ref={promptInputRef}
            id="mist-prompt-input"
            rows={3}
            value={promptInput}
            onChange={(e) => {
              setPromptInput(e.target.value);
              if (promptValidationError) setPromptValidationError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={animatedPlaceholder}
            className="w-full min-h-[84px] resize-none bg-transparent text-sm sm:text-[15px] leading-relaxed text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          {promptInput && !isGenerating && (
            <button
              type="button"
              onClick={() => {
                setPromptInput('');
                setPromptValidationError(null);
                promptInputRef.current?.focus();
              }}
              aria-label="Clear prompt"
              className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200 cursor-pointer shrink-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Live AI Build Activity Feed while generating */}
        <AnimatePresence>
          {isGenerating && streamProgress && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              aria-live="polite"
              className="mt-3 overflow-hidden rounded-2xl border border-(--mist-c2)/35 bg-gradient-to-br from-(--mist-c2)/10 via-(--mist-c3)/8 to-transparent p-3.5 text-xs"
            >
              <div className="relative h-1 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800 mb-3">
                <div className="mist-shimmer-bar absolute inset-y-0 left-0 w-1/2 rounded-full mist-primary-gradient" />
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MistMark className="h-4 w-4 text-(--mist-c2) shrink-0 animate-pulse" title="Building" />
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
                    className="rounded-lg border border-zinc-300/80 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {streamProgress.searchState && streamProgress.searchState !== 'idle' && (
                <div className="mt-2.5 rounded-xl border border-zinc-200/80 bg-white/80 px-3 py-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-950/60">
                  <div className="flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {streamProgress.searchState === 'searching' ? (
                      <Loader2 className="h-3 w-3 animate-spin text-(--mist-c2)" aria-hidden="true" />
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
                  </div>
                  {streamProgress.searchQueries && streamProgress.searchQueries.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                      {streamProgress.searchQueries.join(' · ')}
                    </p>
                  )}
                </div>
              )}

              {streamProgress.completedFiles.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                  {streamProgress.completedFiles.map((filePath) => (
                    <span
                      key={filePath}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-700 dark:text-emerald-400"
                    >
                      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{filePath}</span>
                    </span>
                  ))}
                  {streamProgress.activeFile && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-(--mist-c2)/10 px-2 py-0.5 font-mono text-(--mist-c2)">
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
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
          >
            <span>{promptValidationError || generationError}</span>
            {!hasApiKey && (
              <button
                type="button"
                onClick={onOpenProviders}
                className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 cursor-pointer"
              >
                Configure Model &amp; Key
              </button>
            )}
          </div>
        )}

        {/* Composer Controls Footer */}
        <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-200/70 pt-3 dark:border-white/[0.07]">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <button
              type="button"
              aria-expanded={quickModelOpen}
              onClick={() => setQuickModelOpen((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeIncidentMatches(modelIncident, providerConfig)
                  ? 'border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-200'
                  : !hasApiKey
                    ? 'border-(--mist-c2)/50 bg-(--mist-c2)/10 text-zinc-900 dark:text-zinc-100'
                    : 'border-zinc-200/90 bg-zinc-50/90 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  hasApiKey ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              <span className="max-w-[130px] sm:max-w-[165px] truncate">{providerLabel}</span>
              {!hasApiKey && (
                <span className="text-[10px] font-semibold text-(--mist-c2)">· Add key</span>
              )}
              <ChevronDown
                className={`h-3 w-3 opacity-60 transition-transform duration-150 ${quickModelOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={onOpenVoiceChat}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200/90 bg-zinc-50/90 px-2.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mic className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
              <span>Voice</span>
            </button>

            <PillPopoverSelect
              icon={Globe}
              iconClassName={
                webSearchMode === 'on'
                  ? 'text-(--mist-c2)'
                  : webSearchMode === 'auto'
                    ? 'text-emerald-500'
                    : 'text-zinc-400'
              }
              label="Web Search mode"
              value={webSearchMode}
              options={webSearchOptions}
              onChange={onChangeWebSearchMode}
            />

            <PillPopoverSelect
              icon={Wand2}
              iconClassName={appAiActiveForPrompt ? 'text-(--mist-c3)' : 'text-zinc-400'}
              label="Generated App AI behavior"
              value={appAiMode}
              options={appAiOptions}
              onChange={onChangeAppAiMode}
            />

            {webSearchMode === 'on' && !hasWebSearchKey && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex h-8 items-center rounded-xl border border-amber-300/80 bg-amber-50 px-2.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer whitespace-nowrap"
              >
                Search Key
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 shrink-0">
            {!user && (
              <span className="hidden xl:inline text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                Prompt saved on sign-in
              </span>
            )}
            <button
              type="submit"
              disabled={isGenerating}
              className="inline-flex h-10 w-full sm:w-auto items-center justify-center gap-2 rounded-xl mist-primary-gradient px-4 text-xs sm:text-sm font-semibold text-white disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Building...</span>
                </>
              ) : (
                <>
                  <MistMark className="h-4 w-4" title="Generate" />
                  <span>Build Website</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Expandable Quick BYOK Model & Gateway Drawer */}
        <AnimatePresence initial={false}>
          {quickModelOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3.5 space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-950/80">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mr-1">
                      Gateway:
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
                            ? 'border-(--mist-c2) bg-(--mist-c2)/12 text-zinc-950 dark:text-white'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {gw.name}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={onOpenProviders}
                    className="text-[11px] font-semibold text-(--mist-c2) hover:underline cursor-pointer"
                  >
                    Manage Keys &amp; Endpoint &rarr;
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1.5 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                  <span>
                    Active Key:{' '}
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                      {maskApiKey(providerConfig.apiKey) || 'Not configured'}
                    </span>
                  </span>
                  <span>
                    {user?.email
                      ? providerConfig.sessionOnlyKey
                        ? 'Session memory only'
                        : `Encrypted vault · ${user.email}`
                      : 'Sign in to sync key securely'}
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

      {/* Lightweight Mode Starter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 mist-scrollbar">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
          Try:
        </span>
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
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                isSelected
                  ? 'border-(--mist-c2)/70 bg-(--mist-c2)/10 text-zinc-950 dark:text-white'
                  : 'border-zinc-200/80 bg-white/70 text-zinc-600 hover:border-zinc-300 hover:text-zinc-950 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderShowcaseWalkthrough = () => (
    <section
      id="workflow"
      aria-label="How Mist builds websites"
      className="mx-auto max-w-6xl px-4 sm:px-6 py-12"
    >
      <div className="mist-surface-card rounded-3xl p-5 sm:p-8">
        <div className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Workflow
          </p>
          <h2 className="mt-1.5 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
            From prompt to standalone site
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-5 flex flex-col justify-between gap-2.5">
            {WORKFLOW_STEPS.map((item, idx) => {
              const isActive = idx === activeShowcaseStep;
              return (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => setActiveShowcaseStep(idx)}
                  className={`flex-1 rounded-2xl border p-4 text-left transition-all cursor-pointer ${
                    isActive
                      ? 'mist-gradient-border shadow-md'
                      : 'border-zinc-200/80 bg-zinc-50/70 hover:bg-zinc-100/80 dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-zinc-950 dark:text-white">
                      <span className="font-mono text-xs text-(--mist-c2) mr-2">{item.step}</span>
                      {item.title}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {item.caption}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-7 relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800 lg:min-h-[340px] flex flex-col justify-end">
            <div className="relative h-52 sm:h-60 lg:absolute lg:inset-0 lg:h-full w-full overflow-hidden">
              <img
                src={currentStepData.image}
                alt={currentStepData.alt}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover object-center transition-opacity duration-300"
              />
              <div
                aria-hidden="true"
                className="hidden lg:block absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10"
              />
            </div>
            <div className="relative z-10 bg-zinc-950 lg:bg-transparent p-5 text-white space-y-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-300 font-mono">
                <span>Step {currentStepData.step}</span>
                <span aria-hidden="true">·</span>
                <span>{currentStepData.sampleFiles.join(' · ')}</span>
              </div>
              <p className="font-mono text-xs sm:text-sm text-zinc-100 bg-black/60 border border-white/15 rounded-xl px-3.5 py-2.5 backdrop-blur-sm">
                {currentStepData.samplePrompt}
              </p>
              <p className="text-xs text-zinc-200 leading-relaxed">
                {currentStepData.outcome}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const thumbGradient = (seed: string) => {
    const palettes = [
      'from-(--mist-c1) via-(--mist-c2) to-(--mist-c3)',
      'from-(--mist-c5) via-(--mist-c4) to-(--mist-c3)',
      'from-(--mist-c2) via-(--mist-c3) to-(--mist-c4)',
      'from-(--mist-c1) via-(--mist-c5) to-(--mist-c4)',
      'from-(--mist-c3) via-(--mist-c2) to-(--mist-c1)',
      'from-(--mist-c4) via-(--mist-c5) to-(--mist-c1)',
    ];
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i) * (i + 7)) >>> 0;
    return palettes[h % palettes.length];
  };

  // ================= SIGNED-OUT: Product Landing =================
  if (!user) {
    const features = [
      {
        icon: Mic,
        title: 'Talk it into existence',
        body: 'Describe your idea aloud in Voice Studio and turn conversations directly into working React apps.',
      },
      {
        icon: KeyRound,
        title: 'Your keys, your models',
        body: 'Connect OpenRouter, Groq, Gemini, OpenAI, or any OpenAI-compatible gateway. Keys stay AES-256-GCM encrypted in your account vault.',
      },
      {
        icon: MousePointerClick,
        title: 'Click anything to edit',
        body: 'Inspect any heading, button, or container visually to tweak copy, colors, and spacing live — or refine via chat.',
      },
      {
        icon: Globe,
        title: 'Verified web research',
        body: 'Ground generated sites in real-time web results with DuckDuckGo or Brave Search citations.',
      },
      {
        icon: Gamepad2,
        title: 'Apps, games & 3D scenes',
        body: 'Build SaaS tools, playable HTML5 Canvas games, and interactive Three.js 3D experiences from one studio.',
      },
      {
        icon: Download,
        title: 'Own every line of code',
        body: 'Export clean React + TypeScript + Tailwind ZIP bundles or deploy directly to Render Static Sites with zero lock-in.',
      },
    ];

    return (
      <div className="mist-ambient-canvas min-h-screen flex flex-col overflow-x-hidden">
        <header className="sticky top-0 z-30 border-b border-zinc-900/[0.07] bg-[var(--mist-canvas)]/82 backdrop-blur-xl dark:border-white/[0.07]">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <a href="#top" className="shrink-0 focus:outline-none">
              <MistLogo size="md" />
            </a>

            <nav aria-label="Primary" className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {[
                ['#templates', 'Templates'],
                ['#features', 'Capabilities'],
                ['#workflow', 'Workflow'],
              ].map(([href, label]) => (
                <a key={href} href={href} className="hover:text-zinc-950 dark:hover:text-white transition-colors">
                  {label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {themeButton}
              <button
                type="button"
                onClick={onOpenAccount}
                className="hidden sm:inline-flex h-9 items-center rounded-xl px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={onOpenAccount}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl mist-primary-gradient px-3.5 text-sm font-semibold cursor-pointer"
              >
                Get started
              </button>
              <button
                type="button"
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle navigation menu"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-900/5 dark:hover:bg-white/10 cursor-pointer"
              >
                {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="md:hidden overflow-hidden border-t border-zinc-900/[0.06] dark:border-white/[0.06]"
              >
                <div className="flex flex-col gap-1 p-3">
                  {[
                    ['#templates', 'Templates'],
                    ['#features', 'Capabilities'],
                    ['#workflow', 'Workflow'],
                  ].map(([href, label]) => (
                    <a
                      key={href}
                      href={href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-200 dark:hover:bg-white/10"
                    >
                      {label}
                    </a>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenAccount();
                    }}
                    className="mt-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white cursor-pointer"
                  >
                    Sign in to Mist
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <main id="top" className="flex-1">
          {/* Hero */}
          <section className="mist-hero-aurora mx-auto grid max-w-6xl items-start gap-10 px-4 sm:px-6 pt-12 pb-16 sm:pt-18 lg:grid-cols-[1.18fr_0.82fr] lg:gap-12 lg:pt-20">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              className="min-w-0"
            >
              <p className="inline-flex items-center gap-2 rounded-full border border-zinc-900/10 bg-white/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-600 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                <span className="h-1.5 w-1.5 rounded-full mist-primary-gradient" aria-hidden="true" />
                prompt · visual edit · ship
              </p>
              <h1 className="mt-5 font-display text-4xl sm:text-6xl font-semibold leading-[1.03] text-zinc-950 dark:text-white">
                Say the idea.<br />
                <span className="mist-gradient-text">Watch it take shape.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base sm:text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Mist builds complete React, TypeScript, and Tailwind CSS web apps from a single prompt—with live visual editing, voice studio, and clean code you own.
              </p>

              <div className="mt-7">{composerBlock}</div>
            </motion.div>

            {/* Interactive Preview Card synchronized with selected mode */}
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="hidden lg:block sticky top-24"
            >
              <div className="mist-mesh mist-grain relative overflow-hidden rounded-[24px] p-5 shadow-2xl shadow-zinc-900/15">
                <div className="relative z-10 overflow-hidden rounded-2xl bg-white/95 shadow-lg backdrop-blur dark:bg-zinc-950/90">
                  <div className="flex items-center justify-between border-b border-zinc-900/5 px-3.5 py-2.5 dark:border-white/10">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                    </div>
                    <span className="rounded-md bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                      {activeModeObj.previewDomain}
                    </span>
                    <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
                      LIVE
                    </span>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-xs font-semibold text-zinc-900 dark:text-white">
                        {activeModeObj.previewTitle}
                      </span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                        {activeModeObj.label}
                      </span>
                    </div>
                    <div className="h-28 rounded-xl mist-mesh opacity-85 flex items-end p-3">
                      <div className="rounded-lg bg-black/45 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                        Visual Inspector · Click any element
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {activeModeObj.previewFiles.map((file) => (
                        <div
                          key={file}
                          className="rounded-lg border border-zinc-200/80 bg-zinc-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/70"
                        >
                          <p className="truncate font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
                            {file.split('/').pop()}
                          </p>
                          <p className="mt-0.5 text-[9px] text-emerald-600 dark:text-emerald-400">Ready</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="relative z-10 mt-4 rounded-xl bg-zinc-950/88 p-3.5 font-mono text-[11px] text-zinc-300 backdrop-blur border border-white/10 space-y-1">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>React + TypeScript + Tailwind compiled</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>Visual editor &amp; ZIP export ready</span>
                  </p>
                </div>
              </div>
            </motion.div>
          </section>

          {/* Interactive Templates Gallery */}
          <section id="templates" className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-t border-zinc-900/[0.08] pt-10 dark:border-white/[0.08]">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  01 — Live Templates
                </p>
                <h2 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-zinc-950 dark:text-white">
                  Start from a working studio project
                </h2>
              </div>
              <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
                Open any template immediately in the live Mist editor, or copy its prompt to remix.
              </p>
            </div>

            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="mist-project-card group flex flex-col overflow-hidden rounded-2xl p-2"
                >
                  <button
                    type="button"
                    onClick={() => onOpenTemplate(tpl)}
                    className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl cursor-pointer text-left"
                  >
                    <img
                      src={TEMPLATE_PREVIEW_IMAGES[tpl.id] || tpl.previewImage}
                      alt={tpl.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                    <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
                      {tpl.category}
                    </span>
                    <span className="absolute inset-x-3 bottom-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/95 py-2 text-xs font-semibold text-zinc-950 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all">
                      <span>Open in Studio</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </button>

                  <div className="flex flex-1 flex-col justify-between p-2.5">
                    <div>
                      <h3 className="font-display text-sm font-semibold text-zinc-950 dark:text-white">
                        {tpl.name}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                        {tpl.description}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center gap-2 pt-2 border-t border-zinc-200/70 dark:border-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => onOpenTemplate(tpl)}
                        className="flex-1 rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
                      >
                        Open Studio
                      </button>
                      <button
                        type="button"
                        onClick={() => focusComposer(tpl.prompt)}
                        className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        Use Prompt
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Capabilities Bento */}
          <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
            <div className="border-t border-zinc-900/[0.08] pt-10 dark:border-white/[0.08]">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                02 — Capabilities
              </p>
              <h2 className="mt-2 max-w-2xl font-display text-3xl sm:text-4xl font-semibold text-zinc-950 dark:text-white">
                Built for speed, precision, and full ownership
              </h2>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, body }, i) => (
                <div
                  key={title}
                  className={`relative overflow-hidden rounded-2xl p-6 ${
                    i === 0
                      ? 'mist-mesh mist-grain text-zinc-950 sm:col-span-2 lg:col-span-1 lg:row-span-2 flex flex-col justify-end min-h-[220px]'
                      : 'mist-surface-card'
                  }`}
                >
                  <span
                    className={`relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                      i === 0
                        ? 'bg-white/85 text-zinc-950 shadow-sm'
                        : 'bg-zinc-900/5 text-zinc-900 dark:bg-white/10 dark:text-white'
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <h3 className={`relative z-10 mt-4 font-display font-semibold ${i === 0 ? 'text-2xl' : 'text-base text-zinc-950 dark:text-white'}`}>
                    {title}
                  </h3>
                  <p className={`relative z-10 mt-1.5 text-sm leading-relaxed ${i === 0 ? 'text-zinc-900/85' : 'text-zinc-600 dark:text-zinc-400'}`}>
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {renderShowcaseWalkthrough()}

          {/* Bottom CTA */}
          <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
            <div className="mist-mesh mist-grain relative overflow-hidden rounded-3xl px-6 py-12 sm:px-12 sm:py-16">
              <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-display text-3xl sm:text-5xl font-semibold text-zinc-950">
                    Your next app is one prompt away.
                  </h2>
                  <p className="mt-3 max-w-md text-zinc-900/80">
                    Bring your own model key, refine visually, and export clean React code whenever you want.
                  </p>
                </div>
                <div className="flex flex-wrap shrink-0 gap-2.5">
                  <button
                    type="button"
                    onClick={onOpenAccount}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <span>Create free account</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => focusComposer()}
                    className="inline-flex h-11 items-center rounded-xl bg-white/80 px-5 text-sm font-semibold text-zinc-950 hover:bg-white transition-colors cursor-pointer"
                  >
                    Try a prompt
                  </button>
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-zinc-900/[0.07] py-8 dark:border-white/[0.07]">
          <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 text-sm text-zinc-500">
            <MistLogo size="sm" />
            <span className="font-mono text-xs">ideas → live web apps</span>
          </div>
        </footer>
      </div>
    );
  }

  // ================= SIGNED-IN: Studio Dashboard =================
  const navItems = [
    { icon: Plus, label: 'New', onClick: () => focusComposer('') },
    {
      icon: Search,
      label: 'Projects',
      onClick: () => {
        document.getElementById('projects')?.scrollIntoView({ behavior: 'smooth' });
        window.setTimeout(() => projectSearchRef.current?.focus(), 250);
      },
    },
    { icon: Mic, label: 'Voice', onClick: onOpenVoiceChat },
    { icon: KeyRound, label: 'Models & Keys', onClick: onOpenProviders },
    { icon: Globe, label: 'Hosting', onClick: onOpenDeployments },
    { icon: Settings, label: 'Settings', onClick: onOpenSettings },
  ];

  const recent = [...projects].slice(0, 4);
  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const publishedCount = projects.filter((p) => p.isPublished).length;

  return (
    <div className="mist-ambient-canvas min-h-screen overflow-x-hidden">
      {/* Studio Top Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-900/[0.07] bg-[var(--mist-canvas)]/82 backdrop-blur-xl dark:border-white/[0.07]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <MistLogo size="md" />

          <nav
            aria-label="Studio"
            className="mx-auto hidden md:flex items-center gap-0.5 rounded-xl border border-zinc-900/[0.06] bg-zinc-900/[0.03] p-1 dark:border-white/[0.06] dark:bg-white/[0.04]"
          >
            {navItems.map(({ icon: Icon, label, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-600 hover:bg-white hover:text-zinc-950 hover:shadow-xs dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white transition-all cursor-pointer"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="ml-auto md:ml-0 flex items-center gap-1.5">
            {themeButton}
            <button
              type="button"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle studio menu"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-900/5 dark:hover:bg-white/10 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={onOpenAccount}
              aria-label="Account"
              title={user.email || 'Account'}
              className="rounded-full p-0.5 ring-1 ring-zinc-900/15 hover:ring-zinc-900/35 dark:ring-white/15 dark:hover:ring-white/40 transition cursor-pointer"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full mist-primary-gradient text-xs font-semibold text-white">
                  {firstName.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden overflow-hidden border-t border-zinc-900/[0.06] dark:border-white/[0.06]"
            >
              <div className="grid grid-cols-2 gap-2 p-3">
                {[...navItems, { icon: UserIcon, label: 'Account', onClick: onOpenAccount }].map(
                  ({ icon: Icon, label, onClick }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onClick();
                      }}
                      className="flex min-h-[44px] items-center gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 text-sm font-medium text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                    >
                      <Icon className="h-4 w-4 text-(--mist-c2)" aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ),
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main id="top">
        {/* Studio Hero & Composer */}
        <section className="mist-hero-aurora mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 pt-10 pb-12 sm:pt-12 lg:grid-cols-[1fr_290px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                {todayLabel}
              </p>
              {!hasApiKey && (
                <button
                  type="button"
                  onClick={onOpenProviders}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200 cursor-pointer"
                >
                  <KeyRound className="h-3 w-3" aria-hidden="true" />
                  <span>Add BYOK API key to generate</span>
                </button>
              )}
            </div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 font-display text-3xl sm:text-[42px] font-semibold leading-tight text-zinc-950 dark:text-white"
            >
              {greeting}, <span className="mist-gradient-text">{firstName}</span>.
            </motion.h1>
            <p className="mt-1 text-sm sm:text-base text-zinc-500 dark:text-zinc-400">
              What are we building today?
            </p>

            <div className="mt-6">{composerBlock}</div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
              <button
                type="button"
                onClick={() => setShowLoggedInTour((v) => !v)}
                className="font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white underline-offset-4 hover:underline cursor-pointer"
              >
                {showLoggedInTour ? 'Hide workflow guide' : 'How Mist works'}
              </button>
            </div>
          </div>

          {/* Right Studio Overview Rail */}
          <aside className="hidden lg:flex flex-col gap-3 pt-12">
            <div className="mist-surface-card rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Studio overview</p>
                <button
                  type="button"
                  onClick={onOpenProviders}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-(--mist-c2) hover:underline cursor-pointer"
                >
                  <Cpu className="h-3 w-3" aria-hidden="true" />
                  <span>{hasApiKey ? 'Key ready' : 'Add key'}</span>
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-zinc-900/[0.03] p-3 dark:bg-white/[0.04]">
                  <p className="font-display text-2xl font-semibold tabular-nums">{projects.length}</p>
                  <p className="text-[11px] text-zinc-500">projects</p>
                </div>
                <div className="rounded-xl bg-zinc-900/[0.03] p-3 dark:bg-white/[0.04]">
                  <p className="font-display text-2xl font-semibold tabular-nums">{publishedCount}</p>
                  <p className="text-[11px] text-zinc-500">exported / live</p>
                </div>
              </div>
            </div>

            <div className="mist-surface-card rounded-2xl p-3">
              <p className="px-1.5 pb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Jump back in
              </p>
              {recent.length === 0 ? (
                <div className="space-y-1.5 px-1.5 pb-1">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Launch a starter template:
                  </p>
                  {templates.slice(0, 2).map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => onOpenTemplate(tpl)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-200/80 px-2.5 py-1.5 text-left text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-white/5 cursor-pointer"
                    >
                      <span className="truncate">{tpl.name}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {recent.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onOpenProject(p)}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-xs font-medium hover:bg-zinc-900/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <span
                        className={`h-6 w-6 shrink-0 rounded-lg bg-gradient-to-br ${thumbGradient(p.id)} flex items-center justify-center text-[10px] font-bold text-white`}
                      >
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-zinc-900 dark:text-zinc-100">{p.name}</p>
                        <p className="text-[10px] text-zinc-500">{formatRelativeDate(p.updatedAt)}</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>

        {showLoggedInTour && renderShowcaseWalkthrough()}

        {/* Projects Gallery */}
        <section id="projects" className="mx-auto max-w-6xl px-4 sm:px-6 pb-12">
          <div className="mist-surface-card rounded-3xl p-4 sm:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900 self-start">
                {(
                  [
                    ['all', 'All projects'],
                    ['published', 'Published'],
                    ['draft', 'Drafts'],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setProjectFilter(tab)}
                    className={`relative rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                      projectFilter === tab
                        ? 'text-zinc-950 dark:text-white'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {projectFilter === tab && (
                      <motion.span
                        layoutId="mist-project-filter-pill"
                        transition={{ type: 'spring', bounce: 0.18, duration: 0.35 }}
                        className="absolute inset-0 rounded-lg bg-white shadow-xs dark:bg-zinc-800"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-72">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  ref={projectSearchRef}
                  type="search"
                  aria-label="Search projects"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your projects..."
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-white/80 pl-9 pr-4 text-xs sm:text-sm placeholder:text-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900/70"
                />
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-zinc-300/90 p-8 sm:p-10 text-center dark:border-zinc-800">
                <FolderOpen className="mx-auto h-7 w-7 text-zinc-400" aria-hidden="true" />
                <h3 className="mt-3 font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {projects.length === 0 ? 'Create your first project' : 'No matching projects'}
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-zinc-500 max-w-md mx-auto">
                  {projects.length === 0
                    ? 'Describe an idea above or launch a starter template to explore the visual editor.'
                    : 'Try adjusting your search query or switching project tabs.'}
                </p>
                {projects.length === 0 && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => focusComposer()}
                      className="inline-flex h-10 items-center gap-2 rounded-xl mist-primary-gradient px-4 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Write a prompt</span>
                    </button>
                    {templates[0] && (
                      <button
                        type="button"
                        onClick={() => onOpenTemplate(templates[0])}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-xs sm:text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        <Code2 className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden="true" />
                        <span>Try {templates[0].name}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredProjects.map((project, index) => {
                  const isConfirmingDelete = confirmDeleteId === project.id;
                  return (
                    <motion.div
                      key={project.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(index * 0.025, 0.16) }}
                      className="mist-project-card group rounded-2xl p-2.5 flex flex-col"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenProject(project)}
                        className="relative block aspect-[16/10] w-full overflow-hidden rounded-xl border border-zinc-200/70 dark:border-zinc-800 cursor-pointer"
                      >
                        <div
                          className={`absolute inset-0 bg-gradient-to-br ${thumbGradient(project.id)} opacity-90 group-hover:scale-105 transition-transform duration-500`}
                        />
                        <span className="absolute inset-0 flex items-center justify-center font-display text-5xl font-semibold text-white/90">
                          {project.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="absolute left-3 top-3 rounded-full bg-black/35 px-2.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                          {project.isPublished ? 'Published' : 'Draft'}
                        </span>
                        <span className="absolute right-3 top-3 rounded-full bg-black/35 px-2 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-sm">
                          {project.files.length} files
                        </span>
                        <span className="absolute inset-x-3 bottom-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 rounded-xl bg-white/95 py-2 text-center text-xs font-semibold text-zinc-950 transition-all shadow-md">
                          Open Studio
                        </span>
                      </button>

                      <div className="mt-3 flex items-start justify-between gap-2 px-1">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => onOpenProject(project)}
                            className="block max-w-full truncate text-left font-display text-sm font-semibold text-zinc-950 hover:underline dark:text-white cursor-pointer"
                          >
                            {project.name}
                          </button>
                          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {formatRelativeDate(project.updatedAt)} · {project.description || project.prompt}
                          </p>
                        </div>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                onDeleteProject(project.id);
                              }}
                              className="rounded-lg bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              aria-label={`Publish ${project.name}`}
                              title="Publish & Export"
                              onClick={() => onPublishProject(project)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-white cursor-pointer"
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Duplicate ${project.name}`}
                              title="Duplicate"
                              onClick={() => onDuplicateProject(project)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-white cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${project.name}`}
                              title="Delete"
                              onClick={() => setConfirmDeleteId(project.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Quick Starter Templates Strip for Signed-In Builders */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-14">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                Starter Templates
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Launch a ready-made multi-file site and customize it visually or with AI.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onOpenTemplate(tpl)}
                className="mist-surface-card group flex items-center gap-3 rounded-2xl p-2.5 text-left hover:border-zinc-300 dark:hover:border-white/20 transition-all cursor-pointer"
              >
                <img
                  src={TEMPLATE_PREVIEW_IMAGES[tpl.id] || tpl.previewImage}
                  alt=""
                  loading="lazy"
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-xs font-semibold text-zinc-950 dark:text-white">
                    {tpl.name}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{tpl.category}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 group-hover:translate-x-0.5 group-hover:text-zinc-900 dark:group-hover:text-white transition-all" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </main>
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
