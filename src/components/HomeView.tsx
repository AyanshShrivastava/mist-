import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Copy,
  Cpu,
  FolderOpen,
  Globe,
  Loader2,
  Menu,
  Mic,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  DeploymentRecord,
  MistProject,
  ProjectSyncRecord,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  findModelEntry,
  getDefaultModelForProvider,
  PRIMARY_STUDIO_PROVIDERS,
  PROVIDER_CATALOG,
  type CustomGatewayId,
} from '../data/models';
import MistLogo, { MistMark } from './MistLogo';
import ModelSelectorDropdown from './ModelSelectorDropdown';

interface HomeViewProps {
  user: User | null;
  projects: MistProject[];
  deployments: DeploymentRecord[];
  providerConfig: AiProviderConfig;
  modelIncident: ModelHealthIncident | null;
  syncRecords: Record<string, ProjectSyncRecord>;
  firestoreConnection: 'checking' | 'online' | 'offline';
  isSyncingAll?: boolean;
  isGenerating: boolean;
  generationError: string | null;
  darkMode: boolean;
  enableAppAi: boolean;
  onToggleDarkMode: () => void;
  onSaveProvider: (next: AiProviderConfig) => void;
  onGenerate: (prompt: string) => void;
  onOpenVoiceChat: () => void;
  onOpenProject: (project: MistProject) => void;
  onDuplicateProject: (project: MistProject) => void;
  onDeleteProject: (projectId: string) => void;
  onSyncAllToCloud?: () => void;
  onOpenProviders: () => void;
  onOpenSettings: () => void;
  onOpenDeployments: () => void;
  onOpenAccount: () => void;
}

const QUICK_PROMPTS = [
  {
    label: 'AI Writing Workspace',
    prompt:
      'Editorial AI writing & editing web app with a clean split workspace, tone controls, and a live AI assistant powered by POST /api/app-ai.',
  },
  {
    label: 'Specialty Coffee Roastery',
    prompt:
      'Minimalist Tokyo specialty coffee roastery website with single-origin menu, brew ratio calculator, and bar reservation.',
  },
  {
    label: 'Architecture Practice',
    prompt:
      'Nordic architecture firm portfolio with selected works table, studio philosophy, and inquiry form.',
  },
  {
    label: 'SaaS Operations Platform',
    prompt:
      'Clean B2B financial operations dashboard marketing site with interactive pricing matrix, security overview, and a live AI Q&A helper.',
  },
];

