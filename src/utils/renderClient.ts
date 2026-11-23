/**
 * Official Render REST API Client for Mist
 *
 * Implements real "Connect to Render" static-site service provisioning,
 * deployment status tracking, credential verification, and workspace discovery.
 *
 * API Reference: https://api.render.com/v1
 * Authentication: Authorization: Bearer rnd_...
 */

import { SecurityValidationError, sanitizeErrorMessage } from './serverSecurity';

export interface RenderOwner {
  id: string;
  name: string;
  email?: string;
  type: 'user' | 'team';
}

export interface RenderVerificationResult {
  primaryOwner: RenderOwner;
  owners: RenderOwner[];
}

export interface RenderCreateStaticSiteParams {
  name: string;
  ownerId: string;
  repo: string;
  branch?: string;
  buildCommand?: string;
  publishPath?: string;
  autoDeploy?: 'commit' | 'checksPass' | 'off';
}

export interface RenderServiceSummary {
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
  serviceDetails?: {
    buildCommand?: string;
    publishPath?: string;
    url?: string;
  };
}

export interface RenderDeploySummary {
  id: string;
  status: 'created' | 'build_in_progress' | 'live' | 'build_failed' | 'canceled' | 'deactivated';
  finishedAt?: string;
  createdAt: string;
  commit?: { id?: string; message?: string };
}

const RENDER_API_BASE = 'https://api.render.com/v1';

/**
 * Validates a user-supplied Render API key.
 * Render API keys start with rnd_ and are 32-128 alphanumeric characters.
 */
export function validateRenderApiKey(rawKey: unknown): string {
  if (typeof rawKey !== 'string') {
    throw new SecurityValidationError(400, 'Render API key must be a string.', 'INVALID_RENDER_KEY');
  }
  const trimmed = rawKey.trim();
  if (!trimmed) {
    throw new SecurityValidationError(400, 'Render API key cannot be empty.', 'INVALID_RENDER_KEY');
  }
  if (trimmed.length < 20 || trimmed.length > 128) {
    throw new SecurityValidationError(
      400,
      'Invalid Render API key length (expected 20-128 characters).',
      'INVALID_RENDER_KEY',
    );
  }
  if (!/^rnd_[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new SecurityValidationError(
      400,
      "Invalid Render API key format. Render API keys start with 'rnd_' followed by alphanumeric characters.",
      'INVALID_RENDER_KEY',
    );
  }
  return trimmed;
}

/**
 * Validates a GitHub repository URL.
 * Accepts: https://github.com/owner/repo or https://github.com/owner/repo.git
 */
export function validateGitHubRepoUrl(rawRepo: unknown): { url: string; owner: string; repo: string } {
  if (typeof rawRepo !== 'string') {
    throw new SecurityValidationError(400, 'GitHub repository URL must be a string.', 'INVALID_REPO_URL');
  }
  const trimmed = rawRepo.trim();
  if (!trimmed) {
    throw new SecurityValidationError(400, 'GitHub repository URL cannot be empty.', 'INVALID_REPO_URL');
  }

  // Must match standard GitHub HTTPS repo URL pattern
  const match = trimmed.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git|\/)?$/);
  if (!match) {
    throw new SecurityValidationError(
      400,
      'Invalid GitHub repository URL. Must be in the format: https://github.com/username/repository',
      'INVALID_REPO_URL',
    );
  }

  const owner = match[1]!;
  const repo = match[2]!;
  const canonicalUrl = `https://github.com/${owner}/${repo}`;

  return { url: canonicalUrl, owner, repo };
}

/**
 * Normalizes and validates a Render service name.
 * Render requires service names to be 3-63 lowercase alphanumeric characters or hyphens.
 */
export function validateRenderServiceName(rawName: unknown): string {
  if (typeof rawName !== 'string') {
    throw new SecurityValidationError(400, 'Service name must be a string.', 'INVALID_SERVICE_NAME');
  }
  const cleaned = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (cleaned.length < 3 || cleaned.length > 63) {
    throw new SecurityValidationError(
      400,
      'Service name must be between 3 and 63 alphanumeric characters or hyphens.',
      'INVALID_SERVICE_NAME',
    );
  }
  if (cleaned.includes('--')) {
    throw new SecurityValidationError(400, 'Service name cannot contain consecutive hyphens.', 'INVALID_SERVICE_NAME');
  }
  return cleaned;
}

/**
 * Helper to normalize owners from Render API responses.
 * Render /v1/owners returns an array of items where each item is either
 * `{ owner: { id, name, email, type } }` or directly `{ id, name, email, type }`.
 */
function parseOwnersResponse(raw: unknown): RenderOwner[] {
  if (!Array.isArray(raw)) return [];
  const list: RenderOwner[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = (item as any).owner || item;
    if (o && typeof o.id === 'string' && typeof o.name === 'string') {
      list.push({
        id: String(o.id).trim(),
        name: String(o.name).trim(),
        email: typeof o.email === 'string' ? o.email.trim() : undefined,
        type: o.type === 'team' ? 'team' : 'user',
      });
    }
  }

  return list;
}

