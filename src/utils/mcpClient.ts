import crypto from 'node:crypto';
import type {
  McpServerConfig,
  McpServerCredential,
  McpToolDefinition,
} from '../types/mist';
import { redactSecrets } from './aiErrors';
import {
  assertSafeExternalUrl,
  safeFetchExternal,
  sanitizeErrorMessage,
  SecurityValidationError,
  validateExternalUrlSyntax,
  type LookupFn,
} from './serverSecurity';

export class McpClientError extends Error {
  status: number;
  code: string;
  wwwAuthenticate?: string;
  constructor(status: number, message: string, code = 'MCP_ERROR', wwwAuthenticate?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

export interface McpOAuthMetadata {
  resource?: string;
  authorizationServer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

export interface McpDiscoveryResult {
  protocolVersion: string;
  serverInfo?: { name?: string; version?: string };
  tools: McpToolDefinition[];
  sessionId?: string;
}

export interface McpToolCallResult {
  isError: boolean;
  text: string;
  rawContent: unknown[];
}

export interface McpCallOptions {
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  signal?: AbortSignal;
  onCredentialUpdated?: (updated: McpServerCredential) => Promise<void> | void;
}

const MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

export function isOfficialRenderMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'mcp.render.com';
  } catch {
    return false;
  }
}

export function isOfficialGitHubMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'api.githubcopilot.com';
  } catch {
    return false;
  }
}

export function classifyMcpToolSensitivity(tool: McpToolDefinition): {
  sensitive: boolean;
  reason: string;
} {
  if (tool.annotations?.destructiveHint === true) {
    return {
      sensitive: true,
      reason: 'Tool declares destructiveHint=true and can permanently alter or delete remote resources.',
    };
  }
  if (tool.annotations?.readOnlyHint === true) {
    return { sensitive: false, reason: 'Declared read-only tool.' };
  }

  const nameLower = tool.name.toLowerCase();
  const READ_ONLY_PREFIX =
    /^(list|get|read|search|find|fetch|inspect|status|describe|show|check|view|query|tail|metrics|logs|who|whoami|branches)/;
  const MUTATING_PATTERN =
    /(create|update|delete|remove|destroy|deploy|trigger|rollback|restart|suspend|resume|scale|push|merge|commit|write|edit|patch|put|post|send|publish|set|add|revoke|exec|run|mutate|invoke)/;

  if (MUTATING_PATTERN.test(nameLower)) {
    return {
      sensitive: true,
      reason: `Tool "${tool.name}" can create, modify, deploy, or delete external resources and requires your approval.`,
    };
  }
  if (READ_ONLY_PREFIX.test(nameLower)) {
    return { sensitive: false, reason: 'Read-only inspection tool.' };
  }

  return {
    sensitive: true,
    reason: `Tool "${tool.name}" does not declare readOnlyHint=true; confirm before executing external side effects.`,
  };
}

function buildMcpAuthHeaders(
  server: McpServerConfig,
  credential?: McpServerCredential,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  if (server.authType !== 'none' && credential?.accessToken?.trim()) {
    const scheme = credential.tokenType?.trim() || 'Bearer';
    headers.Authorization = `${scheme} ${credential.accessToken.trim()}`;
  }
  return headers;
}

function parseSseJsonRpcPayloads(sseBody: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const normalized = sseBody.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  for (const block of blocks) {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n').trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        results.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore non-JSON SSE control frames
    }
  }
  return results;
}

