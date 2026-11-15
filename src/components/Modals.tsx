import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  LogOut,
  ShieldAlert,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  AiProviderId,
  DeploymentRecord,
  MistProject,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import { sanitizeSlug } from '../utils/projectOps';
import { getDefaultModelForProvider, PROVIDER_CATALOG } from '../data/models';
import ModelSelectorDropdown from './ModelSelectorDropdown';
import MistLogo from './MistLogo';

interface ProvidersModalProps {
  isOpen: boolean;
  config: AiProviderConfig;
  modelIncident?: ModelHealthIncident | null;
  onClose: () => void;
  onSave: (next: AiProviderConfig) => void;
  onIncident?: (incident: ModelHealthIncident | null) => void;
}

const BYOK_INSTRUCTIONS: Record<
  'groq' | 'openrouter',
  {
    title: string;
    portalLabel: string;
    portalUrl: string;
    placeholder: string;
    steps: string[];
  }
> = {
  groq: {
    title: 'How to get a Groq API key',
    portalLabel: 'console.groq.com/keys',
    portalUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    steps: [
      'Open console.groq.com/keys and sign in with your Groq account.',
      'Select Create API Key, give it a label such as Mist Studio, and copy the key starting with gsk_.',
      'Paste the key below, choose a fast model like llama-3.3-70b-versatile, and run Test Connection.',
    ],
  },
  openrouter: {
    title: 'How to get an OpenRouter API key',
    portalLabel: 'openrouter.ai/keys',
    portalUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-...',
    steps: [
      'Visit openrouter.ai/keys and sign in to your OpenRouter dashboard.',
      'Click Create Key, optionally set a spending limit, and copy the key starting with sk-or-.',
      'Paste the key below, pick any Claude, OpenAI, Gemini, or DeepSeek route, and click Test Connection.',
    ],
  },
};

