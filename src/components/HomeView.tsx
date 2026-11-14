import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  Cpu,
  FolderOpen,
  Globe,
  Loader2,
  Mic,
  Moon,
  Search,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  DeploymentRecord,
  MistProject,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import MistLogo from './MistLogo';

interface HomeViewProps {
  user: User | null;
  projects: MistProject[];
  deployments: DeploymentRecord[];
  providerConfig: AiProviderConfig;
  modelIncident: ModelHealthIncident | null;
  isGenerating: boolean;
  generationError: string | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onGenerate: (prompt: string) => void;
  onOpenVoiceChat: () => void;
  onOpenProject: (project: MistProject) => void;
  onDuplicateProject: (project: MistProject) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenProviders: () => void;
  onOpenDeployments: () => void;
  onOpenAccount: () => void;
}

const QUICK_PROMPTS = [
  {
    label: 'Specialty Coffee Roastery',
    prompt:
      'Minimalist Tokyo specialty coffee roastery website with single-origin menu, brew ratio guide, and bar reservation.',
  },
  {
    label: 'Architecture Practice',
    prompt:
      'Nordic architecture firm portfolio with selected works table, studio philosophy, and inquiry form.',
  },
  {
    label: 'Audio Hardware Launch',
    prompt:
      'Precision desktop analog audio interface launch page with measured specs and anodized finish selector.',
  },
  {
    label: 'SaaS Analytics Platform',
    prompt:
      'Clean B2B financial operations dashboard marketing site with interactive pricing matrix and security overview.',
  },
];