/**
 * Verifies a Render API key against the official Render API (GET /v1/owners).
 */
export async function verifyRenderApiKey(
  apiKey: string,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<RenderVerificationResult> {
  const fetchFn = options?.fetchImpl || globalThis.fetch;
  const validatedKey = validateRenderApiKey(apiKey);

  let response: Response;
  try {
    response = await fetchFn(`${RENDER_API_BASE}/owners?limit=20`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${validatedKey}`,
      },
      signal: options?.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new SecurityValidationError(499, 'Render verification request was canceled.', 'REQUEST_CANCELED');
    }
    throw new SecurityValidationError(
      502,
      `Unable to reach Render API: ${sanitizeErrorMessage(err)}`,
      'RENDER_NETWORK_ERROR',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new SecurityValidationError(
      401,
      'Invalid, expired, or unauthorized Render API key. Please generate a new API key from your Render account settings.',
      'RENDER_AUTH_FAILED',
    );
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || '60';
    throw new SecurityValidationError(
      429,
      `Render API rate limit exceeded. Please wait ${retryAfter}s and try again.`,
      'RENDER_RATE_LIMITED',
    );
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = (errJson as any)?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = response.statusText;
    }
    throw new SecurityValidationError(
      response.status,
      `Render API verification error (${response.status}): ${errorDetail}`,
      'RENDER_API_ERROR',
    );
  }

  const rawJson = await response.json();
  const owners = parseOwnersResponse(rawJson);

  if (owners.length === 0) {
    throw new SecurityValidationError(
      400,
      'Render API key is valid, but no workspaces or owners were found for this account.',
      'NO_WORKSPACES_FOUND',
    );
  }

  return {
    primaryOwner: owners[0]!,
    owners,
  };
}

/**
 * Creates a static site service on Render using the official Render REST API.
 */
export async function createRenderStaticSite(
  apiKey: string,
  params: RenderCreateStaticSiteParams,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<RenderServiceSummary> {
  const fetchFn = options?.fetchImpl || globalThis.fetch;
  const validatedKey = validateRenderApiKey(apiKey);
  const validatedRepo = validateGitHubRepoUrl(params.repo);
  const validatedName = validateRenderServiceName(params.name);

  if (!params.ownerId || typeof params.ownerId !== 'string') {
    throw new SecurityValidationError(400, 'Render ownerId / workspace ID is required.', 'INVALID_OWNER_ID');
  }

  const requestBody = {
    type: 'static_site',
    name: validatedName,
    ownerId: params.ownerId.trim(),
    repo: validatedRepo.url,
    branch: (params.branch || 'main').trim(),
    autoDeployTrigger: params.autoDeploy || 'commit',
    serviceDetails: {
      buildCommand: (params.buildCommand || 'npm run build').trim(),
      publishPath: (params.publishPath || 'dist').trim(),
    },
  };

  let response: Response;
  try {
    response = await fetchFn(`${RENDER_API_BASE}/services`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validatedKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new SecurityValidationError(499, 'Render deploy request was canceled.', 'REQUEST_CANCELED');
    }
    throw new SecurityValidationError(
      502,
      `Unable to reach Render API: ${sanitizeErrorMessage(err)}`,
      'RENDER_NETWORK_ERROR',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new SecurityValidationError(
      401,
      'Render API key is invalid or revoked.',
      'RENDER_AUTH_FAILED',
    );
  }

  if (response.status === 429) {
    throw new SecurityValidationError(
      429,
      'Render API rate limit exceeded. Please try again shortly.',
      'RENDER_RATE_LIMITED',
    );
  }

  if (!response.ok) {
    let errorMsg = '';
    try {
      const errJson = await response.json();
      errorMsg = (errJson as any)?.message || JSON.stringify(errJson);
    } catch {
      errorMsg = response.statusText;
    }

    // Identify GitHub permission / access issues
    const lower = errorMsg.toLowerCase();
    if (
      lower.includes('repository not found') ||
      lower.includes('access denied') ||
      lower.includes('not have permission') ||
      lower.includes('unable to access') ||
      lower.includes('repo')
    ) {
      throw new SecurityValidationError(
        400,
        `Render could not access the GitHub repository "${validatedRepo.url}". If the repository is private, please ensure the Render GitHub App (https://github.com/apps/render/installations/new) is installed and granted access to this repository in your Render account.`,
        'GITHUB_REPO_UNAVAILABLE',
      );
    }

    if (lower.includes('already exists') || lower.includes('taken')) {
      throw new SecurityValidationError(
        400,
        `A Render service named "${validatedName}" already exists in your workspace. Please choose a different service name.`,
        'SERVICE_NAME_CONFLICT',
      );
    }

    throw new SecurityValidationError(
      response.status,
      `Failed to create Render static site: ${errorMsg}`,
      'RENDER_SERVICE_CREATION_FAILED',
    );
  }

  const s = (await response.json()) as any;
  const service = s.service || s;
  const serviceId = service.id || 'unknown';
  const serviceUrl =
    service.serviceDetails?.url ||
    service.url ||
    `https://${validatedName}.onrender.com`;

  return {
    id: serviceId,
    name: service.name || validatedName,
    ownerId: service.ownerId || params.ownerId,
    repo: service.repo || validatedRepo.url,
    branch: service.branch || params.branch || 'main',
    url: serviceUrl,
    dashboardUrl: `https://dashboard.render.com/static/${serviceId}`,
    status: service.status || 'created',
    createdAt: service.createdAt || new Date().toISOString(),
    updatedAt: service.updatedAt || new Date().toISOString(),
    serviceDetails: service.serviceDetails,
  };
}

/**
 * Retrieves details for a specific Render service.
 */
export async function getRenderService(
  apiKey: string,
  serviceId: string,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<RenderServiceSummary> {
  const fetchFn = options?.fetchImpl || globalThis.fetch;
  const validatedKey = validateRenderApiKey(apiKey);
  const cleanId = (serviceId || '').trim();
  if (!cleanId) {
    throw new SecurityValidationError(400, 'Service ID is required.');
  }

  const response = await fetchFn(`${RENDER_API_BASE}/services/${cleanId}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${validatedKey}`,
    },
    signal: options?.signal,
  });

  if (response.status === 404) {
    throw new SecurityValidationError(404, `Render service '${cleanId}' was not found.`, 'SERVICE_NOT_FOUND');
  }

  if (!response.ok) {
    throw new SecurityValidationError(response.status, `Failed to load Render service: ${response.statusText}`);
  }

  const s = (await response.json()) as any;
  const service = s.service || s;
  return {
    id: service.id,
    name: service.name,
    ownerId: service.ownerId,
    repo: service.repo,
    branch: service.branch,
    url: service.serviceDetails?.url || service.url || `https://${service.name}.onrender.com`,
    dashboardUrl: `https://dashboard.render.com/static/${service.id}`,
    status: service.status,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    serviceDetails: service.serviceDetails,
  };
}