export function ProvidersModal({
  isOpen,
  config,
  modelIncident,
  onClose,
  onSave,
  onIncident,
}: ProvidersModalProps) {
  const [provider, setProvider] = useState<AiProviderId>(config.provider);
  const [model, setModel] = useState(config.model);
  const [apiKey, setApiKey] = useState(config.apiKey || '');
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || '');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    incident?: ModelHealthIncident;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setProvider(config.provider);
      setModel(config.model);
      setApiKey(config.apiKey || '');
      setBaseUrl(config.baseUrl || '');
      setTestResult(null);
    }
  }, [isOpen, config]);

  const handleSelectProvider = (next: AiProviderId) => {
    setProvider(next);
    setModel(getDefaultModelForProvider(next));
    setTestResult(null);
  };

  const buildDraftConfig = (): AiProviderConfig => ({
    provider,
    model: model.trim() || getDefaultModelForProvider(provider),
    apiKey: provider === 'gemini' ? undefined : apiKey.trim(),
    baseUrl: provider === 'custom' ? baseUrl.trim() : undefined,
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const draft = buildDraftConfig();
    try {
      const resp = await fetch('/api/ai/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        incident?: ModelHealthIncident;
      };
      if (!resp.ok || !data.ok) {
        if (data.incident) {
          onIncident?.(data.incident);
        }
        setTestResult({
          ok: false,
          message: data.incident?.message || data.error || 'Connection test failed.',
          incident: data.incident,
        });
      } else {
        onIncident?.(null);
        setTestResult({
          ok: true,
          message: `${draft.model} responded cleanly and is ready for generation.`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to reach provider endpoint.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(buildDraftConfig());
    onClose();
  };

  const guide =
    provider === 'groq' || provider === 'openrouter' ? BYOK_INSTRUCTIONS[provider] : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="providers-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 mist-scrollbar"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <KeyRound className="h-4 w-4 text-blue-500" aria-hidden="true" />
                <h2 id="providers-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                  AI Models &amp; API Keys
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close providers modal"
                onClick={onClose}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
              {modelIncident && (
                <div
                  role="alert"
                  className={`flex items-start gap-2.5 rounded-xl border p-3 ${
                    modelIncident.code === 'RATE_LIMIT' || modelIncident.code === 'SERVER_OUTAGE'
                      ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200'
                  }`}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">{modelIncident.title}</p>
                    <p className="mt-0.5 text-[11px] opacity-90">{modelIncident.message}</p>
                  </div>
                </div>
              )}

              <div>
                <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">Select Provider</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'gemini', label: 'Gemini' },
                      { id: 'groq', label: 'Groq' },
                      { id: 'openrouter', label: 'OpenRouter' },
                      { id: 'custom', label: 'Custom' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectProvider(item.id)}
                      className={`rounded-lg border px-3 py-2 font-medium transition-all cursor-pointer ${
                        provider === item.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium text-zinc-700 dark:text-zinc-300">
                    Select Model ({PROVIDER_CATALOG[provider].models.length} presets)
                  </p>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Click to expand all
                  </span>
                </div>
                <ModelSelectorDropdown
                  provider={provider}
                  value={model}
                  onChange={setModel}
                />
              </div>

              {provider === 'gemini' ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                  Mist uses built-in Gemini models on the server automatically for generation, refinement, and Voice Studio — no manual key setup required.
                </div>
              ) : (
                <>
                  {guide && (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 p-3.5 space-y-2 dark:border-zinc-800 dark:bg-zinc-900/70">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {guide.title}
                        </p>
                        <a
                          href={guide.portalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <span>{guide.portalLabel}</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </div>
                      <ol className="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {guide.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {provider === 'custom' && (
                    <div>
                      <label htmlFor="mist-custom-url" className="block font-medium text-zinc-700 dark:text-zinc-300">
                        OpenAI-Compatible Base URL
                      </label>
                      <input
                        id="mist-custom-url"
                        type="url"
                        required
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.together.xyz/v1"
                        className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                      />
                    </div>
                  )}

                  <div>
                    <label htmlFor="mist-byok-key" className="block font-medium text-zinc-700 dark:text-zinc-300">
                      {provider === 'openrouter' ? 'OpenRouter' : provider === 'groq' ? 'Groq' : 'Provider'} API Key
                    </label>
                    <input
                      id="mist-byok-key"
                      type="password"
                      required
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={guide?.placeholder || 'sk-...'}
                      className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                    />
                    <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Saved locally in your browser and sent only when generating or testing your model.
                    </p>
                  </div>
                </>
              )}

              {testResult && (
                <div
                  role="status"
                  className={`flex items-start gap-2 rounded-xl border p-3 ${
                    testResult.ok
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div>
                    {testResult.incident && (
                      <p className="font-semibold">{testResult.incident.title}</p>
                    )}
                    <p className="text-[11px] leading-relaxed">{testResult.message}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={isTesting || (provider !== 'gemini' && !apiKey.trim())}
                  onClick={() => void handleTestConnection()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 py-2 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  {isTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>{isTesting ? 'Checking...' : 'Test Connection'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-zinc-200 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    Save Provider
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DeployModalProps {
  isOpen: boolean;
  project: MistProject | null;
  isDeploying: boolean;
  deployError: string | null;
  publishedUrl: string | null;
  onClose: () => void;
  onDeploy: (slug: string) => void;
}

export function DeployModal({
  isOpen,
  project,
  isDeploying,
  deployError,
  publishedUrl,
  onClose,
  onDeploy,
}: DeployModalProps) {
  const [slug, setSlug] = useState(
    project?.publishedSlug || sanitizeSlug(project?.name || 'mist-site'),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && project) {
      setSlug(project.publishedSlug || sanitizeSlug(project?.name || 'mist-site'));
    }
  }, [isOpen, project]);

  const fullUrl = publishedUrl
    ? `${window.location.origin}${publishedUrl}`
    : `${window.location.origin}/p/${sanitizeSlug(slug)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <AnimatePresence>
      {isOpen && project && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deploy-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h2 id="deploy-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                Publish Website
              </h2>
              <button
                type="button"
                aria-label="Close publish modal"
                onClick={onClose}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              <div>
                <label htmlFor="mist-deploy-slug" className="block font-medium text-zinc-700 dark:text-zinc-300">
                  Deployment Slug
                </label>
                <div className="mt-1.5 flex items-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="border-r border-zinc-200 px-3 py-2 font-mono text-zinc-500 dark:border-zinc-800">
                    /p/
                  </span>
                  <input
                    id="mist-deploy-slug"
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    className="flex-1 bg-transparent px-3 py-2 font-mono text-xs text-zinc-950 focus:outline-none dark:text-white"
                  />
                </div>
              </div>

              {deployError && (
                <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  {deployError}
                </p>
              )}

              {publishedUrl && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/40">
                  <p className="font-medium text-emerald-800 dark:text-emerald-300">
                    Live deployment updated
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 border border-emerald-200 dark:bg-zinc-900 dark:border-emerald-900">
                    <span className="truncate font-mono text-[11px]">{publishedUrl}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        aria-label="Copy deployment URL"
                        onClick={handleCopy}
                        className="p-1 text-zinc-600 hover:text-zinc-950 dark:text-zinc-300 cursor-pointer"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <a
                        href={publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open published website"
                        className="p-1 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-200 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={isDeploying}
                  onClick={() => onDeploy(sanitizeSlug(slug))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isDeploying ? 'Publishing...' : 'Publish Live'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DeploymentsModalProps {
  isOpen: boolean;
  deployments: DeploymentRecord[];
  onClose: () => void;
}

export function DeploymentsModal({
  isOpen,
  deployments,
  onClose,
}: DeploymentsModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deployments-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h2 id="deployments-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                Published Websites
              </h2>
              <button
                type="button"
                aria-label="Close deployments modal"
                onClick={onClose}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-5 mist-scrollbar">
              {deployments.length === 0 ? (
                <p className="text-center text-xs text-zinc-500 py-8">
                  No deployments published yet. Open any project and click Deploy.
                </p>
              ) : (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {deployments.map((dep) => (
                    <div key={dep.slug} className="flex items-center justify-between py-3 text-xs">
                      <div className="min-w-0 pr-3">
                        <p className="font-semibold text-zinc-900 dark:text-white truncate">{dep.title}</p>
                        <p className="font-mono text-[11px] text-zinc-500 truncate">{dep.url}</p>
                      </div>
                      <a
                        href={dep.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-blue-400 dark:hover:bg-zinc-900 shrink-0"
                      >
                        <span>Visit</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface AccountModalProps {
  isOpen: boolean;
  user: User | null;
  authError: string | null;
  promptReason?: string | null;
  onClose: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AccountModal({
  isOpen,
  user,
  authError,
  promptReason,
  onClose,
  onSignIn,
  onSignOut,
}: AccountModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <MistLogo size="sm" showWordmark={false} />
                <h2 id="account-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                  Mist Account
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close account modal"
                onClick={onClose}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              {promptReason && !user && (
                <div
                  role="status"
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 font-medium text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200"
                >
                  {promptReason}
                </div>
              )}

              {authError && (
                <p role="alert" className="rounded-xl bg-red-50 p-2.5 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  {authError}
                </p>
              )}

              {user ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User avatar'}
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 rounded-full border border-zinc-200 object-cover dark:border-zinc-800"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {(user.displayName || user.email || 'M')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-950 dark:text-white truncate">
                        {user.displayName || 'Mist Builder'}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400 truncate">{user.email}</p>
                    </div>
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    Your websites and live deployments are synced to your cloud workspace.
                  </p>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-4 py-2 font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Sign in with Google to generate websites, save your code across devices, and publish live deployments.
                  </p>
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    Continue with Google
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
