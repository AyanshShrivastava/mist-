import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sun,
  Terminal,
  User as UserIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { User } from 'firebase/auth';
import type {
  AiProviderConfig,
  DeploymentRecord,
  MistProject,
  ProjectSyncRecord,
  StudioSettings,
  ViewportSize,
  WorkspaceViewMode,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  getDefaultModelForProvider,
  normalizeProviderConfigToStudio,
  PRIMARY_STUDIO_PROVIDERS,
  PROVIDER_CATALOG,
  type CustomGatewayId,
} from '../data/models';
import { FIRESTORE_DATABASE_ID, FIREBASE_PROJECT_ID } from '../firebase/client';
import MistLogo from './MistLogo';
import ModelSelectorDropdown from './ModelSelectorDropdown';

interface SettingsViewProps {
  user: User | null;
  projects: MistProject[];
  deployments: DeploymentRecord[];
  providerConfig: AiProviderConfig;
  studioSettings: StudioSettings;
  modelIncident: ModelHealthIncident | null;
  syncRecords: Record<string, ProjectSyncRecord>;
  firestoreConnection: 'checking' | 'online' | 'offline';
  isSyncingAll: boolean;
  isVerifyingCloud: boolean;
  lastVerifiedAt: string | null;
  lastSyncSummary: string | null;
  onBack: () => void;
  onSaveProvider: (next: AiProviderConfig) => void;
  onUpdateSettings: (partial: Partial<StudioSettings>) => void;
  onIncident: (incident: ModelHealthIncident | null) => void;
  onSyncAllToCloud: () => Promise<void>;
  onVerifyCloudSync: () => Promise<void>;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function SettingsView({
  user,
  projects,
  deployments,
  providerConfig,
  studioSettings,
  modelIncident,
  syncRecords,
  firestoreConnection,
  isSyncingAll,
  isVerifyingCloud,
  lastVerifiedAt,
  lastSyncSummary,
  onBack,
  onSaveProvider,
  onUpdateSettings,
  onIncident,
  onSyncAllToCloud,
  onVerifyCloudSync,
  onSignIn,
  onSignOut,
}: SettingsViewProps) {
  const normalizedInit = normalizeProviderConfigToStudio(providerConfig);
  const [provider, setProvider] = useState<'gemini' | 'custom'>(
    normalizedInit.provider === 'gemini' ? 'gemini' : 'custom',
  );
  const [gatewayId, setGatewayId] = useState<CustomGatewayId>(
    detectGatewayFromBaseUrl(normalizedInit.baseUrl),
  );
  const [model, setModel] = useState<string>(normalizedInit.model);
  const [apiKey, setApiKey] = useState<string>(normalizedInit.apiKey || '');
  const [baseUrl, setBaseUrl] = useState<string>(
    normalizedInit.baseUrl || CUSTOM_GATEWAY_PRESETS[0].baseUrl,
  );
  const [savedNotice, setSavedNotice] = useState(false);

  const [isTestingProvider, setIsTestingProvider] = useState(false);
  const [providerTestResult, setProviderTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [isTestingAppAi, setIsTestingAppAi] = useState(false);
  const [appAiTestOutput, setAppAiTestOutput] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    const norm = normalizeProviderConfigToStudio(providerConfig);
    setProvider(norm.provider === 'gemini' ? 'gemini' : 'custom');
    setGatewayId(detectGatewayFromBaseUrl(norm.baseUrl));
    setModel(norm.model);
    setApiKey(norm.apiKey || '');
    setBaseUrl(norm.baseUrl || CUSTOM_GATEWAY_PRESETS[0].baseUrl);
  }, [providerConfig]);

  const syncedProjectsCount = user
    ? projects.filter((p) => syncRecords[p.id]?.state === 'synced').length
    : 0;
  const activeGateway =
    CUSTOM_GATEWAY_PRESETS.find((g) => g.id === gatewayId) || CUSTOM_GATEWAY_PRESETS[0];

