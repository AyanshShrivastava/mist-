import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  LogOut,
  RefreshCw,
  Rocket,
  Server,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { MistUser as User } from '../../types/mist';
import { mistApi } from '../../utils/apiClient';
import RenderConnectCard from './RenderConnectCard';

interface RenderServiceSummary {
  id: string;
  name: string;
  ownerId: string;
  repo: string;
  branch: string;
  url: string;
  dashboardUrl: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface SettingsHostingSectionProps {
  user: User | null;
  renderStatus: {
    connected: boolean;
    authMethod?: 'api_key';
    oauthMcpConnected?: boolean;
    keyHint?: string;
    owner?: { id: string; name: string; email?: string; type: 'user' | 'team' };
    connectedAt?: string;
  } | null;
  renderLoading: boolean;
  onRefreshStatus: () => Promise<void>;
}

function HostingNotSignedInCard() {
  return (
    <p className="rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3.5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400 leading-relaxed">
      Sign in to Mist to securely encrypt your Render API key in your server-side credential vault.
    </p>
  );
}

function HostingLoadingCard() {
  return (
    <div className="flex items-center justify-center py-4 text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      <span>Checking hosting connection status...</span>
    </div>
  );
}

function HostingConnectedCard({
  renderStatus,
  services,
  servicesLoading,
  deployingServiceId,
  isDisconnecting,
  renderError,
  onRefreshServices,
  onRedeployService,
  onDisconnect,
}: {
  renderStatus: NonNullable<SettingsHostingSectionProps['renderStatus']>;
  services: RenderServiceSummary[];
  servicesLoading: boolean;
  deployingServiceId: string | null;
  isDisconnecting: boolean;
  renderError: string | null;
  onRefreshServices: () => void;
  onRedeployService: (serviceId: string) => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-950 dark:text-emerald-100">
              {renderStatus.owner?.name || 'Personal Workspace'}
            </span>
            {renderStatus.owner?.type ? (
              <span className="rounded bg-emerald-200/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-300">
                {renderStatus.owner.type}
              </span>
            ) : null}
            <span className="rounded bg-zinc-900/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-900 dark:bg-white/10 dark:text-emerald-200">
              API Key Vault
            </span>
            {renderStatus.oauthMcpConnected ? (
              <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium text-indigo-800 dark:text-indigo-200">
                Render MCP OAuth Active
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-emerald-800 dark:text-emerald-300">
            Key: {renderStatus.keyHint || 'rnd_••••••••'}
          </p>
        </div>

        <button
          type="button"
          disabled={isDisconnecting}
          onClick={onDisconnect}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer disabled:opacity-50"
        >
          {isDisconnecting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <LogOut className="h-3 w-3" />
          )}
          <span>Disconnect</span>
        </button>
      </div>

      {renderError ? (
        <p className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-950/60 dark:text-red-300">
          {renderError}
        </p>
      ) : null}

      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/40 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            Live Render Services ({services.length})
          </span>
          <button
            type="button"
            onClick={onRefreshServices}
            disabled={servicesLoading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${servicesLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {servicesLoading && services.length === 0 ? (
          <p className="py-2 text-[11px] text-zinc-500">Loading Render services...</p>
        ) : services.length === 0 ? (
          <p className="py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            No Render services found yet. Use Publish &rarr; Deploy to Render in any project to create one.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto mist-scrollbar">
            {services.slice(0, 8).map((svc) => (
              <div
                key={svc.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {svc.name}
                    </span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {svc.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    {svc.branch ? (
                      <span className="inline-flex items-center gap-0.5 font-mono">
                        <GitBranch className="h-2.5 w-2.5" />
                        {svc.branch}
                      </span>
                    ) : null}
                    {svc.url ? (
                      <a
                        href={svc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-600 hover:underline dark:text-blue-400 truncate"
                      >
                        <span className="truncate">{svc.url.replace(/^https?:\/\//, '')}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deployingServiceId === svc.id}
                  onClick={() => onRedeployService(svc.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-300 cursor-pointer disabled:opacity-50"
                >
                  {deployingServiceId === svc.id ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Rocket className="h-2.5 w-2.5" />
                  )}
                  <span>Redeploy</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        Your Render API key is encrypted with AES-256-GCM in your personal credential vault. For AI-driven Render MCP tools via OAuth 2.1, connect <code className="font-mono">https://mcp.render.com/mcp</code> in the MCP Servers tab above.
      </p>
    </div>
  );
}

export default function SettingsHostingSection({
  user,
  renderStatus,
  renderLoading,
  onRefreshStatus,
}: SettingsHostingSectionProps) {
  const [isDisconnectingRender, setIsDisconnectingRender] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [services, setServices] = useState<RenderServiceSummary[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [deployingServiceId, setDeployingServiceId] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    if (!user || !renderStatus?.connected) {
      setServices([]);
      return;
    }
    setServicesLoading(true);
    try {
      const res = await mistApi.listRenderServices();
      setServices(res.services || []);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Could not fetch Render services.');
    } finally {
      setServicesLoading(false);
    }
  }, [user, renderStatus?.connected]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const handleRedeployService = async (serviceId: string) => {
    setDeployingServiceId(serviceId);
    setRenderError(null);
    try {
      await mistApi.triggerRenderDeploy(serviceId, false);
      await loadServices();
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Failed to trigger Render deploy.');
    } finally {
      setDeployingServiceId(null);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnectingRender(true);
    setRenderError(null);
    try {
      await mistApi.disconnectRender();
      setServices([]);
      await onRefreshStatus();
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Failed to disconnect Render account.');
    } finally {
      setIsDisconnectingRender(false);
    }
  };

  const isConnected = Boolean(renderStatus?.connected);

  const renderContent = () => {
    if (!user) {
      return <HostingNotSignedInCard />;
    }
    if (renderLoading) {
      return <HostingLoadingCard />;
    }
    if (renderStatus?.connected) {
      return (
        <HostingConnectedCard
          renderStatus={renderStatus}
          services={services}
          servicesLoading={servicesLoading}
          deployingServiceId={deployingServiceId}
          isDisconnecting={isDisconnectingRender}
          renderError={renderError}
          onRefreshServices={() => void loadServices()}
          onRedeployService={(id) => void handleRedeployService(id)}
          onDisconnect={() => void handleDisconnect()}
        />
      );
    }
    return <RenderConnectCard onConnected={onRefreshStatus} />;
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.14 }}
      aria-labelledby="settings-hosting-heading"
      className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
            <Server className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="settings-hosting-heading"
              className="font-display text-base font-semibold text-zinc-950 dark:text-white"
            >
              Connected Hosting (Render)
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Deploy your generated websites to your personal Render account
            </p>
          </div>
        </div>

        {isConnected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            <span>Connected</span>
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-4 text-xs">
        {renderContent()}
      </div>
    </motion.section>
  );
}