async function decodeMcpHttpResponse(
  resp: Response,
  expectedId: number | string,
): Promise<{ payload: Record<string, unknown>; sessionId?: string }> {
  const sessionId = resp.headers.get('mcp-session-id')?.trim() || undefined;

  if (resp.status === 401 || resp.status === 403) {
    const wwwAuth = resp.headers.get('www-authenticate') || undefined;
    throw new McpClientError(
      resp.status,
      resp.status === 401
        ? 'MCP server requires authentication or your credentials have expired.'
        : 'MCP server rejected access (403 Forbidden). Check token permissions.',
      resp.status === 401 ? 'MCP_UNAUTHORIZED' : 'MCP_FORBIDDEN',
      wwwAuth,
    );
  }

  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const rawBody = await resp.text();

  if (!resp.ok) {
    throw new McpClientError(
      resp.status >= 400 ? resp.status : 502,
      `MCP HTTP ${resp.status}: ${redactSecrets(rawBody).slice(0, 320)}`,
      'MCP_HTTP_ERROR',
    );
  }

  if (resp.status === 202 || !rawBody.trim()) {
    return { payload: { jsonrpc: '2.0', id: expectedId, result: {} }, sessionId };
  }

  if (contentType.includes('text/event-stream') || rawBody.trimStart().startsWith('event:') || rawBody.trimStart().startsWith('data:')) {
    const events = parseSseJsonRpcPayloads(rawBody);
    const matching =
      events.find((ev) => ev.id === expectedId) ||
      events.find((ev) => 'result' in ev || 'error' in ev) ||
      events[events.length - 1];
    if (!matching) {
      throw new McpClientError(502, 'MCP SSE response did not contain a valid JSON-RPC payload.', 'MCP_INVALID_RESPONSE');
    }
    return { payload: matching, sessionId };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new McpClientError(502, `MCP server returned invalid JSON: ${redactSecrets(rawBody).slice(0, 180)}`, 'MCP_INVALID_JSON');
  }

  if (Array.isArray(parsed)) {
    const item = (parsed.find((x: any) => x?.id === expectedId) || parsed[0]) as Record<string, unknown> | undefined;
    if (!item) {
      throw new McpClientError(502, 'MCP batch response was empty.', 'MCP_INVALID_RESPONSE');
    }
    return { payload: item, sessionId };
  }

  return { payload: parsed as Record<string, unknown>, sessionId };
}

function isCredentialExpiringSoon(cred?: McpServerCredential): boolean {
  if (!cred?.expiresAt) return false;
  const expiresMs = Date.parse(cred.expiresAt);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= Date.now() + 60_000;
}

export async function refreshMcpOAuthCredential(params: {
  server: McpServerConfig;
  credential: McpServerCredential;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  signal?: AbortSignal;
}): Promise<McpServerCredential> {
  const { credential } = params;
  if (!credential.refreshToken || !credential.tokenEndpoint) {
    throw new McpClientError(
      401,
      'OAuth access token expired and no refresh token is available. Reconnect this MCP server.',
      'MCP_TOKEN_EXPIRED',
    );
  }

  validateExternalUrlSyntax(credential.tokenEndpoint);
  await assertSafeExternalUrl(credential.tokenEndpoint, {
    skipDnsLookup: params.skipDnsLookup,
    lookupFn: params.lookupFn,
  });

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken,
  });
  const effectiveClientId = credential.clientId || params.server.clientId;
  if (effectiveClientId) {
    form.set('client_id', effectiveClientId);
  }
  if (credential.clientSecret) {
    form.set('client_secret', credential.clientSecret);
  }

  const resp = await safeFetchExternal(credential.tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    timeoutMs: 15_000,
    parentSignal: params.signal,
    fetchImpl: params.fetchImpl,
    skipDnsLookup: params.skipDnsLookup,
    lookupFn: params.lookupFn,
  });

  if (!resp.ok) {
    const errText = redactSecrets(await resp.text());
    throw new McpClientError(
      401,
      `OAuth token refresh failed (${resp.status}): ${errText.slice(0, 220)}. Please reconnect.`,
      'MCP_REFRESH_FAILED',
    );
  }

  const json = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!json.access_token || typeof json.access_token !== 'string') {
    throw new McpClientError(502, 'OAuth refresh response omitted access_token.', 'MCP_REFRESH_FAILED');
  }

  return {
    ...credential,
    accessToken: json.access_token.trim(),
    refreshToken: json.refresh_token?.trim() || credential.refreshToken,
    tokenType: json.token_type?.trim() || credential.tokenType || 'Bearer',
    expiresAt:
      typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : credential.expiresAt,
  };
}

async function ensureFreshCredential(
  server: McpServerConfig,
  credential: McpServerCredential | undefined,
  options: McpCallOptions,
): Promise<McpServerCredential | undefined> {
  if (!credential) return undefined;
  if (server.authType === 'oauth2' && isCredentialExpiringSoon(credential) && credential.refreshToken) {
    const refreshed = await refreshMcpOAuthCredential({
      server,
      credential,
      fetchImpl: options.fetchImpl,
      skipDnsLookup: options.skipDnsLookup,
      lookupFn: options.lookupFn,
      signal: options.signal,
    });
    await options.onCredentialUpdated?.(refreshed);
    return refreshed;
  }
  return credential;
}

