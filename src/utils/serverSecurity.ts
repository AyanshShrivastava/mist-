import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from 'express';
import type { AiProviderConfig, ProjectFile, WebSearchConfig } from '../types/mist';
import { redactSecrets } from './aiErrors';
import { maskApiKey, normalizeProjectFilePath } from './projectOps';

// --- 1. SSRF Protection, Safe Redirect-Blocked Fetch & URL Validation ---

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  '0.0.0.0',
]);

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '');
  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 127) return true; // Loopback 127.0.0.0/8
    if (a === 169 && b === 254) return true; // Link-local & cloud metadata 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }

  if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // Unique local fc00::/7
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    if (lower.startsWith('ff')) return true; // Multicast
    return false;
  }

  return true;
}

export class SecurityValidationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validateExternalUrlSyntax(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL((rawUrl || '').trim());
  } catch {
    throw new SecurityValidationError(400, 'Enter a valid HTTPS Base URL (e.g. https://openrouter.ai/api/v1).');
  }

  if (parsed.protocol !== 'https:') {
    throw new SecurityValidationError(400, 'For security, external AI endpoints must use HTTPS (https://).');
  }

  if (parsed.username || parsed.password) {
    throw new SecurityValidationError(400, 'Embedded credentials in URLs are not allowed.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.endsWith('.arpa')
  ) {
    throw new SecurityValidationError(400, 'Blocked internal or loopback host.');
  }

  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new SecurityValidationError(400, 'Private, link-local, and metadata IP addresses are blocked.');
  }

  return parsed;
}