export default function HomeView({
  user,
  projects,
  deployments,
  providerConfig,
  modelIncident,
  syncRecords,
  firestoreConnection,
  isSyncingAll = false,
  isGenerating,
  generationError,
  darkMode,
  enableAppAi,
  onToggleDarkMode,
  onSaveProvider,
  onGenerate,
  onOpenVoiceChat,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onSyncAllToCloud,
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
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);

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

  const isGeminiMode = providerConfig.provider === 'gemini';
  const activeGatewayId: CustomGatewayId = isGeminiMode
    ? 'openrouter'
    : detectGatewayFromBaseUrl(
        providerConfig.baseUrl ||
          (providerConfig.provider === 'openrouter'
            ? 'https://openrouter.ai/api/v1'
            : providerConfig.provider === 'groq'
              ? 'https://api.groq.com/openai/v1'
              : ''),
      );
  const activeGateway =
    CUSTOM_GATEWAY_PRESETS.find((g) => g.id === activeGatewayId) || CUSTOM_GATEWAY_PRESETS[0];
  const currentModelMeta = findModelEntry(
    providerConfig.provider,
    providerConfig.model,
    providerConfig.baseUrl,
  );
  const providerLabel = isGeminiMode
    ? `Gemini · ${currentModelMeta?.label || providerConfig.model}`
    : `${activeGateway.name} · ${currentModelMeta?.label || providerConfig.model}`;

  const syncedCount = user
    ? projects.filter((p) => syncRecords[p.id]?.state === 'synced').length
    : 0;
  const allProjectsSynced = Boolean(user && projects.length > 0 && syncedCount === projects.length);

  const activeIncidentMatchesCurrent =
    modelIncident &&
    modelIncident.provider === providerConfig.provider &&
    modelIncident.model === providerConfig.model;

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
              className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Models &amp; Keys
            </button>
            <button
              type="button"
              onClick={onOpenDeployments}
              className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Deployments
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
                  <Cpu className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
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
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Deployments</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenSettings();
                  }}
                  className="col-span-2 flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 cursor-pointer"
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
        <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-6 pb-9 sm:pt-16 sm:pb-14 lg:pt-24 lg:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="text-center sm:text-left"
          >
            <p className="text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
              Prompt &rarr; Create &rarr; Deploy
            </p>
            <h1 className="mt-2.5 sm:mt-3 font-display text-[30px] sm:text-5xl lg:text-[56px] font-semibold tracking-tight leading-[1.08] text-zinc-950 dark:text-white [text-wrap:balance]">
              Mist —{' '}
              <span className="bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-500 dark:from-blue-400 dark:via-indigo-300 dark:to-sky-400 bg-clip-text text-transparent">
                Ideas into websites.
              </span>
            </h1>
            <p className="mt-3 sm:mt-4 text-sm sm:text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto sm:mx-0">
              Describe a website or talk through your idea live. Mist builds multi-file React, TypeScript, and Tailwind CSS sites — including live AI features powered by <code className="font-mono text-xs text-zinc-800 dark:text-zinc-200 whitespace-nowrap">/api/app-ai</code>.
            </p>
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
              placeholder="Describe your website: e.g., A customer research hub with a live AI transcript summarizer and clean responsive layout..."
              className="w-full resize-none bg-transparent text-sm sm:text-base text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />

            {(promptValidationError || generationError) && (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
              >
                {promptValidationError || generationError}
              </div>
            )}

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-800/80">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 min-w-0">
                <button
                  type="button"
                  aria-expanded={quickModelOpen}
                  onClick={() => setQuickModelOpen((v) => !v)}
                  className={`inline-flex min-h-[44px] sm:min-h-[34px] items-center justify-between sm:justify-start gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeIncidentMatchesCurrent
                      ? 'border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-200'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span className="max-w-[96px] sm:max-w-[180px] truncate">{providerLabel}</span>
                    {currentModelMeta && (
                      <span
                        className={`hidden sm:inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          currentModelMeta.billing === 'free'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {currentModelMeta.billingLabel}
                      </span>
                    )}
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

                {enableAppAi && (
                  <span className="hidden xl:inline text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    · App AI ready
                  </span>
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
                  className="inline-flex min-h-[48px] sm:min-h-[40px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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

            {/* Expandable Quick Model Switcher Drawer inside Composer (Gemini + Custom only) */}
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
                        {PRIMARY_STUDIO_PROVIDERS.map((pid) => {
                          const selected =
                            pid === 'gemini' ? isGeminiMode : !isGeminiMode;
                          return (
                            <button
                              key={pid}
                              type="button"
                              onClick={() => {
                                if (pid === 'gemini') {
                                  onSaveProvider({
                                    ...providerConfig,
                                    provider: 'gemini',
                                    model: getDefaultModelForProvider('gemini'),
                                  });
                                } else {
                                  const gw = CUSTOM_GATEWAY_PRESETS[0];
                                  onSaveProvider({
                                    ...providerConfig,
                                    provider: 'custom',
                                    baseUrl: providerConfig.baseUrl || gw.baseUrl,
                                    model: gw.models[0].id,
                                  });
                                }
                              }}
                              className={`min-h-[34px] rounded-lg border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                                selected
                                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-500/15 dark:text-blue-300'
                                  : 'border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                              }`}
                            >
                              {PROVIDER_CATALOG[pid].name}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={onOpenProviders}
                        className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                      >
                        API Keys &amp; Endpoint Setup &rarr;
                      </button>
                    </div>

                    {!isGeminiMode && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 mr-1">
                          Preset:
                        </span>
                        {CUSTOM_GATEWAY_PRESETS.map((gw) => (
                          <button
                            key={gw.id}
                            type="button"
                            onClick={() =>
                              onSaveProvider({
                                ...providerConfig,
                                provider: 'custom',
                                baseUrl: gw.baseUrl || providerConfig.baseUrl || '',
                                model: gw.models[0].id,
                              })
                            }
                            className={`min-h-[28px] rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                              activeGatewayId === gw.id
                                ? 'border-blue-500/70 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                                : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'
                            }`}
                          >
                            {gw.name}
                          </button>
                        ))}
                      </div>
                    )}

                    <ModelSelectorDropdown
                      provider={isGeminiMode ? 'gemini' : 'custom'}
                      value={providerConfig.model}
                      modelsOverride={!isGeminiMode ? activeGateway.models : undefined}
                      gatewayLabel={!isGeminiMode ? activeGateway.name : 'Gemini'}
                      compact
                      onChange={(nextModel) =>
                        onSaveProvider({
                          ...providerConfig,
                          provider: isGeminiMode ? 'gemini' : 'custom',
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
              {QUICK_PROMPTS.map((item) => (
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
                  className="min-h-[42px] sm:min-h-[30px] rounded-xl sm:rounded-lg border border-zinc-200/90 bg-white/90 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 transition-colors truncate sm:whitespace-nowrap sm:shrink-0 cursor-pointer"
                >
                  {item.label}
                </motion.button>
              ))}
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
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">
                    Your Websites
                  </h2>
                  {user && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[11px] font-medium ${
                        firestoreConnection === 'offline'
                          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300'
                          : allProjectsSynced || projects.length === 0
                            ? 'border-emerald-300/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'border-blue-300/80 bg-blue-50 text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/40 dark:text-blue-300'
                      }`}
                    >
                      {firestoreConnection === 'offline' ? (
                        <CloudOff className="h-3 w-3" aria-hidden="true" />
                      ) : allProjectsSynced || projects.length === 0 ? (
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Cloud className="h-3 w-3" aria-hidden="true" />
                      )}
                      <span>
                        {firestoreConnection === 'offline'
                          ? 'Firestore offline (saved locally)'
                          : projects.length === 0
                            ? 'Firestore connected'
                            : allProjectsSynced
                              ? `All ${projects.length} synced to Firestore`
                              : `${syncedCount}/${projects.length} synced to Firestore`}
                      </span>
                    </span>
                  )}
                  {user && projects.length > 0 && !allProjectsSynced && onSyncAllToCloud && (
                    <button
                      type="button"
                      disabled={isSyncingAll}
                      onClick={onSyncAllToCloud}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      <RefreshCw className={`h-3 w-3 ${isSyncingAll ? 'animate-spin' : ''}`} aria-hidden="true" />
                      <span>{isSyncingAll ? 'Syncing...' : 'Sync all'}</span>
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {user
                    ? `All projects saved to Firestore for ${user.email}`
                    : 'Sign in with Google to save every website you create across sessions and devices.'}
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
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
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
                {filteredProjects.map((project, index) => {
                  const sync = syncRecords[project.id];
                  const syncLabel = !user
                    ? 'Local only (Sign in to sync)'
                    : sync?.state === 'syncing'
                      ? 'Syncing...'
                      : sync?.state === 'error'
                        ? 'Sync error'
                        : sync?.state === 'synced'
                          ? 'Synced in Firestore'
                          : 'Pending Firestore sync';
                  const syncTone = !user
                    ? 'text-zinc-500 dark:text-zinc-400'
                    : sync?.state === 'syncing'
                      ? 'text-blue-600 dark:text-blue-400'
                      : sync?.state === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : sync?.state === 'synced'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-300';

                  return (
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
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {project.files.length} files
                        </span>
                        <span className="text-xs text-zinc-400">·</span>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${syncTone}`}>
                          {!user ? (
                            <CloudOff className="h-3 w-3" aria-hidden="true" />
                          ) : sync?.state === 'syncing' ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : sync?.state === 'synced' ? (
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <Cloud className="h-3 w-3" aria-hidden="true" />
                          )}
                          <span>{syncLabel}</span>
                        </span>
                        {project.isPublished && project.publishedSlug && (
                          <>
                            <span className="text-xs text-zinc-400">·</span>
                            <a
                              href={`/p/${project.publishedSlug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                            >
                              <Globe className="h-3 w-3" aria-hidden="true" />
                              <span>/p/{project.publishedSlug}</span>
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
                  );
                })}
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