async function openMcpInitializedSession(params: {
  server: McpServerConfig;
  credential?: McpServerCredential;
  options: McpCallOptions;
}): Promise<{ sessionId?: string; protocolVersion: string; serverInfo?: { name?: string; version?: string }; credential?: McpServerCredential }> {
  const { server, options } = params;
  validateExternalUrlSyntax(server.url);
  await assertSafeExternalUrl(server.url, {
    skipDnsLookup: options.skipDnsLookup,
    lookupFn: options.lookupFn,
  });

  let activeCred = await ensureFreshCredential(server, params.credential, options);

  const attemptInitialize = async (cred?: McpServerCredential) => {
    let lastError: unknown;
    for (const protoVersion of MCP_PROTOCOL_VERSIONS) {
      const headers = buildMcpAuthHeaders(server, cred);
      const resp = await safeFetchExternal(server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: protoVersion,
            capabilities: {},
            clientInfo: { name: 'Mist Studio', version: '2.0.0' },
          },
        }),
        timeoutMs: 20_000,
        parentSignal: options.signal,
        fetchImpl: options.fetchImpl,
        skipDnsLookup: options.skipDnsLookup,
        lookupFn: options.lookupFn,
      });
      try {
        const decoded = await decodeMcpHttpResponse(resp, 1);
        const rpcErr = decoded.payload.error as { code?: number; message?: string } | undefined;
        if (rpcErr) {
          lastError = new McpClientError(400, rpcErr.message || 'MCP initialize error', 'MCP_RPC_ERROR');
          continue;
        }
        const res = (decoded.payload.result || {}) as {
          protocolVersion?: string;
          serverInfo?: { name?: string; version?: string };
        };
        const sessionId = decoded.sessionId;
        const notifHeaders = buildMcpAuthHeaders(server, cred);
        if (sessionId) notifHeaders['Mcp-Session-Id'] = sessionId;

        // Send notifications/initialized (best-effort per MCP spec)
        await safeFetchExternal(server.url, {
          method: 'POST',
          headers: notifHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          }),
          timeoutMs: 10_000,
          parentSignal: options.signal,
          fetchImpl: options.fetchImpl,
          skipDnsLookup: options.skipDnsLookup,
          lookupFn: options.lookupFn,
        }).catch(() => {});

        return {
          sessionId,
          protocolVersion: res.protocolVersion || protoVersion,
          serverInfo: res.serverInfo,
          credential: cred,
        };
      } catch (err) {
        if (err instanceof McpClientError && (err.status === 401 || err.status === 403)) {
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new McpClientError(502, 'Failed to initialize MCP session.');
  };

  try {
    return await attemptInitialize(activeCred);
  } catch (err) {
    if (
      err instanceof McpClientError &&
      err.status === 401 &&
      server.authType === 'oauth2' &&
      activeCred?.refreshToken
    ) {
      activeCred = await refreshMcpOAuthCredential({
        server,
        credential: activeCred,
        fetchImpl: options.fetchImpl,
        skipDnsLookup: options.skipDnsLookup,
        lookupFn: options.lookupFn,
        signal: options.signal,
      });
      await options.onCredentialUpdated?.(activeCred);
      return await attemptInitialize(activeCred);
    }
    throw err;
  }
}

export async function connectAndDiscoverMcpTools(params: {
  server: McpServerConfig;
  credential?: McpServerCredential;
  options?: McpCallOptions;
}): Promise<McpDiscoveryResult> {
  const options = params.options || {};
  const session = await openMcpInitializedSession({
    server: params.server,
    credential: params.credential,
    options,
  });

  const tools: McpToolDefinition[] = [];
  let cursor: string | undefined;
  let reqId = 2;

  for (let page = 0; page < 6; page++) {
    const headers = buildMcpAuthHeaders(params.server, session.credential);
    if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;

    const resp = await safeFetchExternal(params.server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: reqId,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      }),
      timeoutMs: 20_000,
      parentSignal: options.signal,
      fetchImpl: options.fetchImpl,
      skipDnsLookup: options.skipDnsLookup,
      lookupFn: options.lookupFn,
    });

    const decoded = await decodeMcpHttpResponse(resp, reqId++);
    const rpcErr = decoded.payload.error as { message?: string } | undefined;
    if (rpcErr) {
      throw new McpClientError(400, rpcErr.message || 'Failed to list MCP tools.', 'MCP_RPC_ERROR');
    }

    const result = (decoded.payload.result || {}) as {
      tools?: Array<{
        name?: unknown;
        description?: unknown;
        inputSchema?: unknown;
        annotations?: unknown;
      }>;
      nextCursor?: unknown;
    };

    if (Array.isArray(result.tools)) {
      for (const t of result.tools) {
        if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
        tools.push({
          name: t.name.trim(),
          description: typeof t.description === 'string' ? t.description.trim() : undefined,
          inputSchema:
            t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
              ? (t.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
          annotations:
            t.annotations && typeof t.annotations === 'object' && !Array.isArray(t.annotations)
              ? (t.annotations as McpToolDefinition['annotations'])
              : undefined,
        });
      }
    }

    cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) break;
  }

  return {
    protocolVersion: session.protocolVersion,
    serverInfo: session.serverInfo,
    tools,
    sessionId: session.sessionId,
  };
}