export type LookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export async function assertSafeExternalUrl(
  rawUrl: string,
  options?: { skipDnsLookup?: boolean; lookupFn?: LookupFn },
): Promise<URL> {
  const parsed = validateExternalUrlSyntax(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const lookup = options?.lookupFn || dns.lookup;

  if (!options?.skipDnsLookup && !net.isIP(host)) {
    try {
      const resolved = (await lookup(host, {
        all: true,
        verbatim: true,
      })) as Array<{ address: string; family: number }>;
      if (resolved.length === 0) {
        throw new SecurityValidationError(400, `Unable to resolve host "${host}".`);
      }
      for (const entry of resolved) {
        if (isPrivateOrReservedIp(entry.address)) {
          throw new SecurityValidationError(
            400,
            `Host "${host}" resolved to a restricted private IP address.`,
          );
        }
      }
    } catch (err) {
      if (err instanceof SecurityValidationError) throw err;
      throw new SecurityValidationError(400, `DNS resolution failed for "${host}".`);
    }
  }

  return parsed;
}

export interface SafeFetchOptions extends Omit<RequestInit, 'redirect' | 'signal'> {
  timeoutMs?: number;
  parentSignal?: AbortSignal;
  skipDnsLookup?: boolean;
  lookupFn?: LookupFn;
  fetchImpl?: typeof fetch;
}

/**
 * Performs an SSRF-hardened external fetch:
 * - Validates HTTPS syntax & resolves DNS immediately before connecting (blocks private/loopback/metadata IPs)
 * - Disables HTTP redirects (`redirect: 'error'`) so 301/302 responses cannot redirect into internal networks
 * - Attaches bounded timeouts & propagates caller AbortSignal cancellation
 */
export async function safeFetchExternal(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 15000,
    parentSignal,
    skipDnsLookup,
    lookupFn,
    fetchImpl = globalThis.fetch,
    ...requestInit
  } = options;

  const parsed = await assertSafeExternalUrl(rawUrl, { skipDnsLookup, lookupFn });

  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(parsed.toString(), {
      ...requestInit,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new SecurityValidationError(504, `Upstream endpoint timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    const causeMsg =
      err instanceof Error && err.cause instanceof Error ? err.cause.message.toLowerCase() : '';
    if (msg.includes('redirect') || causeMsg.includes('redirect')) {
      throw new SecurityValidationError(400, 'Blocked HTTP redirect from external endpoint.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  return redactSecrets(raw);
}

// --- 2. Generated File & Path Validation Limits ---

export const MAX_PROJECT_FILES = 120;
export const MAX_FILE_BYTES = 250_000;
export const MAX_TOTAL_PROJECT_BYTES = 3_500_000;

export function validateProjectFilesPayload(
  files: unknown,
  options?: { requireNonEmpty?: boolean },
): ProjectFile[] {
  if (!Array.isArray(files)) {
    throw new SecurityValidationError(400, 'Invalid files payload: expected an array.');
  }
  if (options?.requireNonEmpty && files.length === 0) {
    throw new SecurityValidationError(400, 'Project must contain at least one file.');
  }
  if (files.length > MAX_PROJECT_FILES) {
    throw new SecurityValidationError(
      400,
      `Project exceeds the maximum limit of ${MAX_PROJECT_FILES} files.`,
    );
  }

  let totalBytes = 0;
  const validated: ProjectFile[] = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    const raw = files[i] as Partial<ProjectFile> | null;
    if (!raw || typeof raw !== 'object') {
      throw new SecurityValidationError(400, `Invalid file entry at index ${i}.`);
    }
    const rawPath = String(raw.path || '');
    if (rawPath.includes('\0') || rawPath.includes('..')) {
      throw new SecurityValidationError(400, `Unsafe file path rejected: "${rawPath}".`);
    }
    const cleanPath = normalizeProjectFilePath(rawPath);
    if (!cleanPath || cleanPath.length > 256 || !/^[a-zA-Z0-9._/\-]+$/.test(cleanPath)) {
      throw new SecurityValidationError(400, `Invalid file path: "${cleanPath || '(empty)'}".`);
    }
    if (cleanPath.split('/').some((seg) => seg === '..' || seg === '.')) {
      throw new SecurityValidationError(400, `Path traversal segment not permitted in "${cleanPath}".`);
    }
    if (seenPaths.has(cleanPath.toLowerCase())) continue;
    seenPaths.add(cleanPath.toLowerCase());

    const content = typeof raw.content === 'string' ? raw.content : '';
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) {
      throw new SecurityValidationError(
        400,
        `File "${cleanPath}" exceeds maximum allowed size (${Math.round(MAX_FILE_BYTES / 1000)}KB).`,
      );
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_PROJECT_BYTES) {
      throw new SecurityValidationError(400, 'Total project source size exceeds 3.5MB limit.');
    }

    const lang = raw.language;
    const validLang: ProjectFile['language'] =
      lang === 'tsx' || lang === 'ts' || lang === 'css' || lang === 'html' || lang === 'json'
        ? lang
        : cleanPath.endsWith('.css')
          ? 'css'
          : cleanPath.endsWith('.ts')
            ? 'ts'
            : cleanPath.endsWith('.html')
              ? 'html'
              : cleanPath.endsWith('.json')
                ? 'json'
                : 'tsx';

    validated.push({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 128) : `file_${i}`,
      path: cleanPath,
      language: validLang,
      content,
    });
  }

  return validated;
}

// --- 3. Sliding-Window Rate Limiter (Trusted req.ip + Authenticated User UID) ---

interface RateBucket {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  label: string;
  userMaxRequests?: number;
  getUserKey?: (req: ExpressRequest) => string | undefined;
}) {
  const buckets = new Map<string, RateBucket>();

  const checkAndRecord = (key: string, limit: number, now: number): number | null => {
    const cutoff = now - options.windowMs;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
    if (bucket.timestamps.length >= limit) {
      const oldest = bucket.timestamps[0] || now;
      return Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
    }
    bucket.timestamps.push(now);
    return null;
  };

  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    // Strictly rely on Express's resolved `req.ip` (governed by app.set('trust proxy', ...)),
    // never blindly trusting raw spoofable X-Forwarded-For headers.
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - options.windowMs;

    const ipRetry = checkAndRecord(`ip:${clientIp}`, options.maxRequests, now);
    if (ipRetry !== null) {
      res.setHeader('Retry-After', String(ipRetry));
      res.status(429).json({
        error: `Too many ${options.label} requests from this network. Please wait ${ipRetry}s and try again.`,
      });
      return;
    }

    const userKey = options.getUserKey?.(req) || (req as AuthenticatedRequest).authUser?.uid;
    if (userKey) {
      const userLimit = options.userMaxRequests ?? options.maxRequests;
      const userRetry = checkAndRecord(`uid:${userKey}`, userLimit, now);
      if (userRetry !== null) {
        res.setHeader('Retry-After', String(userRetry));
        res.status(429).json({
          error: `Too many ${options.label} requests for this account. Please wait ${userRetry}s and try again.`,
        });
        return;
      }
    }

    if (buckets.size > 4000) {
      for (const [k, b] of buckets.entries()) {
        if (b.timestamps.every((t) => t <= cutoff)) {
          buckets.delete(k);
        }
      }
    }

    next();
  };
}

// --- 4. Ephemeral Scoped Preview AI Session Vault (Owner-Bound) ---

interface PreviewSessionRecord {
  config: AiProviderConfig;
  ownerUid?: string;
  expiresAt: number;
  createdAt: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const previewSessions = new Map<string, PreviewSessionRecord>();

export function createPreviewAiSession(
  config: AiProviderConfig,
  ownerUid?: string,
): {
  token: string;
  expiresAt: string;
} {
  const now = Date.now();
  for (const [key, rec] of previewSessions.entries()) {
    if (rec.expiresAt <= now) previewSessions.delete(key);
  }
  while (previewSessions.size >= MAX_SESSIONS) {
    const oldestKey = previewSessions.keys().next().value;
    if (!oldestKey) break;
    previewSessions.delete(oldestKey);
  }

  const token = `mist_sess_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = now + SESSION_TTL_MS;
  previewSessions.set(token, {
    config: { ...config },
    ownerUid,
    expiresAt,
    createdAt: now,
  });

  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function resolvePreviewAiSession(token?: string): AiProviderConfig | null {
  if (!token || typeof token !== 'string' || !token.startsWith('mist_sess_')) {
    return null;
  }
  const rec = previewSessions.get(token);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    previewSessions.delete(token);
    return null;
  }
  return rec.config;
}

export function revokePreviewAiSession(token?: string, requesterUid?: string): boolean {
  if (!token) return false;
  const rec = previewSessions.get(token);
  if (!rec) return false;
  if (rec.ownerUid && requesterUid && rec.ownerUid !== requesterUid) {
    throw new SecurityValidationError(403, 'You do not have permission to revoke this session token.');
  }
  if (rec.ownerUid && !requesterUid) {
    throw new SecurityValidationError(401, 'Authentication required to revoke this session.');
  }
  return previewSessions.delete(token);
}

export function revokeAllUserPreviewSessions(uid?: string): number {
  if (!uid) return 0;
  let removed = 0;
  for (const [token, rec] of previewSessions.entries()) {
    if (rec.ownerUid === uid) {
      previewSessions.delete(token);
      removed += 1;
    }
  }
  return removed;
}

// --- 4B. Account-Bound AES-256-GCM Encrypted Credential Vault ---

function deriveUserVaultKey(params: {
  uid: string;
  email: string;
  secretOverride?: string;
}): Buffer {
  const uid = params.uid.trim();
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!uid || !normalizedEmail) {
    throw new SecurityValidationError(400, 'Verified account UID and email are required for credential vault operations.');
  }

  let runtimeProject = 'mist-local';
  try {
    runtimeProject = getFirebaseProjectId();
  } catch {
    // Fallback for isolated test environments without firebase-applet-config.json
  }

  const rawSecret =
    params.secretOverride?.trim() ||
    process.env.MIST_VAULT_SECRET?.trim() ||
    `${runtimeProject}:mist-account-vault-master-v1`;

  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(rawSecret, 'utf8'),
    Buffer.from(`mist:${runtimeProject}:${uid}`, 'utf8'),
    Buffer.from(`mist-vault:${normalizedEmail}`, 'utf8'),
    32,
  );
  return Buffer.from(derived);
}

function makeVaultAad(uid: string, email: string): Buffer {
  return Buffer.from(`${uid.trim()}:${email.trim().toLowerCase()}:mist-vault-v1`, 'utf8');
}

export interface VaultPlainPayload {
  aiConfig?: AiProviderConfig;
  searchConfig?: WebSearchConfig;
}

export function sealUserVaultPayload(params: {
  uid: string;
  email: string;
  aiConfig?: AiProviderConfig;
  searchConfig?: WebSearchConfig;
  secretOverride?: string;
}): {
  encryptedPayload: string;
  aiKeyHint: string;
  searchKeyHint: string;
} {
  const key = deriveUserVaultKey({
    uid: params.uid,
    email: params.email,
    secretOverride: params.secretOverride,
  });

  const cleanAi: AiProviderConfig | undefined = params.aiConfig
    ? {
        ...params.aiConfig,
        apiKey: params.aiConfig.sessionOnlyKey ? '' : params.aiConfig.apiKey || '',
      }
    : undefined;
  const cleanSearch: WebSearchConfig | undefined = params.searchConfig
    ? {
        ...params.searchConfig,
        apiKey: params.searchConfig.sessionOnlyKey ? '' : params.searchConfig.apiKey || '',
      }
    : undefined;

  const plaintext = JSON.stringify({
    v: 1,
    email: params.email.trim().toLowerCase(),
    aiConfig: cleanAi,
    searchConfig: cleanSearch,
  });

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(makeVaultAad(params.uid, params.email));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope = JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    ct: encrypted.toString('base64'),
  });

  return {
    encryptedPayload: Buffer.from(envelope, 'utf8').toString('base64'),
    aiKeyHint: cleanAi?.apiKey ? maskApiKey(cleanAi.apiKey) : '',
    searchKeyHint: cleanSearch?.apiKey ? maskApiKey(cleanSearch.apiKey) : '',
  };
}

