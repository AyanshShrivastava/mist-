import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { motion } from 'motion/react';
import type {
  McpAuthType,
  McpServerPublicStatus,
  MistUser as User,
} from '../../types/mist';
import { mistApi } from '../../utils/apiClient';

interface SettingsMcpSectionProps {
  user: User | null;
  onRenderStatusChanged?: () => Promise<void> | void;
}

const MCP_PRESETS: Array<{
  presetId: 'render' | 'github' | 'custom';
  name: string;
  url: string;
  authType: McpAuthType;
  badge: string;
  description: string;
  tokenHelpUrl?: string;
  tokenPlaceholder?: string;
}> = [
  {
    presetId: 'render',
    name: 'Render Official MCP',
    url: 'https://mcp.render.com/mcp',
    authType: 'oauth2',
    badge: 'OAuth 2.1 or API Key',
    description:
      'Official hosted Render MCP server (mcp.render.com). Sign in with Render OAuth 2.1 or use a Render API key to inspect services, deploys, metrics, and logs.',
    tokenHelpUrl: 'https://dashboard.render.com/u/settings#api-keys',
    tokenPlaceholder: 'rnd_xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  {
    presetId: 'github',
    name: 'GitHub Remote MCP',
    url: 'https://api.githubcopilot.com/mcp/',
    authType: 'bearer',
    badge: 'Personal Access Token',
    description:
      'Official GitHub remote MCP endpoint for reading repositories, branches, issues, and pull requests with explicit approval on writes.',
    tokenHelpUrl: 'https://github.com/settings/tokens',
    tokenPlaceholder: 'github_pat_... or ghp_...',
  },
  {
    presetId: 'custom',
    name: 'Custom Remote MCP Server',
    url: '',
    authType: 'oauth2',
    badge: 'Streamable HTTP',
    description:
      'Connect any HTTPS Model Context Protocol server supporting OAuth 2.1 + PKCE, Bearer token auth, or public read-only access.',
    tokenPlaceholder: 'Bearer access token (if required)',
  },
];