export async function invokeMcpServerTool(params: {
  server: McpServerConfig;
  credential?: McpServerCredential;
  toolName: string;
  args: Record<string, unknown>;
  options?: McpCallOptions;
}): Promise<McpToolCallResult> {
  const options = params.options || {};
  const session = await openMcpInitializedSession({
    server: params.server,
    credential: params.credential,
    options,
  });

  const headers = buildMcpAuthHeaders(params.server, session.credential);
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;

  const resp = await safeFetchExternal(params.server.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: params.toolName,
        arguments: params.args || {},
      },
    }),
    timeoutMs: 45_000,
    parentSignal: options.signal,
    fetchImpl: options.fetchImpl,
    skipDnsLookup: options.skipDnsLookup,
    lookupFn: options.lookupFn,
  });

  const decoded = await decodeMcpHttpResponse(resp, 100);
  const rpcErr = decoded.payload.error as { message?: string } | undefined;
  if (rpcErr) {
    throw new McpClientError(400, rpcErr.message || `Tool ${params.toolName} failed.`, 'MCP_TOOL_ERROR');
  }

  const result = (decoded.payload.result || {}) as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string; data?: unknown }>;
    structuredContent?: unknown;
  };
  const contentList = Array.isArray(result.content) ? result.content : [];
  const textParts = contentList
    .map((c) => {
      if (typeof c?.text === 'string') return c.text;
      if (c && typeof c === 'object') return JSON.stringify(c);
      return String(c ?? '');
    })
    .filter(Boolean);
  if (result.structuredContent !== undefined && textParts.length === 0) {
    textParts.push(JSON.stringify(result.structuredContent, null, 2));
  }

  return {
    isError: Boolean(result.isError),
    text: redactSecrets(textParts.join('\n')).slice(0, 28_000),
    rawContent: contentList,
  };
}

function parseResourceMetadataFromWwwAuth(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/resource_metadata=["']([^"']+)["']/i);
  return match ? match[1].trim() : null;
}

