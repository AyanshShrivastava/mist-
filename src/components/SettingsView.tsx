import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Moon,
  Search,
  ShieldAlert,
  Sliders,
  Sun,
  Tag,
  Terminal,
  User as UserIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  AppAiMode,
  CatalogSource,
  DeploymentRecord,
  MistProject,
  ModelCapabilities,
  ModelVerificationResult,
  StudioSettings,
  ViewportSize,
  WebSearchConfig,
  WebSearchMode,
  WebSearchProviderId,
  WorkspaceViewMode,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  fetchLiveModelCatalog,
  normalizeProviderConfigToStudio,
  type CustomGatewayId,
  type ModelCatalogItem,
} from '../data/models';
import {
  normalizeWebSearchConfig,
  WEB_SEARCH_PRESETS,
} from '../data/webSearch';
import MistLogo from './MistLogo';
import ModelSelectorDropdown from './ModelSelectorDropdown';

interface SettingsViewProps {
  user: User | null;
  projects: MistProject[];
  deployments: DeploymentRecord[];
  providerConfig: AiProviderConfig;
  webSearchConfig: WebSearchConfig;
  studioSettings: StudioSettings;
  modelIncident: ModelHealthIncident | null;
  onBack: () => void;
  onSaveProvider: (next: AiProviderConfig) => void;
  onSaveWebSearch: (next: WebSearchConfig) => void;
  onUpdateSettings: (partial: Partial<StudioSettings>) => void;
  onIncident: (incident: ModelHealthIncident | null) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function SettingsView({
  user,
  projects,
  deployments,
  providerConfig,
  webSearchConfig,
  studioSettings,
  modelIncident,
  onBack,
  onSaveProvider,
  onSaveWebSearch,
  onUpdateSettings,
  onIncident,
  onSignIn,
  onSignOut,
}: SettingsViewProps) {
  const normalizedInit = normalizeProviderConfigToStudio(providerConfig);
  const [gatewayId, setGatewayId] = useState<CustomGatewayId>(
    detectGatewayFromBaseUrl(normalizedInit.baseUrl),
  );
  const [providerName, setProviderName] = useState<string>(
    normalizedInit.name || 'OpenRouter',
  );
  const [baseUrl, setBaseUrl] = useState<string>(
    normalizedInit.baseUrl || CUSTOM_GATEWAY_PRESETS[0].baseUrl,
  );
  const [apiKey, setApiKey] = useState<string>(normalizedInit.apiKey || '');
  const [sessionOnlyKey, setSessionOnlyKey] = useState<boolean>(
    Boolean(normalizedInit.sessionOnlyKey),
  );
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<string>(normalizedInit.model);
  const [savedNotice, setSavedNotice] = useState(false);

  const normalizedSearchInit = normalizeWebSearchConfig(webSearchConfig);
  const [searchProvider, setSearchProvider] = useState<WebSearchProviderId>(
    normalizedSearchInit.provider,
  );
  const [searchName, setSearchName] = useState<string>(
    normalizedSearchInit.name || WEB_SEARCH_PRESETS[0].name,
  );
  const [searchBaseUrl, setSearchBaseUrl] = useState<string>(
    normalizedSearchInit.baseUrl || WEB_SEARCH_PRESETS[0].baseUrl,
  );
  const [searchApiKey, setSearchApiKey] = useState<string>(normalizedSearchInit.apiKey || '');
  const [searchSessionOnlyKey, setSearchSessionOnlyKey] = useState<boolean>(
    Boolean(normalizedSearchInit.sessionOnlyKey),
  );
  const [searchMaxResults, setSearchMaxResults] = useState<number>(
    normalizedSearchInit.maxResults || 5,
  );
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [searchSavedNotice, setSearchSavedNotice] = useState(false);
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [searchTestResult, setSearchTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const searchTestAbortRef = useRef<AbortController | null>(null);

  const [liveModels, setLiveModels] = useState<ModelCatalogItem[] | null>(null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>('preset');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [isOutdatedFallback, setIsOutdatedFallback] = useState(false);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogNote, setCatalogNote] = useState<string | null>(null);

  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [verifiedModel, setVerifiedModel] = useState<ModelVerificationResult | null>(null);
  const [providerTestResult, setProviderTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [isTestingAppAi, setIsTestingAppAi] = useState(false);
  const [appAiTestOutput, setAppAiTestOutput] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const catalogAbortRef = useRef<AbortController | null>(null);
  const catalogSeqRef = useRef(0);

  useEffect(() => {
    const norm = normalizeProviderConfigToStudio(providerConfig);
    setGatewayId(detectGatewayFromBaseUrl(norm.baseUrl));
    setProviderName(norm.name || 'Custom Provider');
    setBaseUrl(norm.baseUrl || '');
    setApiKey(norm.apiKey || '');
    setSessionOnlyKey(Boolean(norm.sessionOnlyKey));
    setModel(norm.model);
    setVerifiedModel(null);
  }, [providerConfig]);

  useEffect(() => {
    const normSearch = normalizeWebSearchConfig(webSearchConfig);
    setSearchProvider(normSearch.provider);
    setSearchName(normSearch.name || WEB_SEARCH_PRESETS[0].name);
    setSearchBaseUrl(normSearch.baseUrl || '');
    setSearchApiKey(normSearch.apiKey || '');
    setSearchSessionOnlyKey(Boolean(normSearch.sessionOnlyKey));
    setSearchMaxResults(normSearch.maxResults || 5);
  }, [webSearchConfig]);

  useEffect(() => {
    return () => {
      searchTestAbortRef.current?.abort();
    };
  }, []);

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
        const idToken = user ? await user.getIdToken() : undefined;
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
        setCatalogError(err instanceof Error ? err.message : 'Unable to refresh model catalog.');
      } finally {
        if (seq === catalogSeqRef.current) {
          setIsLoadingCatalog(false);
        }
      }
    },
    [user],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog(baseUrl, apiKey, false);
    }, 260);
    return () => {
      window.clearTimeout(timer);
      catalogAbortRef.current?.abort();
    };
  }, [baseUrl, apiKey, loadCatalog]);

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
    setProviderTestResult(null);
  };

  const buildProviderDraft = (): AiProviderConfig => ({
    provider: 'custom',
    name: providerName.trim() || activeGateway.name || 'Custom Provider',
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    sessionOnlyKey,
  });

  const activeSearchPreset =
    WEB_SEARCH_PRESETS.find((p) => p.id === searchProvider) || WEB_SEARCH_PRESETS[0];

  const handleSelectSearchPreset = (nextProviderId: WebSearchProviderId) => {
    const preset =
      WEB_SEARCH_PRESETS.find((p) => p.id === nextProviderId) || WEB_SEARCH_PRESETS[0];
    setSearchProvider(nextProviderId);
    setSearchName(preset.name);
    if (preset.baseUrl) {
      setSearchBaseUrl(preset.baseUrl);
    } else if (
      nextProviderId === 'custom_json' &&
      WEB_SEARCH_PRESETS.some((p) => p.baseUrl === searchBaseUrl)
    ) {
      setSearchBaseUrl('');
    }
    setSearchTestResult(null);
  };

  const buildSearchDraft = (): WebSearchConfig =>
    normalizeWebSearchConfig({
      provider: searchProvider,
      name: searchName,
      baseUrl: searchBaseUrl,
      apiKey: searchApiKey,
      sessionOnlyKey: searchSessionOnlyKey,
      maxResults: searchMaxResults,
    });

  const handleApplyWebSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveWebSearch(buildSearchDraft());
    setSearchSavedNotice(true);
    window.setTimeout(() => setSearchSavedNotice(false), 1800);
  };

  const handleTestWebSearch = async () => {
    const draft = buildSearchDraft();
    if (!draft.apiKey?.trim()) {
      setSearchTestResult({
        ok: false,
        message: 'Enter your Web Search API key before testing.',
      });
      return;
    }
    if (!draft.baseUrl?.trim()) {
      setSearchTestResult({
        ok: false,
        message: 'Enter a valid https:// search endpoint URL.',
      });
      return;
    }
    if (!user) {
      setSearchTestResult({
        ok: false,
        message: 'Sign in with Google first to test your live Web Search connection.',
      });
      return;
    }

    searchTestAbortRef.current?.abort();
    const controller = new AbortController();
    searchTestAbortRef.current = controller;
    setIsTestingSearch(true);
    setSearchTestResult(null);

    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/search/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        signal: controller.signal,
        body: JSON.stringify({ searchConfig: draft }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        verified?: boolean;
        resultCount?: number;
        error?: string;
      };
      if (!resp.ok || !data.ok) {
        setSearchTestResult({
          ok: false,
          message: data.error || `Search test failed (${resp.status}).`,
        });
      } else {
        setSearchTestResult({
          ok: true,
          message: `${draft.name} verified (${data.resultCount ?? 0} live source${
            data.resultCount === 1 ? '' : 's'
          } retrieved).`,
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setSearchTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to reach Web Search service.',
      });
    } finally {
      setIsTestingSearch(false);
    }
  };

  const handleApplyProvider = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProvider(buildProviderDraft());
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleTestProvider = async () => {
    const draft = buildProviderDraft();
    if (!draft.model) {
      setProviderTestResult({ ok: false, message: 'Select or enter a model ID before testing.' });
      return;
    }
    if (!user) {
      setProviderTestResult({
        ok: false,
        message: 'Sign in with Google first to test your live BYOK connection.',
      });
      return;
    }

    setIsTestingProvider(true);
    setProviderTestResult(null);
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
        if (data.incident) onIncident(data.incident);
        setVerifiedModel(null);
        setProviderTestResult({
          ok: false,
          message: data.incident?.message || data.error || 'Connection test failed.',
        });
      } else {
        onIncident(null);
        setVerifiedModel({
          gatewayBaseUrl: draft.baseUrl || '',
          model: draft.model,
          verified: true,
          testedAt: data.testedAt || new Date().toISOString(),
          capabilities: data.capabilities,
        });
        setProviderTestResult({
          ok: true,
          message: `${draft.name} (${draft.model}) responded cleanly and is verified.`,
        });
      }
    } catch (err) {
      setVerifiedModel(null);
      setProviderTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to reach provider endpoint.',
      });
    } finally {
      setIsTestingProvider(false);
    }
  };

  const handleTestAppAiEndpoint = async () => {
    if (!user) {
      setAppAiTestOutput({
        ok: false,
        message: 'Sign in with Google first to test /api/app-ai.',
      });
      return;
    }
    setIsTestingAppAi(true);
    setAppAiTestOutput(null);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/app-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          prompt: 'Confirm live app AI endpoint works in 8 words or less.',
          providerConfig: buildProviderDraft(),
        }),
      });
      const data = (await resp.json()) as {
        text?: string;
        error?: string;
        incident?: ModelHealthIncident;
      };
      if (!resp.ok || !data.text) {
        if (data.incident) onIncident(data.incident);
        setAppAiTestOutput({
          ok: false,
          message: data.incident?.message || data.error || 'App AI runtime test failed.',
        });
      } else {
        onIncident(null);
        setAppAiTestOutput({
          ok: true,
          message: data.text.trim(),
        });
      }
    } catch (err) {
      setAppAiTestOutput({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error calling /api/app-ai.',
      });
    } finally {
      setIsTestingAppAi(false);
    }
  };

  const darkMode = studioSettings.theme === 'dark';

  return (
    <div className="mist-ambient-canvas min-h-screen text-[#09090B] dark:text-[#FAFAFA] flex flex-col">
      {/* Studio Top Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#FAFAFA]/85 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-[#09090B]/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back</span>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <MistLogo size="sm" showWordmark={false} />
              <span className="hidden sm:inline font-display text-base font-bold text-black dark:text-white">
                Mist
              </span>
              <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">/</span>
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
                Settings
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: darkMode ? 'light' : 'dark' })}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {darkMode ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            {user ? (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex min-h-[40px] sm:min-h-[36px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex min-h-[40px] sm:min-h-[36px] items-center gap-1.5 rounded-xl mist-primary-gradient px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
            Studio Settings
          </h1>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            Configure your BYOK AI endpoints, in-app AI runtime, account preferences, and editor defaults.
          </p>
        </motion.div>

        {modelIncident && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/45 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">{modelIncident.title}</p>
              <p className="mt-0.5 opacity-90">{modelIncident.message}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Primary Column */}
          <div className="lg:col-span-7 space-y-6">
            {/* Section 1: 100% BYOK Provider & Models */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.04 }}
              aria-labelledby="settings-ai-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl mist-primary-gradient text-white shadow-sm">
                    <Cpu className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h2
                      id="settings-ai-heading"
                      className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                    >
                      BYOK AI Endpoint &amp; Models
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Mist runs 100% on your own API key, Base URL, and provider name (OpenRouter, Groq, Gemini BYOK, NVIDIA NIM, OpenAI, or any OpenAI-compatible URL).
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleApplyProvider} className="mt-5 space-y-4 text-xs">
                <div>
                  <p className="mb-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                    Quick-Fill Gateway Preset
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {CUSTOM_GATEWAY_PRESETS.map((gw) => (
                      <button
                        key={gw.id}
                        type="button"
                        onClick={() => handleSelectGateway(gw.id)}
                        className={`min-h-[38px] rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                          gatewayId === gw.id
                            ? 'border-blue-600 bg-gradient-to-r from-blue-500/15 to-indigo-500/15 text-blue-700 dark:border-blue-500/70 dark:text-blue-300'
                            : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {gw.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="settings-provider-name"
                      className="block font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Tag className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
                        <span>Provider Name</span>
                      </span>
                    </label>
                    <input
                      id="settings-provider-name"
                      type="text"
                      required
                      value={providerName}
                      onChange={(e) => setProviderName(e.target.value)}
                      placeholder="OpenRouter, Groq, My Proxy..."
                      className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="settings-custom-url"
                      className="block font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Link2 className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                        <span>Base URL</span>
                      </span>
                    </label>
                    <input
                      id="settings-custom-url"
                      type="url"
                      required
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setGatewayId(detectGatewayFromBaseUrl(e.target.value));
                        setVerifiedModel(null);
                      }}
                      placeholder="https://openrouter.ai/api/v1"
                      className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="settings-byok-key"
                    className="block font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                      <span>{providerName.trim() || activeGateway.name} API Key</span>
                    </span>
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="settings-byok-key"
                      type={showKey ? 'text' : 'password'}
                      required
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setVerifiedModel(null);
                      }}
                      placeholder={activeGateway.placeholder}
                      className="w-full rounded-xl border border-zinc-200 bg-white pl-3 pr-10 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
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
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sessionOnlyKey}
                        onChange={(e) => setSessionOnlyKey(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <span>Keep API key in memory only (clear automatically when tab closes)</span>
                    </label>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        Active Model ({activeModelsList.length} {catalogSource})
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Expand to inspect catalog or enter custom ID
                      </span>
                    </div>
                    <ModelSelectorDropdown
                      provider="custom"
                      value={model}
                      onChange={(nextModel) => {
                        setModel(nextModel);
                        setVerifiedModel(null);
                        setProviderTestResult(null);
                      }}
                      modelsOverride={activeModelsList}
                      gatewayLabel={providerName.trim() || activeGateway.name}
                      isLoadingCatalog={isLoadingCatalog}
                      isLiveCatalog={catalogSource === 'live'}
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
                  <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/90 p-3.5 space-y-2 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        How to set up {activeGateway.name}
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

                {providerTestResult && (
                  <div
                    role="status"
                    className={`flex items-start gap-2 rounded-xl border p-3 ${
                      providerTestResult.ok
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200'
                    }`}
                  >
                    {providerTestResult.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <p className="text-[11px] leading-relaxed">{providerTestResult.message}</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    disabled={isTestingProvider || !apiKey.trim() || !baseUrl.trim()}
                    onClick={() => void handleTestProvider()}
                    className="inline-flex w-full sm:w-auto justify-center min-h-[44px] sm:min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    {isTestingProvider && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    )}
                    <span>{isTestingProvider ? 'Testing...' : 'Test Connection'}</span>
                  </button>

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2.5">
                    {savedNotice && (
                      <span className="text-center sm:text-left text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        Saved
                      </span>
                    )}
                    <button
                      type="submit"
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-xl mist-primary-gradient px-4 py-2 font-medium text-white shadow-sm transition-all cursor-pointer"
                    >
                      Save Provider Settings
                    </button>
                  </div>
                </div>
              </form>
            </motion.section>

            {/* Section 1B: Provider-Independent BYOK Web Search */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.06 }}
              aria-labelledby="settings-web-search-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-blue-600 text-white shadow-sm">
                  <Search className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="settings-web-search-heading"
                    className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                  >
                    Web Search (Provider-Independent BYOK)
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Retrieves verified live web results and citations for every connected AI model (OpenRouter, Groq, Gemini, NVIDIA, OpenAI, or Custom). Keys stay strictly on Mist&apos;s backend and are never exposed to generated websites or preview iframes.
                  </p>
                </div>
              </div>

              <form onSubmit={handleApplyWebSearch} className="mt-5 space-y-4 text-xs">
                <div>
                  <p className="mb-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                    Search Provider
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {WEB_SEARCH_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectSearchPreset(preset.id)}
                        className={`min-h-[38px] rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                          searchProvider === preset.id
                            ? 'border-blue-600 bg-gradient-to-r from-blue-500/15 to-sky-500/15 text-blue-700 dark:border-blue-500/70 dark:text-blue-300'
                            : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {activeSearchPreset.description}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="settings-search-name"
                      className="block font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Search Label
                    </label>
                    <input
                      id="settings-search-name"
                      type="text"
                      value={searchName}
                      onChange={(e) => setSearchName(e.target.value)}
                      placeholder="Brave Search (LLM Context)"
                      className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="settings-search-url"
                      className="block font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Search Endpoint URL
                    </label>
                    <input
                      id="settings-search-url"
                      type="url"
                      required
                      value={searchBaseUrl}
                      onChange={(e) => {
                        setSearchBaseUrl(e.target.value);
                        setSearchTestResult(null);
                      }}
                      placeholder="https://api.search.brave.com/res/v1/llm/context"
                      className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="settings-search-key"
                    className="block font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                      <span>{searchName.trim() || activeSearchPreset.name} API Key</span>
                    </span>
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="settings-search-key"
                      type={showSearchKey ? 'text' : 'password'}
                      value={searchApiKey}
                      onChange={(e) => {
                        setSearchApiKey(e.target.value);
                        setSearchTestResult(null);
                      }}
                      placeholder={activeSearchPreset.placeholder}
                      className="w-full rounded-xl border border-zinc-200 bg-white pl-3 pr-10 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    />
                    <button
                      type="button"
                      aria-label={showSearchKey ? 'Hide search API key' : 'Show search API key'}
                      onClick={() => setShowSearchKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      {showSearchKey ? (
                        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={searchSessionOnlyKey}
                      onChange={(e) => setSearchSessionOnlyKey(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <span>Keep search API key in memory only (session-only; never saved to storage)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="settings-search-default-mode"
                      className="block font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Default Search Behavior
                    </label>
                    <select
                      id="settings-search-default-mode"
                      value={studioSettings.webSearchMode || 'auto'}
                      onChange={(e) =>
                        onUpdateSettings({
                          webSearchMode: e.target.value as WebSearchMode,
                        })
                      }
                      className="mt-1.5 w-full min-h-[38px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    >
                      <option value="auto">Auto (when current facts are needed)</option>
                      <option value="on">Always On</option>
                      <option value="off">Off</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="settings-search-max-results"
                      className="block font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Max Sources per Query
                    </label>
                    <select
                      id="settings-search-max-results"
                      value={searchMaxResults}
                      onChange={(e) => setSearchMaxResults(Number(e.target.value))}
                      className="mt-1.5 w-full min-h-[38px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                    >
                      <option value={3}>3 sources (fast &amp; compact)</option>
                      <option value={5}>5 sources (balanced)</option>
                      <option value={8}>8 sources (deep research)</option>
                    </select>
                  </div>
                </div>

                {activeSearchPreset.steps && (
                  <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/90 p-3.5 space-y-2 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        How to connect {activeSearchPreset.name}
                      </p>
                      {activeSearchPreset.portalUrl && (
                        <a
                          href={activeSearchPreset.portalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                        >
                          <span>{activeSearchPreset.portalLabel}</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                    <ol className="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {activeSearchPreset.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {searchTestResult && (
                  <div
                    role="status"
                    className={`flex items-start gap-2 rounded-xl border p-3 ${
                      searchTestResult.ok
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-200'
                    }`}
                  >
                    {searchTestResult.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <p className="text-[11px] leading-relaxed">{searchTestResult.message}</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    disabled={isTestingSearch || !searchApiKey.trim() || !searchBaseUrl.trim()}
                    onClick={() => void handleTestWebSearch()}
                    className="inline-flex w-full sm:w-auto justify-center min-h-[44px] sm:min-h-[40px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    {isTestingSearch && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    )}
                    <span>{isTestingSearch ? 'Testing Search...' : 'Test Search Connection'}</span>
                  </button>

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2.5">
                    {searchSavedNotice && (
                      <span className="text-center sm:text-left text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        Saved
                      </span>
                    )}
                    <button
                      type="submit"
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-xl mist-primary-gradient px-4 py-2 font-medium text-white shadow-sm transition-all cursor-pointer"
                    >
                      Save Web Search Settings
                    </button>
                  </div>
                </div>
              </form>
            </motion.section>

            {/* Section 2: Generated App AI Integration (Requested-Only by Default) */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 }}
              aria-labelledby="settings-app-ai-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-sky-500 text-white shadow-sm">
                  <Terminal className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="settings-app-ai-heading"
                    className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                  >
                    AI Features Inside Generated Apps
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Control when Mist integrates live <code className="font-mono text-zinc-800 dark:text-zinc-200">/api/app-ai</code> features into generated apps. Preview iframes use scoped ephemeral tokens and never expose your raw API key.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                {(
                  [
                    {
                      id: 'on_request',
                      title: 'On Request Only',
                      desc: 'Recommended — adds AI only when prompted.',
                    },
                    {
                      id: 'off',
                      title: 'Always Off',
                      desc: 'Pure static / Canvas / Three.js builds.',
                    },
                    {
                      id: 'always',
                      title: 'Always Included',
                      desc: 'Wire live App AI into every build.',
                    },
                  ] as Array<{ id: AppAiMode; title: string; desc: string }>
                ).map((opt) => {
                  const active = studioSettings.appAiMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          appAiMode: opt.id,
                          enableAppAi: opt.id === 'always',
                        })
                      }
                      className={`rounded-xl border p-3 text-left transition-all cursor-pointer ${
                        active
                          ? 'border-blue-600 bg-blue-500/10 text-zinc-950 dark:border-blue-500/70 dark:text-white'
                          : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <p className="font-semibold">{opt.title}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/70">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    Runtime Endpoint: <code className="font-mono text-blue-600 dark:text-blue-400">POST /api/app-ai</code>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Exposed only when enabled via <code className="font-mono">window.mistAI.complete()</code> &amp; <code className="font-mono">window.mistAI.chat()</code>.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isTestingAppAi || !apiKey.trim()}
                  onClick={() => void handleTestAppAiEndpoint()}
                  className="inline-flex w-full sm:w-auto justify-center min-h-[44px] sm:min-h-[38px] items-center gap-1.5 rounded-xl sm:rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isTestingAppAi && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>Verify Runtime</span>
                </button>
              </div>

              {appAiTestOutput && (
                <div
                  role="status"
                  className={`mt-3 rounded-xl border p-3 text-xs ${
                    appAiTestOutput.ok
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
                  }`}
                >
                  {appAiTestOutput.message}
                </div>
              )}
            </motion.section>
          </div>

          {/* Right Secondary Column */}
          <div className="lg:col-span-5 space-y-6">
            {/* Section 3: Account Summary (No internal DB telemetry or sync badges) */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.12 }}
              aria-labelledby="settings-account-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-sm">
                  <UserIcon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="settings-account-heading"
                    className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                  >
                    Account Profile
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Your projects and preferences follow your sign-in
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-4 text-xs">
                {user ? (
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-200/80 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'Account avatar'}
                        referrerPolicy="no-referrer"
                        className="h-10 w-10 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {(user.displayName || user.email || 'M')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-zinc-950 dark:text-white truncate">
                        {user.displayName || 'Mist Builder'}
                      </p>
                      <p className="text-zinc-500 dark:text-zinc-400 truncate">{user.email}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3.5 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      Sign in with Google to save your websites, settings, and published deployments across devices.
                    </p>
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="mt-3 w-full min-h-[40px] rounded-xl mist-primary-gradient px-4 py-2 font-medium text-white shadow-sm transition-all cursor-pointer"
                    >
                      Continue with Google
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 divide-x divide-zinc-200 rounded-xl border border-zinc-200/80 bg-white/70 text-center dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <div className="py-3 px-2">
                    <p className="font-display text-lg font-semibold text-zinc-950 dark:text-white tabular-nums">
                      {projects.length}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Saved Projects</p>
                  </div>
                  <div className="py-3 px-2">
                    <p className="font-display text-lg font-semibold text-zinc-950 dark:text-white tabular-nums">
                      {deployments.length}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Published Sites</p>
                  </div>
                </div>
              </div>
            </motion.section>

            {/* Section 4: Appearance & Studio Defaults */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.16 }}
              aria-labelledby="settings-appearance-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 shadow-sm">
                  <Sliders className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="settings-appearance-heading"
                    className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                  >
                    Appearance &amp; Workspace
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Customize theme and default editor layout
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-4 text-xs">
                <div>
                  <p className="mb-1.5 font-medium text-zinc-700 dark:text-zinc-300">Studio Theme</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ theme: 'dark' })}
                      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border px-3 py-2 font-medium transition-colors cursor-pointer ${
                        studioSettings.theme === 'dark'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Dark Mode</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ theme: 'light' })}
                      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border px-3 py-2 font-medium transition-colors cursor-pointer ${
                        studioSettings.theme === 'light'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Light Mode</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="settings-default-view"
                    className="block font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Default Workspace Tab
                  </label>
                  <select
                    id="settings-default-view"
                    value={studioSettings.defaultViewMode}
                    onChange={(e) =>
                      onUpdateSettings({
                        defaultViewMode: e.target.value as WorkspaceViewMode,
                      })
                    }
                    className="mt-1.5 w-full min-h-[40px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                  >
                    <option value="preview">Live Preview</option>
                    <option value="visual">Visual Editor</option>
                    <option value="code">Code Editor</option>
                    <option value="split">Split Code + Preview</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="settings-default-viewport"
                    className="block font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Default Preview Frame
                  </label>
                  <select
                    id="settings-default-viewport"
                    value={studioSettings.defaultViewport}
                    onChange={(e) =>
                      onUpdateSettings({
                        defaultViewport: e.target.value as ViewportSize,
                      })
                    }
                    className="mt-1.5 w-full min-h-[40px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                  >
                    <option value="desktop">Desktop (100%)</option>
                    <option value="tablet">Tablet (768px)</option>
                    <option value="mobile">Mobile (390px)</option>
                  </select>
                </div>
              </div>
            </motion.section>
          </div>
        </div>
      </main>
    </div>
  );
}