export default function HomeView({
  user,
  projects,
  deployments,
  providerConfig,
  modelIncident,
  isGenerating,
  generationError,
  darkMode,
  onToggleDarkMode,
  onGenerate,
  onOpenVoiceChat,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onOpenProviders,
  onOpenDeployments,
  onOpenAccount,
}: HomeViewProps) {
  const [promptInput, setPromptInput] = useState('');
  const [promptValidationError, setPromptValidationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<'all' | 'published' | 'draft'>('all');
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

  const providerLabel =
    providerConfig.provider === 'gemini'
      ? `Gemini · ${providerConfig.model}`
      : `${
          providerConfig.provider === 'openrouter'
            ? 'OpenRouter'
            : providerConfig.provider === 'groq'
              ? 'Groq'
              : 'Custom'
        } · ${providerConfig.model}`;

  const activeIncidentMatchesCurrent =
    modelIncident &&
    modelIncident.provider === providerConfig.provider &&
    modelIncident.model === providerConfig.model;

  return (
    <div className="mist-ambient-canvas min-h-screen text-[#09090B] dark:text-[#FAFAFA] flex flex-col transition-colors duration-300">
      {/* Three-Zone Studio Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#FAFAFA]/80 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-[#09090B]/75">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 py-3.5">
          <a href="#top" className="focus:outline-none">
            <MistLogo size="md" />
          </a>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600 dark:text-zinc-400"
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
              <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
              <span>Voice Studio</span>
            </button>
            <button
              type="button"
              onClick={onOpenProviders}
              className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Providers
            </button>
            <button
              type="button"
              onClick={onOpenDeployments}
              className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Deployments
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Switch to light studio' : 'Switch to dark studio'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white/70 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {darkMode ? (
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={onOpenAccount}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-3.5 sm:px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{user ? user.displayName?.split(' ')[0] || 'Account' : 'Sign In'}</span>
            </motion.button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Prompt Composer */}
        <section className="mx-auto max-w-4xl px-4 sm:px-6 pt-12 pb-16 sm:pt-18 lg:pt-24 lg:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="text-center sm:text-left"
          >
            <p className="text-xs font-medium tracking-wide text-blue-600 dark:text-blue-400">
              Prompt &rarr; Create &rarr; Deploy
            </p>
            <h1 className="mt-3 font-display text-4xl sm:text-5xl lg:text-[56px] font-semibold tracking-tight leading-[1.06] text-zinc-950 dark:text-white [text-wrap:balance]">
              Mist —{' '}
              <span className="bg-gradient-to-r from-blue-500 via-indigo-400 to-sky-400 bg-clip-text text-transparent">
                Ideas into websites.
              </span>
            </h1>
            <p className="mt-4 text-base sm:text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto sm:mx-0">
              Describe what you want to build or talk it through live. Mist turns ideas into editable React, TypeScript, and Tailwind CSS websites ready to preview, refine, export, and publish.
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
                  onClick={onOpenProviders}
                  className="self-start sm:self-center rounded-lg border border-amber-400/70 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-amber-950 hover:bg-white dark:border-amber-600/50 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
            transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="mist-composer-shell mt-8 rounded-2xl border border-zinc-200/90 p-4 sm:p-5 dark:border-zinc-800/90 focus-within:border-blue-500/70 dark:focus-within:border-blue-500/60 transition-colors"
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
              placeholder="Describe your website: e.g., An editorial portfolio for a Kyoto ceramic studio with gallery grid, firing schedule, and workshop booking..."
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
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenProviders}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeIncidentMatchesCurrent
                      ? 'border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-700/70 dark:bg-amber-950/50 dark:text-amber-200'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Cpu className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  <span className="max-w-[190px] truncate">{providerLabel}</span>
                </button>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={onOpenVoiceChat}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Mic className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  <span>Voice Chat</span>
                </motion.button>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3">
                {!user && (
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Sign in required to build
                  </span>
                )}
                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.97 }}
                  disabled={isGenerating}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Building Website...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      <span>Generate Website</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.form>

          {/* Compact Mobile Quick Actions Bar */}
          <div className="mt-4 flex md:hidden items-center justify-center gap-2">
            <button
              type="button"
              onClick={onOpenProviders}
              className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300"
            >
              Providers
            </button>
            <button
              type="button"
              onClick={onOpenDeployments}
              className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300"
            >
              Deployments
            </button>
          </div>

          {/* Starter Prompt Suggestions */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.16 }}
            className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-2"
          >
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-1">
              Try a prompt:
            </span>
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setPromptInput(item.prompt);
                  setPromptValidationError(null);
                  promptInputRef.current?.focus();
                }}
                className="rounded-lg border border-zinc-200/90 bg-white/80 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        </section>

        {/* Saved Websites Management */}
        <section
          id="projects"
          className="border-t border-zinc-200/80 bg-white/50 py-14 dark:border-zinc-800/80 dark:bg-zinc-950/40"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">
                  Your Websites
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {user
                    ? `Synced to your cloud workspace for ${user.email}`
                    : 'Sign in with Google to generate websites and sync them across devices.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 sm:flex-initial">
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
                    className="w-full sm:w-52 rounded-lg border border-zinc-200 bg-white pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>

                <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
                  {(['all', 'published', 'draft'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setProjectFilter(tab)}
                      className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        projectFilter === tab
                          ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white'
                          : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/80 p-10 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Start from a Prompt</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenVoiceChat}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors"
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

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project)}
                        className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
                      >
                        Open Editor
                      </button>
                      <button
                        type="button"
                        aria-label={`Duplicate ${project.name}`}
                        onClick={() => onDuplicateProject(project)}
                        className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${project.name}`}
                        onClick={() => onDeleteProject(project.id)}
                        className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:bg-red-950/60 dark:hover:text-red-400 transition-colors cursor-pointer"
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

      <footer className="border-t border-zinc-200/80 bg-white/70 py-6 dark:border-zinc-800/80 dark:bg-[#09090B]/90">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-6 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2.5">
            <MistLogo size="sm" />
            <span>— Ideas into websites. · {deployments.length} published deployments</span>
          </div>
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Switch to light studio theme' : 'Switch to dark studio theme'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            {darkMode ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Light Studio</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Dark Studio</span>
              </>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