async function fetchJsonSafely(
  targetUrl: string,
  options: { fetchImpl?: typeof fetch; skipDnsLookup?: boolean; lookupFn?: LookupFn; signal?: AbortSignal },
): Promise<Record<string, unknown> | null> {
  try {
    validateExternalUrlSyntax(targetUrl);
    await assertSafeExternalUrl(targetUrl, {
      skipDnsLookup: options.skipDnsLookup,
      lookupFn: options.lookupFn,
    });
    const resp = await safeFetchExternal(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs: 10_000,
      parentSignal: options.signal,
      fetchImpl: options.fetchImpl,
      skipDnsLookup: options.skipDnsLookup,
      lookupFn: options.lookupFn,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function discoverMcpOAuthMetadata(params: {
  serverUrl: string;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  signal?: AbortSignal;
}): Promise<McpOAuthMetadata> {
  const parsedUrl = validateExternalUrlSyntax(params.serverUrl);
  await assertSafeExternalUrl(params.serverUrl, {
    skipDnsLookup: params.skipDnsLookup,
    lookupFn: params.lookupFn,
  });

  const origin = parsedUrl.origin;
  const cleanPath = parsedUrl.pathname.replace(/^\/+|\/+$/g, '');

  // Step 1: Probe server with empty POST / GET to inspect WWW-Authenticate challenge per MCP OAuth 2.1 spec
  let resourceMetadataUrl: string | null = null;
  try {
    const probeResp = await safeFetchExternal(params.serverUrl, {
      method: 'POST',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Mist Studio', version: '2.0.0' } } }),
      timeoutMs: 10_000,
      parentSignal: params.signal,
      fetchImpl: params.fetchImpl,
      skipDnsLookup: params.skipDnsLookup,
      lookupFn: params.lookupFn,
    });
    if (probeResp.status === 401) {
      resourceMetadataUrl = parseResourceMetadataFromWwwAuth(probeResp.headers.get('www-authenticate'));
    }
  } catch {
    // Continue to standard well-known paths
  }

  // Step 2: Protected Resource Metadata (RFC 9728)
  const prmCandidates = [
    ...(resourceMetadataUrl ? [resourceMetadataUrl] : []),
    ...(cleanPath ? [`${origin}/.well-known/oauth-protected-resource/${cleanPath}`] : []),
    `${origin}/.well-known/oauth-protected-resource`,
  ];

  let prm: Record<string, unknown> | null = null;
  for (const candidate of prmCandidates) {
    prm = await fetchJsonSafely(candidate, params);
    if (prm) break;
  }

  const authServerBase =
    (Array.isArray(prm?.authorization_servers) && typeof prm!.authorization_servers[0] === 'string'
      ? prm!.authorization_servers[0]
      : origin).replace(/\/+$/, '');

  // Step 3: Authorization Server Metadata (RFC 8414 / OIDC)
  const authUrl = validateExternalUrlSyntax(authServerBase);
  const authPath = authUrl.pathname.replace(/^\/+|\/+$/g, '');
  const asmCandidates = [
    ...(authPath ? [`${authUrl.origin}/.well-known/oauth-authorization-server/${authPath}`] : []),
    `${authUrl.origin}/.well-known/oauth-authorization-server`,
    ...(authPath ? [`${authUrl.origin}/${authPath}/.well-known/openid-configuration`] : []),
    `${authUrl.origin}/.well-known/openid-configuration`,
  ];

  let asm: Record<string, unknown> | null = null;
  for (const candidate of asmCandidates) {
    asm = await fetchJsonSafely(candidate, params);
    if (asm && typeof asm.authorization_endpoint === 'string' && typeof asm.token_endpoint === 'string') {
      break;
    }
    asm = null;
  }

  if (!asm) {
    throw new McpClientError(
      400,
      `MCP server at ${origin} does not expose OAuth 2.1 authorization metadata (RFC 9728 / RFC 8414). Use Bearer Token / API Key authentication instead if supported by this server.`,
      'MCP_OAUTH_UNSUPPORTED',
    );
  }

  const authorizationEndpoint = String(asm.authorization_endpoint);
  const tokenEndpoint = String(asm.token_endpoint);
  validateExternalUrlSyntax(authorizationEndpoint);
  validateExternalUrlSyntax(tokenEndpoint);

  const registrationEndpoint =
    typeof asm.registration_endpoint === 'string' && asm.registration_endpoint
      ? asm.registration_endpoint
      : undefined;
  if (registrationEndpoint) {
    validateExternalUrlSyntax(registrationEndpoint);
  }

  const scopesSupported = Array.isArray(prm?.scopes_supported)
    ? (prm!.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string')
    : Array.isArray(asm.scopes_supported)
      ? (asm.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined;

  return {
    resource: typeof prm?.resource === 'string' ? prm.resource : params.serverUrl,
    authorizationServer: authServerBase,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    scopesSupported,
  };
}

export interface PendingMcpOAuthState {
  state: string;
  userId: string;
  userEmail: string;
  serverId: string;
  codeVerifier: string;
  tokenEndpoint: string;
  authorizationEndpoint: string;
  registrationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  resource: string;
  createdAt: number;
}

export async function createMcpOAuthAuthorizationRequest(params: {
  server: McpServerConfig;
  userId: string;
  userEmail: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  signal?: AbortSignal;
}): Promise<{ authorizeUrl: string; pendingState: PendingMcpOAuthState }> {
  const metadata = await discoverMcpOAuthMetadata({
    serverUrl: params.server.url,
    fetchImpl: params.fetchImpl,
    skipDnsLookup: params.skipDnsLookup,
    lookupFn: params.lookupFn,
    signal: params.signal,
  });

  let clientId = params.server.clientId?.trim() || '';
  let clientSecret: string | undefined;

  // RFC 7591 Dynamic Client Registration when server supports it and user didn't supply a static client_id
  if (!clientId && metadata.registrationEndpoint) {
    await assertSafeExternalUrl(metadata.registrationEndpoint, {
      skipDnsLookup: params.skipDnsLookup,
      lookupFn: params.lookupFn,
    });
    const regResp = await safeFetchExternal(metadata.registrationEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'Mist AI Website Builder',
        redirect_uris: [params.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      timeoutMs: 15_000,
      parentSignal: params.signal,
      fetchImpl: params.fetchImpl,
      skipDnsLookup: params.skipDnsLookup,
      lookupFn: params.lookupFn,
    });

    if (regResp.ok) {
      const regData = (await regResp.json()) as { client_id?: string; client_secret?: string };
      if (typeof regData.client_id === 'string' && regData.client_id.trim()) {
        clientId = regData.client_id.trim();
        if (typeof regData.client_secret === 'string' && regData.client_secret.trim()) {
          clientSecret = regData.client_secret.trim();
        }
      }
    }
  }

  if (!clientId) {
    throw new McpClientError(
      400,
      'This MCP server requires a pre-registered OAuth Client ID (Dynamic Client Registration was unavailable). Enter your OAuth Client ID or use Bearer Token authentication.',
      'MCP_CLIENT_ID_REQUIRED',
    );
  }

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  const authUrl = new URL(metadata.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', params.redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  const scopes =
    params.server.scopes && params.server.scopes.length > 0
      ? params.server.scopes
      : metadata.scopesSupported;
  if (scopes && scopes.length > 0) {
    authUrl.searchParams.set('scope', scopes.join(' '));
  }
  if (metadata.resource) {
    authUrl.searchParams.set('resource', metadata.resource);
  }

  return {
    authorizeUrl: authUrl.toString(),
    pendingState: {
      state,
      userId: params.userId,
      userEmail: params.userEmail,
      serverId: params.server.id,
      codeVerifier,
      tokenEndpoint: metadata.tokenEndpoint,
      authorizationEndpoint: metadata.authorizationEndpoint,
      registrationEndpoint: metadata.registrationEndpoint,
      clientId,
      clientSecret,
      redirectUri: params.redirectUri,
      resource: metadata.resource || params.server.url,
      createdAt: Date.now(),
    },
  };
}

export async function exchangeMcpOAuthAuthorizationCode(params: {
  code: string;
  pending: PendingMcpOAuthState;
  fetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  signal?: AbortSignal;
}): Promise<McpServerCredential> {
  validateExternalUrlSyntax(params.pending.tokenEndpoint);
  await assertSafeExternalUrl(params.pending.tokenEndpoint, {
    skipDnsLookup: params.skipDnsLookup,
    lookupFn: params.lookupFn,
  });

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.pending.redirectUri,
    client_id: params.pending.clientId,
    code_verifier: params.pending.codeVerifier,
  });
  if (params.pending.clientSecret) {
    form.set('client_secret', params.pending.clientSecret);
  }
  if (params.pending.resource) {
    form.set('resource', params.pending.resource);
  }

  const resp = await safeFetchExternal(params.pending.tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    timeoutMs: 15_000,
    parentSignal: params.signal,
    fetchImpl: params.fetchImpl,
    skipDnsLookup: params.skipDnsLookup,
    lookupFn: params.lookupFn,
  });

  if (!resp.ok) {
    const errText = redactSecrets(await resp.text());
    throw new McpClientError(
      400,
      `OAuth token exchange failed (${resp.status}): ${errText.slice(0, 260)}`,
      'MCP_OAUTH_EXCHANGE_FAILED',
    );
  }

  const tokenData = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!tokenData.access_token || typeof tokenData.access_token !== 'string') {
    throw new McpClientError(502, 'OAuth token response omitted access_token.', 'MCP_OAUTH_EXCHANGE_FAILED');
  }

  return {
    serverId: params.pending.serverId,
    accessToken: tokenData.access_token.trim(),
    refreshToken: tokenData.refresh_token?.trim(),
    tokenType: tokenData.token_type?.trim() || 'Bearer',
    expiresAt:
      typeof tokenData.expires_in === 'number' && Number.isFinite(tokenData.expires_in)
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : undefined,
    tokenEndpoint: params.pending.tokenEndpoint,
    authorizationEndpoint: params.pending.authorizationEndpoint,
    registrationEndpoint: params.pending.registrationEndpoint,
    clientId: params.pending.clientId,
    clientSecret: params.pending.clientSecret,
  };
}

export function sanitizeMcpError(err: unknown): string {
  if (err instanceof McpClientError || err instanceof SecurityValidationError) {
    return redactSecrets(err.message);
  }
  return sanitizeErrorMessage(err);
}