export function unsealUserVaultPayload(params: {
  uid: string;
  email: string;
  encryptedPayload: string;
  secretOverride?: string;
}): VaultPlainPayload {
  if (!params.encryptedPayload || typeof params.encryptedPayload !== 'string') {
    throw new SecurityValidationError(400, 'Missing encrypted vault payload.');
  }

  let parsedEnvelope: { v?: number; iv?: string; tag?: string; ct?: string };
  try {
    const rawJson = Buffer.from(params.encryptedPayload, 'base64').toString('utf8');
    parsedEnvelope = JSON.parse(rawJson) as { v?: number; iv?: string; tag?: string; ct?: string };
  } catch {
    throw new SecurityValidationError(400, 'Malformed encrypted credential vault.');
  }

  if (
    parsedEnvelope.v !== 1 ||
    typeof parsedEnvelope.iv !== 'string' ||
    typeof parsedEnvelope.tag !== 'string' ||
    typeof parsedEnvelope.ct !== 'string'
  ) {
    throw new SecurityValidationError(400, 'Unsupported credential vault format.');
  }

  const key = deriveUserVaultKey({
    uid: params.uid,
    email: params.email,
    secretOverride: params.secretOverride,
  });

  try {
    const iv = Buffer.from(parsedEnvelope.iv, 'base64');
    const tag = Buffer.from(parsedEnvelope.tag, 'base64');
    const ct = Buffer.from(parsedEnvelope.ct, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(makeVaultAad(params.uid, params.email));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    const data = JSON.parse(decrypted) as {
      email?: string;
      aiConfig?: AiProviderConfig;
      searchConfig?: WebSearchConfig;
    };
    if (data.email && data.email !== params.email.trim().toLowerCase()) {
      throw new SecurityValidationError(403, 'Credential vault email does not match your signed-in Google account.');
    }
    return {
      aiConfig: data.aiConfig,
      searchConfig: data.searchConfig,
    };
  } catch (err) {
    if (err instanceof SecurityValidationError) throw err;
    throw new SecurityValidationError(403, 'Unable to decrypt credential vault for this Google account.');
  }
}

// --- 5. Firebase Auth ID Token Verification (RS256 via Google Public x509 Certs) ---

const SECURE_TOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedProjectId: string | null = null;
export function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
  if (!parsed.projectId) {
    throw new Error('Missing projectId in firebase-applet-config.json');
  }
  cachedProjectId = parsed.projectId;
  return cachedProjectId;
}