export default function SettingsMcpSection({
  user,
  onRenderStatusChanged,
}: SettingsMcpSectionProps) {
  const [servers, setServers] = useState<McpServerPublicStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Add/edit server composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [presetId, setPresetId] = useState<'render' | 'github' | 'custom'>('render');
  const [name, setName] = useState('Render Official MCP');
  const [url, setUrl] = useState('https://mcp.render.com/mcp');
  const [authType, setAuthType] = useState<McpAuthType>('oauth2');
  const [bearerToken, setBearerToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [saving, setSaving] = useState(false);

  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const loadServers = useCallback(async () => {
    if (!user) {
      setServers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await mistApi.listMcpServers();
      setServers(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  // Listen for OAuth popup completion
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== 'object') return;
      const msg = event.data as { type?: string; ok?: boolean; serverId?: string; message?: string };
      if (msg.type === 'MIST_MCP_OAUTH_DONE') {
        if (msg.ok) {
          setStatusNote(msg.message || 'OAuth connection authorized.');
          void loadServers().then(() => {
            if (msg.serverId) {
              void handleTestServer(msg.serverId);
            }
          });
          void onRenderStatusChanged?.();
        } else {
          setError(msg.message || 'MCP OAuth authorization failed.');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  const applyPreset = (id: 'render' | 'github' | 'custom') => {
    const preset = MCP_PRESETS.find((p) => p.presetId === id) || MCP_PRESETS[2];
    setPresetId(id);
    setName(id === 'custom' ? '' : preset.name);
    setUrl(preset.url);
    setAuthType(preset.authType);
    setBearerToken('');
    setClientId('');
    setComposerOpen(true);
    setError(null);
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setError('Server name and HTTPS MCP URL are required.');
      return;
    }
    if (authType === 'bearer' && !bearerToken.trim()) {
      setError('Enter a Bearer token / API key or switch authentication mode to OAuth 2.1 / None.');
      return;
    }
    setSaving(true);
    setError(null);
    setStatusNote(null);
    try {
      const saved = await mistApi.saveMcpServer({
        name: name.trim(),
        url: url.trim(),
        authType,
        presetId,
        bearerToken: authType === 'bearer' ? bearerToken.trim() : undefined,
        clientId: authType === 'oauth2' && clientId.trim() ? clientId.trim() : undefined,
        enabled: true,
      });
      setBearerToken('');
      setComposerOpen(false);
      await loadServers();

      if (authType === 'oauth2') {
        setStatusNote(`Saved "${saved.name}". Starting OAuth 2.1 authorization...`);
        await handleStartOAuth(saved.id);
      } else {
        setStatusNote(`Saved "${saved.name}". Discovering available MCP tools...`);
        await handleTestServer(saved.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MCP server.');
    } finally {
      setSaving(false);
    }
  };

  const handleStartOAuth = async (serverId: string) => {
    setBusyServerId(serverId);
    setError(null);
    try {
      const { authorizeUrl } = await mistApi.startMcpOAuth(serverId);
      const popup = window.open(authorizeUrl, 'mist_mcp_oauth', 'width=560,height=700,noopener=no');
      if (!popup) {
        setError('Popup blocked by browser. Allow popups for Mist or open the authorization URL manually.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate OAuth 2.1 flow.');
    } finally {
      setBusyServerId(null);
    }
  };

  const handleTestServer = async (serverId: string) => {
    setBusyServerId(serverId);
    setError(null);
    try {
      const res = await mistApi.testMcpServer(serverId);
      setServers((prev) => prev.map((s) => (s.id === serverId ? res.server : s)));
      if (res.ok) {
        setExpandedTools((prev) => ({ ...prev, [serverId]: true }));
        setStatusNote(
          `Connected to "${res.server.name}" (${res.server.tools.length} tool${res.server.tools.length === 1 ? '' : 's'} discovered).`,
        );
      } else {
        setError(res.error || res.server.lastError || 'Connection check failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test MCP connection.');
    } finally {
      setBusyServerId(null);
    }
  };

  const handleToggleEnabled = async (server: McpServerPublicStatus) => {
    setBusyServerId(server.id);
    try {
      await mistApi.saveMcpServer({
        id: server.id,
        name: server.name,
        url: server.url,
        authType: server.authType,
        presetId: server.presetId,
        enabled: !server.enabled,
      });
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update server state.');
    } finally {
      setBusyServerId(null);
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    setBusyServerId(serverId);
    setError(null);
    try {
      await mistApi.deleteMcpServer(serverId);
      setServers((prev) => prev.filter((s) => s.id !== serverId));
      void onRenderStatusChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove MCP server.');
    } finally {
      setBusyServerId(null);
    }
  };

  const selectedPreset = MCP_PRESETS.find((p) => p.presetId === presetId) || MCP_PRESETS[2];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.12 }}
      aria-labelledby="settings-mcp-heading"
      className="mist-surface-card rounded-2xl border border-zinc-200/90 p-5 sm:p-6 dark:border-zinc-800/90"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
            <Plug className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="settings-mcp-heading"
              className="font-display text-base font-semibold text-zinc-950 dark:text-white"
            >
              MCP Servers &amp; External Tools
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Connect real remote MCP servers (OAuth 2.1 PKCE or API keys) usable directly by Mist AI Agent
            </p>
          </div>
        </div>

        {user && (
          <button
            type="button"
            onClick={() => setComposerOpen((o) => !o)}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl mist-primary-gradient px-3 text-xs font-medium text-white shadow-sm cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{composerOpen ? 'Close' : 'Add MCP Server'}</span>
          </button>
        )}
      </div>

      {!user ? (
        <p className="mt-4 rounded-xl border border-zinc-200/80 bg-zinc-50/90 p-3.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400 leading-relaxed">
          Sign in to Mist to configure encrypted MCP connections and OAuth 2.1 credentials inside your server vault.
        </p>
      ) : (
        <div className="mt-4 space-y-4 text-xs">
          {/* Quick Presets */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {MCP_PRESETS.map((p) => (
              <button
                key={p.presetId}
                type="button"
                onClick={() => applyPreset(p.presetId)}
                className={`rounded-xl border p-3 text-left transition-all cursor-pointer ${
                  composerOpen && presetId === p.presetId
                    ? 'border-(--mist-c2) bg-(--mist-c2)/10'
                    : 'border-zinc-200/80 bg-zinc-50/70 hover:bg-zinc-100/80 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-950 dark:text-white">{p.name}</span>
                </div>
                <span className="mt-1 inline-block rounded bg-zinc-200/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {p.badge}
                </span>
                <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2">
                  {p.description}
                </p>
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {statusNote && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3 text-[11px] text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{statusNote}</span>
            </div>
          )}

          {/* Add / Configure Form */}
          {composerOpen && (
            <form
              onSubmit={handleSaveServer}
              className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/70"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-zinc-950 dark:text-white">
                  Configure {selectedPreset.name}
                </p>
                {selectedPreset.tokenHelpUrl && (
                  <a
                    href={selectedPreset.tokenHelpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    <span>Get Token</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My MCP Server"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Authentication Mode
                  </label>
                  <select
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as McpAuthType)}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                  >
                    <option value="oauth2">OAuth 2.1 + PKCE (Browser Sign-In)</option>
                    <option value="bearer">API Key / Bearer Token</option>
                    <option value="none">No Authentication (Public MCP)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Remote Streamable HTTP MCP Endpoint URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://mcp.render.com/mcp"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                />
              </div>

              {authType === 'bearer' && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Bearer Token / API Key (encrypted with AES-256-GCM)
                  </label>
                  <input
                    type="password"
                    value={bearerToken}
                    onChange={(e) => setBearerToken(e.target.value)}
                    placeholder={selectedPreset.tokenPlaceholder || 'Paste API key or token'}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                  />
                </div>
              )}

              {authType === 'oauth2' && (
                <div>
                  <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    OAuth Client ID <span className="text-zinc-400">(optional if server supports RFC 7591 dynamic registration)</span>
                  </label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Auto-discovered via dynamic client registration if blank"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <Lock className="h-3 w-3" />
                  <span>Credentials never enter browser localStorage; encrypted server-side per account.</span>
                </span>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg mist-primary-gradient px-3.5 text-xs font-medium text-white shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{authType === 'oauth2' ? 'Save & Authorize OAuth' : 'Save & Discover Tools'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Connected Servers List */}
          {loading ? (
            <div className="flex items-center justify-center py-6 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span>Loading configured MCP servers...</span>
            </div>
          ) : servers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 p-5 text-center text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No MCP servers connected yet. Pick a preset above (such as Render Official MCP or GitHub) or add any HTTPS MCP endpoint.
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((server) => {
                const isBusy = busyServerId === server.id;
                const toolsOpen = Boolean(expandedTools[server.id]);
                const statusBadge =
                  server.status === 'connected'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                    : server.status === 'auth_expired'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                      : server.status === 'error'
                        ? 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-300'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';

                return (
                  <div
                    key={server.id}
                    className="rounded-xl border border-zinc-200/90 bg-white/90 p-4 dark:border-zinc-800 dark:bg-zinc-950/70"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-950 dark:text-white">
                            {server.name}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBadge}`}>
                            {server.status.replace('_', ' ')}
                          </span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            {server.authType === 'oauth2'
                              ? 'OAuth 2.1'
                              : server.authType === 'bearer'
                                ? 'API Key / Bearer'
                                : 'No Auth'}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          {server.url}
                        </p>
                        {server.credentialHint && (
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                            Credential: {server.credentialHint}
                          </p>
                        )}
                        {server.lastError && (
                          <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:bg-red-950/50 dark:text-red-300">
                            {server.lastError}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <label className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={server.enabled}
                            disabled={isBusy}
                            onChange={() => void handleToggleEnabled(server)}
                            className="accent-blue-600"
                          />
                          <span>Active</span>
                        </label>

                        {server.authType === 'oauth2' && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleStartOAuth(server.id)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300 cursor-pointer"
                          >
                            <KeyRound className="h-3 w-3" />
                            <span>{server.hasCredential ? 'Reconnect OAuth' : 'Authorize OAuth'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleTestServer(server.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          <span>Test &amp; Tools</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDeleteServer(server.id)}
                          aria-label={`Remove ${server.name}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Discovered Tools Drawer */}
                    {server.tools.length > 0 && (
                      <div className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800/80">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTools((prev) => ({ ...prev, [server.id]: !toolsOpen }))
                          }
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white cursor-pointer"
                        >
                          {toolsOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          <Wrench className="h-3 w-3 text-(--mist-c2)" />
                          <span>
                            {server.tools.length} Live Tool{server.tools.length === 1 ? '' : 's'} Discovered
                          </span>
                        </button>

                        {toolsOpen && (
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {server.tools.map((tool) => {
                              const isWrite =
                                tool.annotations?.destructiveHint ||
                                tool.annotations?.readOnlyHint === false;
                              return (
                                <div
                                  key={tool.name}
                                  className="rounded-lg border border-zinc-200/70 bg-zinc-50/70 p-2 dark:border-zinc-800 dark:bg-zinc-900/50"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <code className="font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                      {tool.name}
                                    </code>
                                    {isWrite ? (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 shrink-0">
                                        <ShieldAlert className="h-2.5 w-2.5" />
                                        <span>Approval Gate</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 shrink-0">
                                        <ShieldCheck className="h-2.5 w-2.5" />
                                        <span>Read-Safe</span>
                                      </span>
                                    )}
                                  </div>
                                  {tool.description && (
                                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2">
                                      {tool.description}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
