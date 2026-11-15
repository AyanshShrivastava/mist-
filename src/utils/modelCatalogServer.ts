import crypto from 'node:crypto';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  type CustomGatewayId,
  type ModelCatalogItem,
} from '../data/models';
import { assertSafeExternalUrl } from './serverSecurity';

export interface ServerCatalogResult {
  gateway: CustomGatewayId;
  source: 'live' | 'preset';
  fetchedAt: string;
  models: ModelCatalogItem[];
  note?: string;
}

const CATALOG_TTL_MS = 10 * 60 * 1000;
const serverCatalogCache = new Map<string, { expiresAt: number; result: ServerCatalogResult }>();

function formatPerMillionUsd(perTokenRaw?: string | number): string | null {
  if (perTokenRaw === undefined || perTokenRaw === null || perTokenRaw === '') return null;
  const num = Number(perTokenRaw);
  if (!Number.isFinite(num) || num < 0) return null;
  if (num === 0) return '$0';
  const perMillion = num * 1_000_000;
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/1M`;
  if (perMillion < 1) return `$${perMillion.toFixed(3)}/1M`;
  return `$${perMillion.toFixed(2)}/1M`;
}

function inferTierFromId(id: string): ModelCatalogItem['tier'] {
  const lower = id.toLowerCase();
  if (lower.includes('coder') || lower.includes('codestral') || lower.includes('devstral')) {
    return 'Coding';
  }
  if (
    lower.includes('r1') ||
    lower.includes('thinking') ||
    lower.includes('reason') ||
    lower.includes('o3') ||
    lower.includes('o4') ||
    lower.includes('qwq')
  ) {
    return 'Reasoning';
  }
  if (
    lower.includes('nano') ||
    lower.includes('mini') ||
    lower.includes('instant') ||
    lower.includes('lite') ||
    lower.includes('8b') ||
    lower.includes('flash') ||
    lower.includes('scout')
  ) {
    return 'Fast';
  }
  if (
    lower.includes('pro') ||
    lower.includes('sonnet') ||
    lower.includes('opus') ||
    lower.includes('235b') ||
    lower.includes('405b') ||
    lower.includes('maverick') ||
    lower.includes('ultra')
  ) {
    return 'Pro';
  }
  return 'Default';
}

export interface OpenRouterRawModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
}

export function mapOpenRouterModels(rawList: OpenRouterRawModel[]): ModelCatalogItem[] {
  const mapped: ModelCatalogItem[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
    const id = item.id.trim();
    if (seen.has(id)) continue;

    // Only keep chat/code text-output models for Mist builder UI
    const outputs = item.architecture?.output_modalities;
    const modality = item.architecture?.modality || '';
    if (Array.isArray(outputs) && outputs.length > 0 && !outputs.includes('text')) {
      continue;
    }
    if (modality && modality.includes('->') && !modality.includes('->text')) {
      continue;
    }

    seen.add(id);
    const promptCost = Number(item.pricing?.prompt ?? NaN);
    const completionCost = Number(item.pricing?.completion ?? NaN);
    const isZeroPricing =
      Number.isFinite(promptCost) &&
      Number.isFinite(completionCost) &&
      promptCost === 0 &&
      completionCost === 0;
    const isFree = id === 'openrouter/free' || id.endsWith(':free') || isZeroPricing;

    const inStr = formatPerMillionUsd(item.pricing?.prompt);
    const outStr = formatPerMillionUsd(item.pricing?.completion);
    const pricingSummary = isFree
      ? '$0 / Free'
      : inStr && outStr
        ? `${inStr} in · ${outStr} out`
        : 'Paid per token';

    const ctxLabel = item.context_length
      ? `${Math.round(item.context_length / 1000)}k ctx`
      : '';

    const cleanLabel = (item.name || id)
      .replace(/\s*\(free\)\s*$/i, '')
      .trim();

    mapped.push({
      id,
      label: isFree && id.endsWith(':free') && !cleanLabel.includes(':free')
        ? `${cleanLabel} (:free)`
        : cleanLabel,
      summary: [isFree ? 'Free' : 'Paid', pricingSummary !== '$0 / Free' ? pricingSummary : '', ctxLabel]
        .filter(Boolean)
        .join(' · '),
      tier: inferTierFromId(id),
      billing: isFree ? 'free' : 'paid',
      billingLabel: isFree ? 'Free' : 'Paid',
      contextLength: item.context_length,
      pricingSummary,
      isLiveFetched: true,
      modality: modality || undefined,
    });
  }

  // Ensure openrouter/free auto-router exists at top if omitted
  if (!seen.has('openrouter/free')) {
    const presetAuto = CUSTOM_GATEWAY_PRESETS[0].models.find((m) => m.id === 'openrouter/free');
    if (presetAuto) {
      mapped.unshift({ ...presetAuto, isLiveFetched: true });
    }
  }

  const priorityVendors = ['openrouter/free', 'nvidia/', 'deepseek/', 'qwen/', 'meta-llama/', 'google/', 'anthropic/', 'openai/'];
  mapped.sort((a, b) => {
    if (a.id === 'openrouter/free') return -1;
    if (b.id === 'openrouter/free') return 1;
    if (a.billing !== b.billing) return a.billing === 'free' ? -1 : 1;
    const aPri = priorityVendors.findIndex((p) => a.id.startsWith(p));
    const bPri = priorityVendors.findIndex((p) => b.id.startsWith(p));
    const aScore = aPri === -1 ? 99 : aPri;
    const bScore = bPri === -1 ? 99 : bPri;
    if (aScore !== bScore) return aScore - bScore;
    return a.label.localeCompare(b.label);
  });

  return mapped;
}

export interface OpenAiCompatRawModel {
  id: string;
  active?: boolean;
  owned_by?: string;
  context_window?: number;
}

const GROQ_FREE_TIER_PATTERNS = [
  /^llama-3\.3-70b/i,
  /^llama-3\.1-8b/i,
  /^meta-llama\/llama-4-/i,
  /^qwen\/qwen3-32b/i,
  /^openai\/gpt-oss-/i,
  /^groq\/compound/i,
  /^deepseek-r1-distill-/i,
  /^gemma2-/i,
  /^allam-/i,
];

const GROQ_NON_CHAT_PATTERNS = [
  /whisper/i,
  /tts/i,
  /orpheus/i,
  /prompt-guard/i,
  /llama-guard/i,
  /safeguard/i,
];

export function mapGroqModels(rawList: OpenAiCompatRawModel[]): ModelCatalogItem[] {
  const groqPreset = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === 'groq');
  const presetMap = new Map(groqPreset?.models.map((m) => [m.id, m]) || []);

  const mapped: ModelCatalogItem[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
    if (item.active === false) continue;
    const id = item.id.trim();
    if (seen.has(id)) continue;
    if (GROQ_NON_CHAT_PATTERNS.some((rx) => rx.test(id))) continue;

    seen.add(id);
    const presetMatch = presetMap.get(id);
    const isKnownFreeTier = GROQ_FREE_TIER_PATTERNS.some((rx) => rx.test(id));
    const billing = presetMatch ? presetMatch.billing : isKnownFreeTier ? 'free' : 'paid';
    const billingLabel = presetMatch
      ? presetMatch.billingLabel
      : billing === 'free'
        ? 'Free Tier'
        : 'Paid';
    const ctx = item.context_window || presetMatch?.contextLength;

    mapped.push({
      id,
      label: presetMatch?.label || id,
      summary:
        presetMatch?.summary ||
        `${billing === 'free' ? 'Free Tier (rate-limited) / Paid' : 'Developer / Paid tier'}${ctx ? ` · ${Math.round(ctx / 1000)}k ctx` : ''}`,
      tier: presetMatch?.tier || inferTierFromId(id),
      billing,
      billingLabel,
      contextLength: ctx,
      isLiveFetched: true,
    });
  }

  mapped.sort((a, b) => {
    if (a.billing !== b.billing) return a.billing === 'free' ? -1 : 1;
    const aKnown = presetMap.has(a.id) ? 0 : 1;
    const bKnown = presetMap.has(b.id) ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.label.localeCompare(b.label);
  });

  return mapped;
}

export interface GeminiRawModel {
  id?: string;
  name?: string;
  displayName?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export function mapGeminiModels(rawList: GeminiRawModel[]): ModelCatalogItem[] {
  const geminiPreset = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === 'gemini_byok');
  const presetMap = new Map(geminiPreset?.models.map((m) => [m.id, m]) || []);

  const mapped: ModelCatalogItem[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    const rawId = item.id || item.name || '';
    const id = rawId.replace(/^models\//, '').trim();
    if (!id || seen.has(id)) continue;
    const lower = id.toLowerCase();
    if (!lower.includes('gemini')) continue;
    if (
      lower.includes('embedding') ||
      lower.includes('imagen') ||
      lower.includes('veo') ||
      lower.includes('aqa') ||
      lower.includes('tts') ||
      lower.includes('native-audio') ||
      lower.includes('robotics') ||
      lower.includes('computer-use')
    ) {
      continue;
    }
    if (
      Array.isArray(item.supportedGenerationMethods) &&
      !item.supportedGenerationMethods.includes('generateContent')
    ) {
      continue;
    }

    seen.add(id);
    const preset = presetMap.get(id);
    const isPaidOnly =
      lower.includes('pro') || lower.includes('ultra') || lower.includes('deep-research');
    const billing = preset?.billing || (isPaidOnly ? 'paid' : 'free');
    const billingLabel = preset?.billingLabel || (billing === 'free' ? 'Free Tier' : 'Paid');
    const ctx = item.inputTokenLimit || preset?.contextLength;

    mapped.push({
      id,
      label: preset?.label || item.displayName || id,
      summary:
        preset?.summary ||
        `${billing === 'free' ? 'Free Tier (AI Studio) / Paid' : 'Paid / Limited Free'}${ctx ? ` · ${Math.round(ctx / 1000)}k ctx` : ''}`,
      tier: preset?.tier || inferTierFromId(id),
      billing,
      billingLabel,
      contextLength: ctx,
      isLiveFetched: true,
    });
  }

  mapped.sort((a, b) => {
    if (a.billing !== b.billing) return a.billing === 'free' ? -1 : 1;
    const a25 = a.id.includes('2.5') ? 0 : 1;
    const b25 = b.id.includes('2.5') ? 0 : 1;
    if (a25 !== b25) return a25 - b25;
    return a.id.localeCompare(b.id);
  });

  return mapped;
}

export async function fetchGatewayModelsCatalog(params: {
  baseUrl: string;
  apiKey?: string;
  forceRefresh?: boolean;
}): Promise<ServerCatalogResult> {
  const cleanBase = (params.baseUrl || '').trim().replace(/\/+$/, '');
  const cleanKey = (params.apiKey || '').trim();
  const gateway = detectGatewayFromBaseUrl(cleanBase);
  const preset = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === gateway) || CUSTOM_GATEWAY_PRESETS[5];

  await assertSafeExternalUrl(cleanBase);

  const keyHash = cleanKey
    ? crypto.createHash('sha256').update(cleanKey).digest('hex').slice(0, 12)
    : 'anon';
  const cacheKey = `${cleanBase}|${keyHash}`;

  if (!params.forceRefresh) {
    const cached = serverCatalogCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    if (gateway === 'openrouter') {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (cleanKey) headers.Authorization = `Bearer ${cleanKey}`;
      const resp = await fetch('https://openrouter.ai/api/v1/models', {
        headers,
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`OpenRouter models catalog returned HTTP ${resp.status}.`);
      }
      const json = (await resp.json()) as { data?: OpenRouterRawModel[] };
      const mapped = Array.isArray(json.data) ? mapOpenRouterModels(json.data) : preset.models;
      const result: ServerCatalogResult = {
        gateway,
        source: 'live',
        fetchedAt,
        models: mapped.length > 0 ? mapped : preset.models,
      };
      serverCatalogCache.set(cacheKey, { expiresAt: Date.now() + CATALOG_TTL_MS, result });
      return result;
    }

    if (gateway === 'groq') {
      if (!cleanKey) {
        return {
          gateway,
          source: 'preset',
          fetchedAt,
          models: preset.models,
          note: 'Showing verified Groq presets. Add your gsk_ API key to load your live account model list.',
        };
      }
      const resp = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${cleanKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`Groq models catalog returned HTTP ${resp.status}.`);
      }
      const json = (await resp.json()) as { data?: OpenAiCompatRawModel[] };
      const mapped = Array.isArray(json.data) ? mapGroqModels(json.data) : preset.models;
      const result: ServerCatalogResult = {
        gateway,
        source: mapped.length > 0 ? 'live' : 'preset',
        fetchedAt,
        models: mapped.length > 0 ? mapped : preset.models,
      };
      serverCatalogCache.set(cacheKey, { expiresAt: Date.now() + CATALOG_TTL_MS, result });
      return result;
    }

    if (gateway === 'gemini_byok') {
      if (!cleanKey) {
        return {
          gateway,
          source: 'preset',
          fetchedAt,
          models: preset.models,
          note: 'Showing verified Gemini BYOK presets. Add your AIza... key to fetch live Gemini models.',
        };
      }
      const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: {
          'x-goog-api-key': cleanKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`Gemini models catalog returned HTTP ${resp.status}.`);
      }
      const json = (await resp.json()) as { models?: GeminiRawModel[] };
      const mapped = Array.isArray(json.models) ? mapGeminiModels(json.models) : preset.models;
      const result: ServerCatalogResult = {
        gateway,
        source: mapped.length > 0 ? 'live' : 'preset',
        fetchedAt,
        models: mapped.length > 0 ? mapped : preset.models,
      };
      serverCatalogCache.set(cacheKey, { expiresAt: Date.now() + CATALOG_TTL_MS, result });
      return result;
    }

    // Generic OpenAI-compatible gateway (NVIDIA, OpenAI, Custom URL)
    if (!cleanKey) {
      return {
        gateway,
        source: 'preset',
        fetchedAt,
        models: preset.models,
        note: 'Showing preset catalog. Add your API key to query this endpoint live.',
      };
    }

    const modelsEndpoint = cleanBase.endsWith('/chat/completions')
      ? cleanBase.replace(/\/chat\/completions$/, '/models')
      : `${cleanBase}/models`;
    const resp = await fetch(modelsEndpoint, {
      headers: {
        Authorization: `Bearer ${cleanKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      return {
        gateway,
        source: 'preset',
        fetchedAt,
        models: preset.models,
        note: `Endpoint /models returned ${resp.status}; showing preset models.`,
      };
    }

    const json = (await resp.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    const presetMap = new Map(preset.models.map((m) => [m.id, m]));
    const liveList: ModelCatalogItem[] = [];
    const seen = new Set<string>();
    for (const item of json.data || []) {
      const id = String(item.id || '').trim();
      if (!id || seen.has(id)) continue;
      if (gateway === 'openai' && !/^(gpt-|o1|o3|o4|chatgpt-)/i.test(id)) continue;
      seen.add(id);
      const match = presetMap.get(id);
      liveList.push({
        id,
        label: match?.label || id,
        summary: match?.summary || `Live model from ${preset.name}`,
        tier: match?.tier || inferTierFromId(id),
        billing: match?.billing || (gateway === 'openai' ? 'paid' : 'free'),
        billingLabel: match?.billingLabel || (gateway === 'openai' ? 'Paid' : 'API'),
        isLiveFetched: true,
      });
    }

    const result: ServerCatalogResult = {
      gateway,
      source: liveList.length > 0 ? 'live' : 'preset',
      fetchedAt,
      models: liveList.length > 0 ? liveList : preset.models,
    };
    serverCatalogCache.set(cacheKey, { expiresAt: Date.now() + CATALOG_TTL_MS, result });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