export function getFirebaseAppletConfig(): { projectId: string; firestoreDatabaseId: string } {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    projectId?: string;
    firestoreDatabaseId?: string;
  };
  if (!parsed.projectId) {
    throw new Error('Missing projectId in firebase-applet-config.json');
  }
  return {
    projectId: parsed.projectId,
    firestoreDatabaseId: parsed.firestoreDatabaseId || '(default)',
  };
}

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function fetchGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) {
    return certCache.certs;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(SECURE_TOKEN_CERTS_URL, {
      redirect: 'error',
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Failed to fetch Firebase public certificates (${resp.status}).`);
    }
    const certs = (await resp.json()) as Record<string, string>;
    const cc = resp.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const maxAgeSec = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]), 86400) : 3600;
    certCache = {
      certs,
      expiresAt: Date.now() + Math.max(60, maxAgeSec) * 1000,
    };
    return certs;
  } finally {
    clearTimeout(timeout);
  }
}

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  idToken: string;
}

export interface AuthenticatedRequest extends ExpressRequest {
  authUser?: VerifiedFirebaseUser;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

export async function verifyFirebaseJwtString(
  token: string,
  options?: {
    expectedProjectId?: string;
    certsOverride?: Record<string, string>;
    nowSeconds?: number;
  },
): Promise<VerifiedFirebaseUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new SecurityValidationError(401, 'Invalid authentication token format.');
  }
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(encodedHeader);
  if (header.alg !== 'RS256' || !header.kid) {
    throw new SecurityValidationError(401, 'Unsupported authentication token algorithm.');
  }

  const certs = options?.certsOverride || (await fetchGoogleSecureTokenCerts());
  const pem = certs[header.kid];
  if (!pem) {
    if (!options?.certsOverride) {
      certCache = null;
      const fresh = await fetchGoogleSecureTokenCerts();
      if (!fresh[header.kid]) {
        throw new SecurityValidationError(401, 'Signing certificate not recognized.');
      }
      return verifyWithCert(token, encodedHeader, encodedPayload, encodedSig, fresh[header.kid], options);
    }
    throw new SecurityValidationError(401, 'Signing certificate not recognized.');
  }

  return verifyWithCert(token, encodedHeader, encodedPayload, encodedSig, pem, options);
}

function verifyWithCert(
  rawToken: string,
  encodedHeader: string,
  encodedPayload: string,
  encodedSig: string,
  pem: string,
  options?: { expectedProjectId?: string; nowSeconds?: number },
): VerifiedFirebaseUser {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const signature = decodeBase64UrlBuffer(encodedSig);
  const publicKey = crypto.createPublicKey(pem);
  const isValid = verifier.verify(publicKey, signature);
  if (!isValid) {
    throw new SecurityValidationError(401, 'Authentication signature verification failed.');
  }

  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
  }>(encodedPayload);

  const projectId = options?.expectedProjectId || getFirebaseProjectId();
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new SecurityValidationError(401, 'Authentication token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new SecurityValidationError(401, 'Authentication token issuer mismatch.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new SecurityValidationError(401, 'Authentication token missing subject.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new SecurityValidationError(401, 'Authentication session expired. Please sign in again.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) {
    throw new SecurityValidationError(401, 'Authentication token issued-at time is invalid.');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > now + 300) {
    throw new SecurityValidationError(401, 'Authentication auth_time is invalid.');
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: Boolean(payload.email_verified),
    idToken: rawToken,
  };
}

export async function verifyFirebaseAuthHeader(
  authHeader?: string,
  options?: {
    expectedProjectId?: string;
    certsOverride?: Record<string, string>;
    nowSeconds?: number;
  },
): Promise<VerifiedFirebaseUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new SecurityValidationError(401, 'Sign in with Google is required for this action.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new SecurityValidationError(401, 'Missing authentication token.');
  }
  return verifyFirebaseJwtString(token, options);
}

export function createFirebaseAuthMiddleware(options?: {
  requireVerifiedEmail?: boolean;
  verifyHeaderFn?: (header?: string) => Promise<VerifiedFirebaseUser>;
}) {
  const verifyFn = options?.verifyHeaderFn || verifyFirebaseAuthHeader;
  const requireEmailVerified = options?.requireVerifiedEmail !== false;

  return async (req: AuthenticatedRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const authUser = await verifyFn(req.headers.authorization);
      if (requireEmailVerified && !authUser.emailVerified) {
        res.status(403).json({
          error: 'A verified Google account email is required for this action.',
        });
        return;
      }
      req.authUser = authUser;
      next();
    } catch (err) {
      const status = err instanceof SecurityValidationError ? err.status : 401;
      res.status(status).json({ error: sanitizeErrorMessage(err) || 'Authentication required.' });
    }
  };
}
