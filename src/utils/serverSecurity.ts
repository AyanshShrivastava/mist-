import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { AiProviderConfig } from '../types/mist';
import { redactSecrets } from './aiErrors';

// --- 1. SSRF Protection & URL Validation ---

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
    host.endsWith('.localhost')
  ) {
    throw new SecurityValidationError(400, 'Blocked internal or loopback host.');
  }

  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new SecurityValidationError(400, 'Private, link-local, and metadata IP addresses are blocked.');
  }

  return parsed;
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options?: { skipDnsLookup?: boolean },
): Promise<URL> {
  const parsed = validateExternalUrlSyntax(rawUrl);
  const host = parsed.hostname.toLowerCase();

  if (!options?.skipDnsLookup && !net.isIP(host)) {
    try {
      const resolved = await dns.lookup(host, { all: true, verbatim: true });
      if (resolved.length === 0) {
        throw new SecurityValidationError(400, `Unable to resolve host "${host}".`);
      }
      for (const entry of resolved) {
        if (isPrivateOrReservedIp(entry.address)) {
          throw new SecurityValidationError(400, `Host "${host}" resolved to a restricted private IP address.`);
        }
      }
    } catch (err) {
      if (err instanceof SecurityValidationError) throw err;
      throw new SecurityValidationError(400, `DNS resolution failed for "${host}".`);
    }
  }

  return parsed;
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  return redactSecrets(raw);
}

// --- 2. Sliding-Window Rate Limiter ---

interface RateBucket {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  label: string;
}) {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : '') ||
      req.ip ||
      'unknown';

    const now = Date.now();
    const cutoff = now - options.windowMs;
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(ip, bucket);
    }

    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= options.maxRequests) {
      const oldest = bucket.timestamps[0] || now;
      const retrySeconds = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      res.status(429).json({
        error: `Too many ${options.label} requests. Please wait ${retrySeconds}s and try again.`,
      });
      return;
    }

    bucket.timestamps.push(now);

    if (buckets.size > 2000) {
      for (const [k, b] of buckets.entries()) {
        if (b.timestamps.every((t) => t <= cutoff)) {
          buckets.delete(k);
        }
      }
    }

    next();
  };
}

// --- 3. Ephemeral Scoped Preview AI Session Vault ---

interface PreviewSessionRecord {
  config: AiProviderConfig;
  expiresAt: number;
  createdAt: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;
const previewSessions = new Map<string, PreviewSessionRecord>();

export function createPreviewAiSession(config: AiProviderConfig): {
  token: string;
  expiresAt: string;
} {
  const now = Date.now();
  // Prune expired sessions
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

export function revokePreviewAiSession(token?: string): boolean {
  if (!token) return false;
  return previewSessions.delete(token);
}

// --- 4. Firebase Auth ID Token Verification (RS256 via Google Public x509 Certs) ---

const SECURE_TOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedProjectId: string | null = null;
function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
  if (!parsed.projectId) {
    throw new Error('Missing projectId in firebase-applet-config.json');
  }
  cachedProjectId = parsed.projectId;
  return cachedProjectId;
}

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function fetchGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) {
    return certCache.certs;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(SECURE_TOKEN_CERTS_URL, { signal: controller.signal });
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
    // Force refresh once in case of key rotation
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
  _token: string,
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
  };
}

export async function verifyFirebaseAuthHeader(
  authHeader?: string,
): Promise<VerifiedFirebaseUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new SecurityValidationError(401, 'Sign in with Google is required for this action.');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new SecurityValidationError(401, 'Missing authentication token.');
  }
  return verifyFirebaseJwtString(token);
}
