import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Globe,
  LogOut,
  Moon,
  Plug,
  Server,
  Sliders,
  Sun,
  Terminal,
  User as UserIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import type {
  AiProviderConfig,
  DeploymentRecord,
  MistProject,
  MistUser as User,
  StudioSettings,
  WebSearchConfig,
} from '../types/mist';
import type { ModelHealthIncident } from '../utils/aiErrors';
import MistLogo from './MistLogo';
import { mistApi } from '../utils/apiClient';
import SettingsAiSection from './settings/SettingsAiSection';
import SettingsWebSearchSection from './settings/SettingsWebSearchSection';
import SettingsAppAiSection from './settings/SettingsAppAiSection';
import SettingsAccountSection from './settings/SettingsAccountSection';
import SettingsHostingSection from './settings/SettingsHostingSection';
import SettingsMcpSection from './settings/SettingsMcpSection';
import SettingsAppearanceSection from './settings/SettingsAppearanceSection';

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

type SettingsTab = 'all' | 'ai' | 'search' | 'mcp' | 'runtime' | 'hosting' | 'account';

const SETTINGS_NAV: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}> = [
  { id: 'all', label: 'All Settings', icon: Sliders },
  { id: 'ai', label: 'AI & Models', icon: Cpu },
  { id: 'search', label: 'Web Search', icon: Globe },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'runtime', label: 'App AI Runtime', icon: Terminal },
  { id: 'hosting', label: 'Hosting', icon: Server },
  { id: 'account', label: 'Account & Theme', icon: UserIcon },
];

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
  const [activeTab, setActiveTab] = useState<SettingsTab>('all');
  const [renderStatus, setRenderStatus] = useState<{
    connected: boolean;
    authMethod?: 'api_key';
    oauthMcpConnected?: boolean;
    keyHint?: string;
    owner?: { id: string; name: string; email?: string; type: 'user' | 'team' };
    connectedAt?: string;
  } | null>(null);
  const [renderLoading, setRenderLoading] = useState(false);

  const fetchRenderStatus = useCallback(async () => {
    if (!user) {
      setRenderStatus(null);
      return;
    }
    setRenderLoading(true);
    try {
      const res = await mistApi.getRenderStatus();
      setRenderStatus(res);
    } catch {
      setRenderStatus({ connected: false });
    } finally {
      setRenderLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchRenderStatus();
  }, [fetchRenderStatus]);

  const darkMode = studioSettings.theme === 'dark';

  const showSection = (tab: Exclude<SettingsTab, 'all'>) =>
    activeTab === 'all' || activeTab === tab;

  return (
    <div className="mist-ambient-canvas min-h-screen flex flex-col">
      {/* Studio Top Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-900/[0.07] bg-[var(--mist-canvas)]/85 backdrop-blur-xl dark:border-white/[0.07]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/80 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Back</span>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <MistLogo size="sm" showWordmark={false} />
              <span className="hidden sm:inline font-display text-sm font-bold text-zinc-950 dark:text-white">
                Mist
              </span>
              <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">/</span>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300 truncate">
                Settings
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: darkMode ? 'light' : 'dark' })}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/80 px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl mist-primary-gradient px-3.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
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
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Configure your BYOK AI endpoints, live web search, in-app AI runtime, hosting, and editor preferences.
          </p>
        </motion.div>

        {modelIncident && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50/90 p-4 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/45 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">{modelIncident.title}</p>
              <p className="mt-0.5 opacity-90">{modelIncident.message}</p>
            </div>
          </div>
        )}

        {/* Mobile Category Tabs */}
        <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-1 mist-scrollbar">
          {SETTINGS_NAV.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-(--mist-c2) bg-(--mist-c2)/10 text-zinc-950 dark:text-white'
                    : 'border-zinc-200 bg-white/80 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400'
                }`}
              >
                <Icon className="h-3.5 w-3.5 text-(--mist-c2)" aria-hidden={true} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Desktop Sticky Sidebar */}
          <aside className="hidden lg:block lg:col-span-3 sticky top-20">
            <nav aria-label="Settings sections" className="mist-surface-card rounded-2xl p-2 space-y-0.5">
              {SETTINGS_NAV.map(({ id, label, icon: Icon }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${active ? '' : 'text-(--mist-c2)'}`}
                      aria-hidden={true}
                    />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Focused Single-Column Sections */}
          <div className="lg:col-span-9 space-y-6">
            {showSection('ai') && (
              <SettingsAiSection
                user={user}
                providerConfig={providerConfig}
                onSaveProvider={onSaveProvider}
                onIncident={onIncident}
              />
            )}

            {showSection('search') && (
              <SettingsWebSearchSection
                user={user}
                webSearchConfig={webSearchConfig}
                studioSettings={studioSettings}
                onSaveWebSearch={onSaveWebSearch}
                onUpdateSettings={onUpdateSettings}
              />
            )}

            {showSection('mcp') && (
              <SettingsMcpSection
                user={user}
                onRenderStatusChanged={fetchRenderStatus}
              />
            )}

            {showSection('runtime') && (
              <SettingsAppAiSection
                user={user}
                studioSettings={studioSettings}
                apiKey={providerConfig.apiKey || ''}
                providerDraft={providerConfig}
                onUpdateSettings={onUpdateSettings}
                onIncident={onIncident}
              />
            )}

            {showSection('hosting') && (
              <SettingsHostingSection
                user={user}
                renderStatus={renderStatus}
                renderLoading={renderLoading}
                onRefreshStatus={fetchRenderStatus}
              />
            )}

            {showSection('account') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SettingsAccountSection
                  user={user}
                  projects={projects}
                  deployments={deployments}
                  onSignIn={onSignIn}
                />
                <SettingsAppearanceSection
                  user={user}
                  studioSettings={studioSettings}
                  onUpdateSettings={onUpdateSettings}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
