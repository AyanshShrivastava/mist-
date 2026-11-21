import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { MistUser as User } from '../types/mist';
import type {
  AiProviderConfig,
  CatalogSource,
  DeploymentRecord,
  MistProject,
  ModelCapabilities,
  ModelVerificationResult,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import { maskApiKey, sanitizeSlug, suggestShortSlug } from '../utils/projectOps';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  fetchLiveModelCatalog,
  normalizeProviderConfigToStudio,
  type CustomGatewayId,
  type ModelCatalogItem,
} from '../data/models';
import ModelSelectorDropdown from './ModelSelectorDropdown';
import MistLogo from './MistLogo';

interface ProvidersModalProps {
  isOpen: boolean;
  user: User | null;
  config: AiProviderConfig;
  modelIncident?: ModelHealthIncident | null;
  onClose: () => void;
  onSave: (next: AiProviderConfig) => void;
  onIncident?: (incident: ModelHealthIncident | null) => void;
}

export function ProvidersModal({
  isOpen,
  user,
  config,
  modelIncident,
  onClose,
  onSave,
  onIncident,
}: ProvidersModalProps) {
  const normalizedInit = normalizeProviderConfigToStudio(config);
  const [gatewayId, setGatewayId] = useState<CustomGatewayId>(
    detectGatewayFromBaseUrl(normalizedInit.baseUrl),
  );
  const [providerName, setProviderName] = useState(normalizedInit.name || 'OpenRouter');
  const [baseUrl, setBaseUrl] = useState(
    normalizedInit.baseUrl || CUSTOM_GATEWAY_PRESETS[0].baseUrl,
  );
  const [apiKey, setApiKey] = useState(normalizedInit.apiKey || '');
  const [sessionOnlyKey, setSessionOnlyKey] = useState(Boolean(normalizedInit.sessionOnlyKey));
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(normalizedInit.model);
  const [isTesting, setIsTesting] = useState(false);
  const [verifiedModel, setVerifiedModel] = useState<ModelVerificationResult | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    incident?: ModelHealthIncident;
  } | null>(null);

  const [liveModels, setLiveModels] = useState<ModelCatalogItem[] | null>(null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('preset');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [isOutdatedFallback, setIsOutdatedFallback] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogNote, setCatalogNote] = useState<string | null>(null);

  const catalogAbortRef = useRef<AbortController | null>(null);
  const catalogSeqRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      const norm = normalizeProviderConfigToStudio(config);
      setGatewayId(detectGatewayFromBaseUrl(norm.baseUrl));
      setProviderName(norm.name || 'Custom Provider');
      setBaseUrl(norm.baseUrl || '');
      setApiKey(norm.apiKey || '');
      setSessionOnlyKey(Boolean(norm.sessionOnlyKey));
      setModel(norm.model);
      setShowKey(false);
      setTestResult(null);
      setVerifiedModel(null);
      setCatalogError(null);
    } else {
      catalogAbortRef.current?.abort();
    }
  }, [isOpen, config]);

  const loadCatalog = useCallback(
    async (targetUrl: string, targetKey: string, forceRefresh = false) => {
      catalogAbortRef.current?.abort();
      const seq = ++catalogSeqRef.current;

      const cleaned = targetUrl.trim();
      if (!cleaned.startsWith('https://')) {
        setLiveModels(null);
        setCatalogSource('preset');
        setLastRefreshedAt(null);
        setIsOutdatedFallback(false);
        setCatalogError(null);
        setIsLoadingCatalog(false);
        setCatalogNote(cleaned ? 'Enter an https:// URL to fetch live models.' : null);
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
          baseUrl: cleaned,
          apiKey: targetKey,
          forceRefresh,
          idToken,
          signal: controller.signal,
        });
        if (seq !== catalogSeqRef.current || controller.signal.aborted) return;
        setLiveModels(res.models);
        setCatalogSource(res.source);
        setLastRefreshedAt(res.fetchedAt);
        setIsOutdatedFallback(Boolean(res.isOutdatedFallback));
        setCatalogNote(res.note || null);
      } catch (err) {
        if (seq !== catalogSeqRef.current || controller.signal.aborted) return;
        setCatalogSource('preset');
        setIsOutdatedFallback(true);
        setCatalogError(err instanceof Error ? err.message : 'Could not fetch live catalog.');
      } finally {
        if (seq === catalogSeqRef.current) {
          setIsLoadingCatalog(false);
        }
      }
    },
    [user],
  );

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      void loadCatalog(baseUrl, apiKey, false);
    }, 260);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, baseUrl, apiKey, loadCatalog]);

  const activeGateway =
    CUSTOM_GATEWAY_PRESETS.find((g) => g.id === gatewayId) || CUSTOM_GATEWAY_PRESETS[0];
  const activeModelsList = liveModels !== null ? liveModels : activeGateway.models;

  const handleSelectGateway = (nextGwId: CustomGatewayId) => {
    catalogAbortRef.current?.abort();
    catalogSeqRef.current += 1;
    setIsLoadingCatalog(false);
    setGatewayId(nextGwId);
    const gw = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === nextGwId)!;
    setProviderName(gw.name);
    if (gw.baseUrl) {
      setBaseUrl(gw.baseUrl);
    } else if (nextGwId === 'custom_url' && CUSTOM_GATEWAY_PRESETS.some((p) => p.baseUrl === baseUrl)) {
      setBaseUrl('');
    }
    setLiveModels(null);
    setCatalogSource('preset');
    setLastRefreshedAt(null);
    setIsOutdatedFallback(false);
    setCatalogError(null);
    setCatalogNote(null);
    setModel(gw.models[0]?.id || '');
    setVerifiedModel(null);
    setTestResult(null);
  };

  const buildDraftConfig = (): AiProviderConfig => ({
    provider: 'custom',
    name: providerName.trim() || activeGateway.name || 'Custom Provider',
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    sessionOnlyKey,
  });

  const handleTestConnection = async () => {
    const draft = buildDraftConfig();
    if (!draft.model) {
      setTestResult({ ok: false, message: 'Select or enter a model ID before testing.' });
      return;
    }
    if (!user) {
      setTestResult({
        ok: false,
        message: 'Sign in with Google first to run live provider verification.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/ai/test-provider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(draft),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        verified?: boolean;
        testedAt?: string;
        capabilities?: Partial<ModelCapabilities>;
        error?: string;
        incident?: ModelHealthIncident;
      };
      if (!resp.ok || !data.ok) {
        if (data.incident) {
          onIncident?.(data.incident);
        }
        setVerifiedModel(null);
        setTestResult({
          ok: false,
          message: data.incident?.message || data.error || 'Connection test failed.',
          incident: data.incident,
        });
      } else {
        onIncident?.(null);
        setVerifiedModel({
          gatewayBaseUrl: draft.baseUrl || '',
          model: draft.model,
          verified: true,
          testedAt: data.testedAt || new Date().toISOString(),
          capabilities: data.capabilities,
        });
        const jsonCap =
          data.capabilities?.jsonOutput === true
            ? ' (JSON structured output supported)'
            : data.capabilities?.jsonOutput === false
              ? ' (text mode supported; json_object unsupported)'
              : '';
        setTestResult({
          ok: true,
          message: `${draft.name} (${draft.model}) verified cleanly${jsonCap}.`,
        });
      }
    } catch (err) {
      setVerifiedModel(null);
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 mist-scrollbar"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg mist-primary-gradient text-white shadow-sm">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="providers-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                    BYOK Models &amp; API Keys
                  </h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Connect your own Name, Base URL, API Key &amp; Live Model Catalog
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close providers modal"
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5 text-xs">
              {modelIncident && (
                <div
                  role="alert"
                  className={`flex items-start gap-2.5 rounded-xl border p-3 ${
                    modelIncident.code === 'RATE_LIMIT' ||
                    modelIncident.code === 'SERVER_OUTAGE' ||
                    modelIncident.code === 'CREDITS_REQUIRED'
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
                <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Quick-Fill Gateway Preset
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {CUSTOM_GATEWAY_PRESETS.map((gw) => (
                    <button
                      key={gw.id}
                      type="button"
                      onClick={() => handleSelectGateway(gw.id)}
                      className={`min-h-[36px] rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                        gatewayId === gw.id
                          ? 'border-blue-600 bg-gradient-to-r from-blue-500/15 to-pink-500/15 text-blue-700 dark:border-blue-500/70 dark:text-blue-300'
                          : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {gw.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="mist-provider-name" className="block font-medium text-zinc-700 dark:text-zinc-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                      <span>Provider Name</span>
                    </span>
                  </label>
                  <input
                    id="mist-provider-name"
                    type="text"
                    required
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    placeholder="e.g. OpenRouter, Groq, My Endpoint"
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                  />
                </div>

                <div>
                  <label htmlFor="mist-custom-url" className="block font-medium text-zinc-700 dark:text-zinc-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                      <span>HTTPS Base URL</span>
                    </span>
                  </label>
                  <input
                    id="mist-custom-url"
                    type="url"
                    required
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setGatewayId(detectGatewayFromBaseUrl(e.target.value));
                      setVerifiedModel(null);
                    }}
                    placeholder="https://openrouter.ai/api/v1"
                    className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="mist-byok-key" className="block font-medium text-zinc-700 dark:text-zinc-300">
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                    <span>API Key (BYOK)</span>
                  </span>
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="mist-byok-key"
                    type={showKey ? 'text' : 'password'}
                    required
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setVerifiedModel(null);
                    }}
                    placeholder={activeGateway.placeholder}
                    className="w-full rounded-xl border border-zinc-200 bg-white pl-3 pr-10 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                  />
                  <button
                    type="button"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                </div>

                {maskApiKey(apiKey) && (
                  <p className="mt-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                    Active Key: <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{maskApiKey(apiKey)}</span> — automatically backs <code className="font-mono">/api/app-ai</code> so generated apps never ask users for a key.
                  </p>
                )}

                <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sessionOnlyKey}
                    onChange={(e) => setSessionOnlyKey(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span>Keep API key in memory only (never saved to account vault; clears on close)</span>
                </label>

                <div className="mt-2 rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                  {user?.email
                    ? sessionOnlyKey
                      ? `Session-only active: key stays strictly in RAM and will not sync to ${user.email}.`
                      : `Encrypted with AES-256-GCM & synced to your signed-in account (${user.email}) — zero keys are stored in browser localStorage.`
                    : 'Sign in with Google to encrypt & sync this key to your account email (zero localStorage key storage).'}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="font-medium text-zinc-700 dark:text-zinc-300">
                    Model ({activeModelsList.length}{' '}
                    {catalogSource === 'live'
                      ? 'live'
                      : catalogSource === 'cached'
                        ? 'cached'
                        : 'presets'}
                    )
                  </p>
                </div>
                <ModelSelectorDropdown
                  provider="custom"
                  value={model}
                  onChange={(nextModel) => {
                    setModel(nextModel);
                    if (verifiedModel?.model !== nextModel.trim()) {
                      setVerifiedModel(null);
                    }
                  }}
                  modelsOverride={activeModelsList}
                  gatewayLabel={providerName.trim() || activeGateway.name}
                  isLoadingCatalog={isLoadingCatalog}
                  catalogSource={catalogSource}
                  lastRefreshedAt={lastRefreshedAt}
                  isOutdatedFallback={isOutdatedFallback}
                  catalogError={catalogError}
                  catalogNote={catalogNote}
                  verifiedModel={verifiedModel}
                  onRefreshCatalog={() => void loadCatalog(baseUrl, apiKey, true)}
                />
              </div>

              {activeGateway.steps && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 p-3.5 space-y-2 dark:border-zinc-800 dark:bg-zinc-900/70">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      How to get a {activeGateway.name} key
                    </p>
                    {activeGateway.portalUrl && (
                      <a
                        href={activeGateway.portalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <span>{activeGateway.portalLabel}</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {activeGateway.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
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
                  disabled={isTesting || !apiKey.trim() || !baseUrl.trim() || !model.trim()}
                  onClick={() => void handleTestConnection()}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 px-3.5 py-2 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                >
                  {isTesting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>{isTesting ? 'Checking...' : 'Test Connection'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[40px] rounded-xl border border-zinc-200 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] rounded-xl mist-primary-gradient px-4 py-2 font-medium text-white shadow-sm transition-all cursor-pointer"
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

const FREE_STATIC_HOSTS = [
  {
    name: 'Netlify Drop',
    badge: 'Fastest · Drag & Drop',
    url: 'https://app.netlify.com/drop',
    steps: 'Unzip your download and drag the `dist` folder onto Netlify Drop. Live in ~10 seconds.',
  },
  {
    name: 'Render Static Sites',
    badge: 'No Credit Card · render.yaml Included',
    url: 'https://dashboard.render.com/select-repo?type=static',
    steps: 'Push the folder to GitHub, choose Static Site (`dist` directory). `render.yaml` is pre-included.',
  },
  {
    name: 'Vercel Hobby',
    badge: 'No Credit Card · Free Static',
    url: 'https://vercel.com/new',
    steps: 'Import from GitHub or run `npx vercel` inside the unzipped folder.',
  },
  {
    name: 'Cloudflare Pages',
    badge: 'No Credit Card · Unlimited Bandwidth',
    url: 'https://dash.cloudflare.com/',
    steps: 'Workers & Pages -> Upload Assets -> drag the `dist` folder or connect GitHub.',
  },
  {
    name: 'GitHub Pages',
    badge: 'No Credit Card · Free Public Hosting',
    url: 'https://pages.github.com/',
    steps: 'Upload `dist/index.html` as `index.html` to a public repo and enable GitHub Pages.',
  },
];

interface DeployModalProps {
  isOpen: boolean;
  project: MistProject | null;
  isDeploying: boolean;
  deployError: string | null;
  downloadedFileName: string | null;
  onClose: () => void;
  onDownloadPublishZip: (slug: string) => void;
  onDownloadStandaloneHtml: (slug: string) => void;
}

export function DeployModal({
  isOpen,
  project,
  isDeploying,
  deployError,
  downloadedFileName,
  onClose,
  onDownloadPublishZip,
  onDownloadStandaloneHtml,
}: DeployModalProps) {
  const [slug, setSlug] = useState(
    project?.publishedSlug || suggestShortSlug(project?.name || 'mist-site'),
  );

  useEffect(() => {
    if (isOpen && project) {
      setSlug(project.publishedSlug || suggestShortSlug(project?.name || 'mist-site'));
    }
  }, [isOpen, project]);

  const cleanSlug = sanitizeSlug(slug);

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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 mist-scrollbar"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg mist-primary-gradient text-white shadow-sm">
                  <Download className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="deploy-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                    Publish &amp; Host Free
                  </h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Standalone export · Zero traffic hits Mist&apos;s server
                  </p>
                </div>
              </div>
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
              {/* Auto-Download Confirmation & Re-download Actions */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/35">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                        {isDeploying
                          ? 'Preparing your standalone publish bundle...'
                          : downloadedFileName
                            ? `Downloaded ${downloadedFileName}`
                            : 'Ready to download standalone website bundle'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                        Includes ready-to-drop <code className="font-mono font-semibold">dist/index.html</code>, <code className="font-mono font-semibold">render.yaml</code>, full React source, and zero server dependencies.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isDeploying}
                    onClick={() => onDownloadPublishZip(cleanSlug)}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg mist-primary-gradient px-3 py-1.5 text-[11px] font-medium text-white shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {isDeploying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{downloadedFileName ? 'Download ZIP Again' : 'Download Publish ZIP'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isDeploying}
                    onClick={() => onDownloadStandaloneHtml(cleanSlug)}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100/60 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-200 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                  >
                    <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download Single index.html</span>
                  </button>
                </div>
              </div>

              {/* Project Site Name */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="mist-deploy-slug" className="block font-medium text-zinc-700 dark:text-zinc-300">
                    Package &amp; Site Name
                  </label>
                  <button
                    type="button"
                    onClick={() => setSlug(suggestShortSlug(slug || project.name, 16))}
                    className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                  >
                    Shorten slug
                  </button>
                </div>
                <div className="mt-1.5 flex items-center rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="border-r border-zinc-200 px-3 py-2 font-mono text-zinc-500 dark:border-zinc-800">
                    /
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
                <p role="alert" className="rounded-xl bg-red-50 p-2.5 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  {deployError}
                </p>
              )}

              {/* Caution Callout */}
              <div
                role="note"
                className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-[11px] text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <div className="leading-relaxed">
                  <p className="font-semibold">Caution: Use ONLY Free Tiers With No Credit Card Billing</p>
                  <p className="mt-0.5 opacity-90">
                    Always select the <strong>Free Static Site</strong> option on providers that do not require adding a credit card upfront (like Render Static Sites, Netlify Drop, Vercel Hobby, Cloudflare Pages, or GitHub Pages). Never select paid server plans or hosts requiring card billing.
                  </p>
                </div>
              </div>

              {/* Direct Links to Free No-Card Hosts */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                  <span>Simple Steps &amp; Direct Links (Free Static Hosts · No Card Required)</span>
                </p>
                <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-zinc-50/70 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/50">
                  {FREE_STATIC_HOSTS.map((host) => (
                    <div key={host.name} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-zinc-900 dark:text-white">{host.name}</span>
                          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· {host.badge}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          {host.steps}
                        </p>
                      </div>
                      <a
                        href={host.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-blue-400 dark:hover:bg-zinc-800 shrink-0 whitespace-nowrap"
                      >
                        <span>Open</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-zinc-200 bg-white/95 pt-3 pb-1 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-zinc-200 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 cursor-pointer"
                >
                  Done
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
  onDeleteDeployment?: (slug: string) => void;
}

export function DeploymentsModal({
  isOpen,
  deployments,
  onClose,
  onDeleteDeployment,
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
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
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg mist-primary-gradient text-white shadow-sm">
                  <Globe className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="deployments-modal-title" className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                    Free External Hosting
                  </h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Publish downloads a standalone ZIP · Zero Mist server load
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close deployments modal"
                onClick={onClose}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-5 mist-scrollbar space-y-4">
              <div className="rounded-xl border border-amber-300/80 bg-amber-50/80 p-3 text-[11px] text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/35 dark:text-amber-200">
                <p className="font-semibold">No-Credit-Card Static Hosting</p>
                <p className="mt-1 opacity-90">
                  Open any project and click <strong>Publish</strong> to download a standalone ZIP (`dist/index.html` + `render.yaml`) and drop it onto free static tiers like Netlify Drop, Render Static Sites, Vercel Hobby, or GitHub Pages.
                </p>
              </div>

              {deployments.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                    Previous Legacy Links
                  </p>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3">
                    {deployments.map((dep) => (
                      <div key={dep.slug} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-zinc-900 dark:text-white truncate">{dep.title}</p>
                          <p className="font-mono text-[11px] text-zinc-500 truncate">{dep.url}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a
                            href={dep.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-blue-400 dark:hover:bg-zinc-900"
                          >
                            <span>Visit</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                          {onDeleteDeployment && (
                            <button
                              type="button"
                              aria-label={`Unpublish ${dep.title}`}
                              onClick={() => onDeleteDeployment(dep.slug)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:bg-red-950/60 dark:hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deployments.length === 0 && (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs">
                  {FREE_STATIC_HOSTS.slice(0, 3).map((host) => (
                    <div key={host.name} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-white">{host.name}</p>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{host.badge}</p>
                      </div>
                      <a
                        href={host.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-blue-400 dark:hover:bg-zinc-900"
                      >
                        <span>Open</span>
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

function GoogleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

function GithubIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

interface AccountModalProps {
  isOpen: boolean;
  user: User | null;
  authError: string | null;
  promptReason?: string | null;
  onClose: () => void;
  onSignIn?: () => void;
  onSignInGoogle?: () => void;
  onSignInGithub?: () => void;
  onSignInEmail?: () => void;
  onSignOut: () => void;
  onManageProfile?: () => void;
}

export function AccountModal({
  isOpen,
  user,
  authError,
  promptReason,
  onClose,
  onSignIn,
  onSignInGoogle,
  onSignInGithub,
  onSignInEmail,
  onSignOut,
  onManageProfile,
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-zinc-200 bg-white pb-4 sm:pb-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
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
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800/80 dark:bg-zinc-900/60">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User avatar'}
                        referrerPolicy="no-referrer"
                        className="h-11 w-11 rounded-full border border-blue-500/40 object-cover ring-2 ring-blue-500/20"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 font-bold text-white shadow-sm">
                        {(user.displayName || user.email || 'M')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-zinc-950 dark:text-white truncate">
                          {user.displayName || 'Mist Builder'}
                        </p>
                        <ShieldCheck className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                      </div>
                      <p className="text-zinc-500 dark:text-zinc-400 truncate text-[11px]">{user.email}</p>
                    </div>
                  </div>

                  {/* Account status overview */}
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 space-y-1.5 dark:border-zinc-800/60 dark:bg-zinc-900/30">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-200 text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                      Active Mist Account
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400 text-[11px] leading-relaxed">
                      Your projects, files, and published websites on <code>*.mist.me</code> are synchronized in real-time.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {onManageProfile && (
                      <button
                        type="button"
                        onClick={onManageProfile}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2.5 font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer text-xs"
                      >
                        <Settings className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
                        <span>Security & Profile</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onSignOut}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50/50 px-3 py-2.5 font-medium text-red-700 hover:bg-red-100/60 dark:border-red-950/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60 transition-colors cursor-pointer text-xs ${!onManageProfile ? 'col-span-2' : ''}`}
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 space-y-1.5 dark:border-zinc-800/60 dark:bg-zinc-900/30">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-200 text-xs flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                      Sign In with OAuth
                    </p>
                    <p className="leading-relaxed text-zinc-600 dark:text-zinc-400 text-xs">
                      Sign in directly with your Google or GitHub account to sync projects across devices and deploy to <code>*.mist.me</code>.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {/* Direct Google OAuth (Google consent screen / Allow prompt) */}
                    <button
                      type="button"
                      onClick={onSignInGoogle || onSignIn}
                      className="w-full flex items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-[#161924] dark:text-zinc-100 dark:hover:bg-[#1f2433] transition-all cursor-pointer text-xs"
                    >
                      <GoogleIcon className="h-4 w-4 shrink-0" />
                      <span>Continue with Google</span>
                    </button>

                    {/* Direct GitHub OAuth (GitHub Authorize prompt) */}
                    <button
                      type="button"
                      onClick={onSignInGithub || onSignIn}
                      className="w-full flex items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-[#161924] dark:text-zinc-100 dark:hover:bg-[#1f2433] transition-all cursor-pointer text-xs"
                    >
                      <GithubIcon className="h-4 w-4 shrink-0 text-zinc-900 dark:text-white" />
                      <span>Continue with GitHub</span>
                    </button>

                    {/* Divider */}
                    <div className="relative py-1 flex items-center justify-center">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
                      </div>
                      <span className="relative bg-white px-2 text-[10px] uppercase font-semibold text-zinc-400 dark:bg-zinc-950 dark:text-zinc-500">
                        or
                      </span>
                    </div>

                    {/* Email / Passkey */}
                    <button
                      type="button"
                      onClick={onSignInEmail || onSignIn}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-all cursor-pointer flex items-center justify-center gap-2 text-xs"
                    >
                      <KeyRound className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Email or Passkey</span>
                    </button>
                  </div>

                  <p className="text-center text-[10px] text-zinc-400 dark:text-zinc-500">
                    Secured by Clerk OAuth • 100% private
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