  const handleSelectProvider = (next: 'gemini' | 'custom') => {
    setProvider(next);
    if (next === 'gemini') {
      setModel(getDefaultModelForProvider('gemini'));
    } else {
      const gw = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === gatewayId) || CUSTOM_GATEWAY_PRESETS[0];
      if (!baseUrl.trim() && gw.baseUrl) setBaseUrl(gw.baseUrl);
      if (!gw.models.some((m) => m.id === model)) {
        setModel(gw.models[0].id);
      }
    }
    setProviderTestResult(null);
  };

  const handleSelectGateway = (nextGwId: CustomGatewayId) => {
    setGatewayId(nextGwId);
    const gw = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === nextGwId)!;
    if (gw.baseUrl) {
      setBaseUrl(gw.baseUrl);
    }
    setModel(gw.models[0].id);
    setProviderTestResult(null);
  };

  const buildProviderDraft = (): AiProviderConfig => ({
    provider,
    model:
      model.trim() ||
      (provider === 'gemini' ? getDefaultModelForProvider('gemini') : activeGateway.models[0].id),
    apiKey: provider === 'gemini' ? undefined : apiKey.trim(),
    baseUrl: provider === 'custom' ? baseUrl.trim() : undefined,
  });

  const handleApplyProvider = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProvider(buildProviderDraft());
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleTestProvider = async () => {
    setIsTestingProvider(true);
    setProviderTestResult(null);
    const draft = buildProviderDraft();
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
        if (data.incident) onIncident(data.incident);
        setProviderTestResult({
          ok: false,
          message: data.incident?.message || data.error || 'Connection test failed.',
        });
      } else {
        onIncident(null);
        setProviderTestResult({
          ok: true,
          message: `${draft.model} responded cleanly and is ready.`,
        });
      }
    } catch (err) {
      setProviderTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to reach provider endpoint.',
      });
    } finally {
      setIsTestingProvider(false);
    }
  };

  const handleTestAppAiEndpoint = async () => {
    setIsTestingAppAi(true);
    setAppAiTestOutput(null);
    try {
      const resp = await fetch('/api/app-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
              onClick={() =>
                onUpdateSettings({ theme: darkMode ? 'light' : 'dark' })
              }
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white/80 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
                className="inline-flex min-h-[40px] sm:min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex min-h-[40px] sm:min-h-[36px] items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
            Configure AI providers and model catalogs, generated app AI capabilities, cloud project sync, and workspace defaults.
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
            {/* Section 1: AI Providers & Expandable Model Catalog */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.04 }}
              aria-labelledby="settings-ai-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                    <Cpu className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h2
                      id="settings-ai-heading"
                      className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                    >
                      AI Providers &amp; Models
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Switch between built-in Gemini models and Custom OpenAI-compatible gateways (OpenRouter, Groq, NVIDIA NIM, or any custom URL).
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleApplyProvider} className="mt-5 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  {PRIMARY_STUDIO_PROVIDERS.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => handleSelectProvider(pid)}
                      className={`min-h-[42px] rounded-xl border px-3 py-2 font-medium transition-all cursor-pointer ${
                        provider === pid
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-500/15 dark:text-blue-300'
                          : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {PROVIDER_CATALOG[pid].name}
                    </button>
                  ))}
                </div>

                {provider === 'custom' && (
                  <div>
                    <p className="mb-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                      Custom Endpoint Preset
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {CUSTOM_GATEWAY_PRESETS.map((gw) => (
                        <button
                          key={gw.id}
                          type="button"
                          onClick={() => handleSelectGateway(gw.id)}
                          className={`min-h-[36px] rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                            gatewayId === gw.id
                              ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-500/15 dark:text-blue-300'
                              : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800'
                          }`}
                        >
                          {gw.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      Active Model (
                      {provider === 'gemini'
                        ? PROVIDER_CATALOG.gemini.models.length
                        : activeGateway.models.length}{' '}
                      models · Free &amp; Paid tagged)
                    </span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Expand arrow to filter Free / Paid
                    </span>
                  </div>
                  <ModelSelectorDropdown
                    provider={provider}
                    value={model}
                    onChange={setModel}
                    modelsOverride={provider === 'custom' ? activeGateway.models : undefined}
                    gatewayLabel={provider === 'custom' ? activeGateway.name : 'Gemini'}
                  />
                </div>

                {provider === 'gemini' ? (
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400">
                    <strong className="text-zinc-900 dark:text-zinc-200">Free</strong> Gemini models (Gemini 4 Hydrogen, 3.1 Flash Lite, 3.8 Live Voice) run server-side with Mist&apos;s key. <strong className="text-zinc-900 dark:text-zinc-200">Paid</strong> Gemini models require a billing-enabled Gemini API key.
                  </div>
                ) : (
                  <div className="space-y-3">
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

                    <div>
                      <label
                        htmlFor="settings-custom-url"
                        className="block font-medium text-zinc-700 dark:text-zinc-300"
                      >
                        OpenAI-Compatible Base URL
                      </label>
                      <input
                        id="settings-custom-url"
                        type="url"
                        required
                        value={baseUrl}
                        onChange={(e) => {
                          setBaseUrl(e.target.value);
                          setGatewayId(detectGatewayFromBaseUrl(e.target.value));
                        }}
                        placeholder="https://openrouter.ai/api/v1"
                        className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="settings-byok-key"
                        className="block font-medium text-zinc-700 dark:text-zinc-300"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <KeyRound className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                          <span>{activeGateway.name} API Key</span>
                        </span>
                      </label>
                      <input
                        id="settings-byok-key"
                        type="password"
                        required
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={activeGateway.placeholder}
                        className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                      />
                    </div>
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
                    disabled={isTestingProvider || (provider !== 'gemini' && !apiKey.trim())}
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
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-xl bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
                    >
                      Save Provider Settings
                    </button>
                  </div>
                </div>
              </form>
            </motion.section>

            {/* Section 2: Generated App AI Integration */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 }}
              aria-labelledby="settings-app-ai-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
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
                      Generated websites automatically receive a live <code className="font-mono text-zinc-800 dark:text-zinc-200">/api/app-ai</code> runtime bridge in both Live Preview and deployed <code className="font-mono text-zinc-800 dark:text-zinc-200">/p/:slug</code> pages so AI chatbots, content generators, and smart tools work for real.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={studioSettings.enableAppAi}
                  aria-label="Enable live AI features in generated apps"
                  onClick={() =>
                    onUpdateSettings({ enableAppAi: !studioSettings.enableAppAi })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                    studioSettings.enableAppAi
                      ? 'bg-blue-600'
                      : 'bg-zinc-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      studioSettings.enableAppAi ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/70">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    Runtime Endpoint: <code className="font-mono text-blue-600 dark:text-blue-400">POST /api/app-ai</code>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Also exposed inside bundled apps as <code className="font-mono">window.mistAI.complete()</code> &amp; <code className="font-mono">window.mistAI.chat()</code>.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isTestingAppAi}
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
            {/* Section 3: Account, Firebase Auth & Cloud Storage */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.12 }}
              aria-labelledby="settings-cloud-heading"
              className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <Database className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="settings-cloud-heading"
                    className="font-display text-base font-semibold text-zinc-950 dark:text-white"
                  >
                    Account &amp; Cloud Sync
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Per-user authentication &amp; Firestore storage
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
                      Sign in with Google to save all your websites, files, deployments, and studio settings permanently in your private cloud account.
                    </p>
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="mt-3 w-full min-h-[40px] rounded-xl bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 transition-colors cursor-pointer"
                    >
                      Continue with Google
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-3 divide-x divide-zinc-200 rounded-xl border border-zinc-200/80 bg-white/70 text-center dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <div className="py-2.5 px-2">
                    <p className="font-display text-lg font-semibold text-zinc-950 dark:text-white tabular-nums">
                      {projects.length}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Projects</p>
                  </div>
                  <div className="py-2.5 px-2">
                    <p className="font-display text-lg font-semibold text-zinc-950 dark:text-white tabular-nums">
                      {syncedProjectsCount}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">In Cloud</p>
                  </div>
                  <div className="py-2.5 px-2">
                    <p className="font-display text-lg font-semibold text-zinc-950 dark:text-white tabular-nums">
                      {deployments.length}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Published</p>
                  </div>
                </div>

                {/* Verifiable Firestore Database Metadata & Live Sync Inspector */}
                <div className="space-y-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-200/80 dark:border-zinc-800">
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Firestore Database Target
                      </p>
                      <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                        {FIREBASE_PROJECT_ID} · {FIRESTORE_DATABASE_ID}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        firestoreConnection === 'online'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : firestoreConnection === 'offline'
                            ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                            : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {firestoreConnection === 'online'
                        ? 'Server Online'
                        : firestoreConnection === 'offline'
                          ? 'Offline'
                          : 'Checking...'}
                    </span>
                  </div>

                  <div className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <p>
                      <strong className="text-zinc-900 dark:text-zinc-200">Account &amp; Preferences:</strong> Verified identity and studio settings are isolated under <code className="font-mono">/users/&#123;uid&#125;</code>.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Cloud className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <p>
                      <strong className="text-zinc-900 dark:text-zinc-200">Projects &amp; Source Files:</strong> Every generated website and its files are saved per owner under <code className="font-mono">/projects/&#123;id&#125;/files</code> with strict <code className="font-mono">ownerId</code> rules.
                    </p>
                  </div>
                </div>

                {/* Per-Project Firestore Verification Ledger */}
                {projects.length > 0 && (
                  <div className="rounded-xl border border-zinc-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/60 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-zinc-200/80 px-3 py-2 text-[11px] font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                      <span>Per-Project Firestore Status</span>
                      {lastVerifiedAt && (
                        <span className="text-[10px] text-zinc-400">
                          Checked {new Date(lastVerifiedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    <div className="max-h-44 divide-y divide-zinc-200/70 overflow-y-auto dark:divide-zinc-800 mist-scrollbar">
                      {projects.map((p) => {
                        const rec = syncRecords[p.id];
                        const statusText = !user
                          ? 'Local only'
                          : rec?.state === 'syncing'
                            ? 'Syncing...'
                            : rec?.state === 'error'
                              ? 'Sync error'
                              : rec?.state === 'synced'
                                ? `Synced (${rec.cloudFileCount ?? p.files.length} files)`
                                : 'Pending sync';
                        const badgeClass = !user
                          ? 'text-zinc-500'
                          : rec?.state === 'syncing'
                            ? 'text-blue-600 dark:text-blue-400'
                            : rec?.state === 'error'
                              ? 'text-red-600 dark:text-red-400'
                              : rec?.state === 'synced'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400';

                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                {p.name}
                              </p>
                              <p className="font-mono text-[10px] text-zinc-400 truncate">
                                {p.id} · {p.files.length} local files
                              </p>
                            </div>
                            <span className={`font-semibold whitespace-nowrap shrink-0 ${badgeClass}`}>
                              {statusText}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isVerifyingCloud}
                      onClick={() => void onVerifyCloudSync()}
                      className="inline-flex w-full min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <CheckCircle2
                        className={`h-3.5 w-3.5 ${isVerifyingCloud ? 'animate-pulse text-blue-500' : 'text-emerald-600 dark:text-emerald-400'}`}
                        aria-hidden="true"
                      />
                      <span>{isVerifyingCloud ? 'Verifying...' : 'Verify in Firestore'}</span>
                    </button>

                    {user && (
                      <button
                        type="button"
                        disabled={isSyncingAll}
                        onClick={() => void onSyncAllToCloud()}
                        className="inline-flex w-full min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isSyncingAll ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>{isSyncingAll ? 'Syncing...' : 'Sync All to Cloud'}</span>
                      </button>
                    )}
                  </div>
                  {lastSyncSummary && (
                    <p className="text-center text-[11px] text-emerald-600 dark:text-emerald-400">
                      {lastSyncSummary}
                    </p>
                  )}
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
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900/10 text-zinc-900 dark:bg-white/10 dark:text-white">
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