/**
 * Retrieves the latest deployment status for a Render service.
 */
export async function getRenderLatestDeploy(
  apiKey: string,
  serviceId: string,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<RenderDeploySummary | null> {
  const fetchFn = options?.fetchImpl || globalThis.fetch;
  const validatedKey = validateRenderApiKey(apiKey);
  const cleanId = (serviceId || '').trim();
  if (!cleanId) {
    throw new SecurityValidationError(400, 'Service ID is required.');
  }

  const response = await fetchFn(`${RENDER_API_BASE}/services/${cleanId}/deploys?limit=1`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${validatedKey}`,
    },
    signal: options?.signal,
  });

  if (!response.ok) return null;

  const data = (await response.json()) as any;
  const deploys = Array.isArray(data) ? data : data.deploys || [];
  if (deploys.length === 0) return null;

  const raw = deploys[0].deploy || deploys[0];
  return {
    id: raw.id,
    status: raw.status || 'created',
    createdAt: raw.createdAt,
    finishedAt: raw.finishedAt,
    commit: raw.commit,
  };
}

/**
 * Triggers a manual deployment for an existing Render service.
 */
export async function triggerRenderDeploy(
  apiKey: string,
  serviceId: string,
  options?: { clearCache?: boolean; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<{ id: string; status: string }> {
  const fetchFn = options?.fetchImpl || globalThis.fetch;
  const validatedKey = validateRenderApiKey(apiKey);
  const cleanId = (serviceId || '').trim();
  if (!cleanId) {
    throw new SecurityValidationError(400, 'Service ID is required.');
  }

  const response = await fetchFn(`${RENDER_API_BASE}/services/${cleanId}/deploys`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validatedKey}`,
    },
    body: JSON.stringify({
      clearCache: options?.clearCache ? 'clear' : 'do_not_clear',
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new SecurityValidationError(response.status, `Failed to trigger Render deploy: ${response.statusText}`);
  }

  const d = (await response.json()) as any;
  const dep = d.deploy || d;
  return {
    id: dep.id,
    status: dep.status || 'created',
  };
}

/**
 * Lists static site services in the user's Render workspace.
 */
export async function listRenderStaticSites(
  apiKey: string,
  options?: { ownerId?: string; limit?: number; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<RenderServiceSummary[]> {
  const fetchFn = options?.fetchImpl || globalThis.fetch;
  const validatedKey = validateRenderApiKey(apiKey);
  const limit = options?.limit || 20;

  let url = `${RENDER_API_BASE}/services?type=static_site&limit=${limit}`;
  if (options?.ownerId) {
    url += `&ownerId=${encodeURIComponent(options.ownerId)}`;
  }

  const response = await fetchFn(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${validatedKey}`,
    },
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new SecurityValidationError(response.status, `Failed to list Render services: ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  const services = Array.isArray(data) ? data : data.services || [];

  return services.map((s: any) => {
    const item = s.service || s;
    return {
      id: item.id,
      name: item.name,
      ownerId: item.ownerId,
      repo: item.repo,
      branch: item.branch,
      url: item.serviceDetails?.url || item.url || `https://${item.name}.onrender.com`,
      dashboardUrl: `https://dashboard.render.com/static/${item.id}`,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      serviceDetails: item.serviceDetails,
    };
  });
}
