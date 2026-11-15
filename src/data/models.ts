import type { AiProviderConfig, AiProviderId, AppAiMode, ModelBilling } from '../types/mist';

export interface ModelCatalogItem {
  id: string;
  label: string;
  summary: string;
  tier: 'Default' | 'Fast' | 'Reasoning' | 'Pro' | 'Coding';
  billing: ModelBilling;
  billingLabel: string;
  contextLength?: number;
  pricingSummary?: string;
  isLiveFetched?: boolean;
  modality?: string;
}

export type CustomGatewayId = 'openrouter' | 'groq' | 'gemini_byok' | 'nvidia' | 'openai' | 'custom_url';

export interface CustomGatewayPreset {
  id: CustomGatewayId;
  name: string;
  baseUrl: string;
  portalLabel?: string;
  portalUrl?: string;
  placeholder: string;
  steps?: string[];
  models: ModelCatalogItem[];
}

export const DEFAULT_BYOK_CONFIG: AiProviderConfig = {
  provider: 'custom',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
  apiKey: '',
  sessionOnlyKey: false,
};

export const CUSTOM_GATEWAY_PRESETS: CustomGatewayPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    portalLabel: 'openrouter.ai/keys',
    portalUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-...',
    steps: [
      'Open openrouter.ai/keys and sign in to your OpenRouter account.',
      'Click Create Key and paste your sk-or-... BYOK key below.',
      'Browse the live OpenRouter catalog (automatically refreshed) — pick openrouter/free or any :free model without credits, or use Paid models if your account has credits.',
    ],
    models: [
      {
        id: 'openrouter/free',
        label: 'OpenRouter Free Auto-Router',
        summary: 'Free — automatically routes to an available healthy free model',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 200000,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
        label: 'NVIDIA Llama 3.3 Nemotron Super 49B',
        summary: 'Free (:free) — strong coding, UI & multi-file layout synthesis',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 131072,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'nvidia/nemotron-nano-9b-v2:free',
        label: 'NVIDIA Nemotron Nano 9B v2',
        summary: 'Free (:free) — fast compact UI & JSON synthesis',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 131072,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'deepseek/deepseek-chat-v3-0324:free',
        label: 'DeepSeek V3 0324 (:free)',
        summary: 'Free (:free) — sharp React, TypeScript & game loop code',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 163840,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'deepseek/deepseek-r1-0528:free',
        label: 'DeepSeek R1 0528 (:free)',
        summary: 'Free (:free) — step-by-step architecture & complex edits',
        tier: 'Reasoning',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 163840,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'qwen/qwen3-coder:free',
        label: 'Qwen 3 Coder (:free)',
        summary: 'Free (:free) — purpose-built agentic web & Three.js coding',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 262144,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'qwen/qwen3-235b-a22b:free',
        label: 'Qwen 3 235B A22B (:free)',
        summary: 'Free (:free) — 235B MoE model for rich multi-file apps',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 131072,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'meta-llama/llama-4-maverick:free',
        label: 'Llama 4 Maverick (:free)',
        summary: 'Free (:free) — responsive frontend & component generation',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 131072,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'google/gemma-3-27b-it:free',
        label: 'Gemma 3 27B (:free)',
        summary: 'Free (:free) — fast open-weights UI iteration',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
        contextLength: 96000,
        pricingSummary: '$0 / Free',
      },
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4',
        summary: 'Paid credits — flagship frontend craftsmanship & design',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 200000,
        pricingSummary: '$3.00/1M in · $15.00/1M out',
      },
      {
        id: 'openai/gpt-4.1',
        label: 'GPT-4.1',
        summary: 'Paid credits — long-context multi-file React engineering',
        tier: 'Coding',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 1047576,
        pricingSummary: '$2.00/1M in · $8.00/1M out',
      },
      {
        id: 'openai/gpt-4o',
        label: 'GPT-4o',
        summary: 'Paid credits — versatile multimodal & web coding',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 128000,
        pricingSummary: '$2.50/1M in · $10.00/1M out',
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (OpenRouter)',
        summary: 'Paid credits — deep architectural planning & code synthesis',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 1048576,
        pricingSummary: '$1.25/1M in · $10.00/1M out',
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    portalLabel: 'console.groq.com/keys',
    portalUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    steps: [
      'Sign in at console.groq.com/keys with your Groq account.',
      'Click Create API Key and paste the key starting with gsk_ below.',
      'Groq includes rate-limited Free Tier quota on production models (and higher limits or extra models on Developer Paid accounts).',
    ],
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile',
        summary: 'Free Tier (rate-limited) / Paid — balanced 70B flagship on Groq LPUs',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'openai/gpt-oss-120b',
        label: 'GPT-OSS 120B (Groq)',
        summary: 'Free Tier / Paid — 120B open-weight flagship with structured JSON support',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'openai/gpt-oss-20b',
        label: 'GPT-OSS 20B (Groq)',
        summary: 'Free Tier / Paid — fast 20B open-weight coder',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        label: 'Llama 4 Maverick 17B',
        summary: 'Free Tier / Paid — 128-expert MoE for fast React & Canvas games',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        label: 'Llama 4 Scout 17B',
        summary: 'Free Tier / Paid — ultra-fast rapid refinement',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'qwen/qwen3-32b',
        label: 'Qwen 3 32B',
        summary: 'Free Tier / Paid — crisp modern React & TypeScript coding',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'groq/compound',
        label: 'Groq Compound',
        summary: 'Free Tier / Paid — compound reasoning system',
        tier: 'Reasoning',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'moonshotai/kimi-k2-instruct',
        label: 'Moonshot Kimi K2 Instruct',
        summary: 'Paid / Developer Tier — strong long-context UI & game generation',
        tier: 'Coding',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 131072,
      },
      {
        id: 'deepseek-r1-distill-llama-70b',
        label: 'DeepSeek R1 Distill Llama 70B',
        summary: 'Free Tier / Paid — distilled deep reasoning for logic & fixes',
        tier: 'Reasoning',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B Instant',
        summary: 'Free Tier — sub-second responses for light edits',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 131072,
      },
    ],
  },
  {
    id: 'gemini_byok',
    name: 'Gemini (BYOK)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    portalLabel: 'aistudio.google.com/apikey',
    portalUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza...',
    steps: [
      'Open Google AI Studio (aistudio.google.com/apikey) and create your own Gemini API key.',
      'Paste your AIza... key below (your key stays BYOK and never uses server keys).',
      'Pick a real Gemini model like gemini-2.5-flash or gemini-2.5-pro.',
    ],
    models: [
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash (BYOK)',
        summary: 'Free Tier (w/ AI Studio key) / Paid — fast coding, Three.js & Canvas games',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 1048576,
      },
      {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite (BYOK)',
        summary: 'Free Tier (w/ AI Studio key) / Paid — lightweight ultra-fast edits',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
        contextLength: 1048576,
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (BYOK)',
        summary: 'Paid / Limited Free — flagship reasoning & multi-file React systems',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 1048576,
      },
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    portalLabel: 'build.nvidia.com',
    portalUrl: 'https://build.nvidia.com/explore/discover',
    placeholder: 'nvapi-...',
    steps: [
      'Visit build.nvidia.com and sign in to NVIDIA Developer.',
      'Click Get API Key on any Nemotron model and copy the nvapi- key.',
      'Use NVIDIA Nemotron models with NVIDIA trial credits or paid quota.',
    ],
    models: [
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        label: 'NVIDIA Nemotron Super 49B v1.5',
        summary: 'Free Trial Credits — NVIDIA flagship reasoning & React coding',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free Trial',
      },
      {
        id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        label: 'NVIDIA Nemotron Ultra 253B',
        summary: 'Paid / Developer Credits — massive 253B reasoning flagship',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'qwen/qwen3-235b-a22b',
        label: 'Qwen 3 235B A22B (NIM)',
        summary: 'Free Trial Credits — high-capacity MoE coder',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free Trial',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    portalLabel: 'platform.openai.com/api-keys',
    portalUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-...',
    models: [
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        summary: 'Paid API — crisp coding & multi-file edits',
        tier: 'Coding',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 1047576,
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        summary: 'Paid API — fast low-cost iteration',
        tier: 'Fast',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 128000,
      },
      {
        id: 'o3-mini',
        label: 'o3-mini',
        summary: 'Paid API — deep reasoning & game physics',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
        contextLength: 200000,
      },
    ],
  },
  {
    id: 'custom_url',
    name: 'Custom Endpoint',
    baseUrl: '',
    placeholder: 'sk-...',
    models: [
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        label: 'Qwen2.5-Coder-32B-Instruct',
        summary: 'OpenAI-compatible custom endpoint',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Custom',
      },
      {
        id: 'gpt-4o-mini',
        label: 'gpt-4o-mini',
        summary: 'OpenAI-compatible endpoint',
        tier: 'Fast',
        billing: 'paid',
        billingLabel: 'Paid',
      },
    ],
  },
];

export const PROVIDER_CATALOG: Record<
  AiProviderId,
  {
    name: string;
    shortDesc: string;
    requiresUserKey: boolean;
    models: ModelCatalogItem[];
  }
> = {
  custom: {
    name: 'Custom BYOK',
    shortDesc: 'Connect any API Key, Base URL & Provider Name',
    requiresUserKey: true,
    models: CUSTOM_GATEWAY_PRESETS[0].models,
  },
  openrouter: {
    name: 'OpenRouter',
    shortDesc: 'Unified gateway with :free and paid models',
    requiresUserKey: true,
    models: CUSTOM_GATEWAY_PRESETS[0].models,
  },
  groq: {
    name: 'Groq',
    shortDesc: 'Ultra-fast LPU inference',
    requiresUserKey: true,
    models: CUSTOM_GATEWAY_PRESETS[1].models,
  },
  gemini: {
    name: 'Gemini (BYOK)',
    shortDesc: 'Your own Google AI Studio Gemini API key',
    requiresUserKey: true,
    models: CUSTOM_GATEWAY_PRESETS[2].models,
  },
};

export function detectGatewayFromBaseUrl(baseUrl?: string): CustomGatewayId {
  const lower = (baseUrl || '').toLowerCase();
  if (lower.includes('openrouter.ai')) return 'openrouter';
  if (lower.includes('api.groq.com')) return 'groq';
  if (lower.includes('generativelanguage.googleapis.com')) return 'gemini_byok';
  if (lower.includes('nvidia.com')) return 'nvidia';
  if (lower.includes('api.openai.com')) return 'openai';
  return 'custom_url';
}

export function normalizeProviderConfigToStudio(config: AiProviderConfig): AiProviderConfig {
  const rawProvider = config?.provider;
  const sessionOnlyKey = Boolean(config?.sessionOnlyKey);
  if (rawProvider === 'openrouter') {
    return {
      provider: 'custom',
      name: config.name?.trim() || 'OpenRouter',
      model: config.model || CUSTOM_GATEWAY_PRESETS[0].models[0].id,
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
      sessionOnlyKey,
    };
  }
  if (rawProvider === 'groq') {
    return {
      provider: 'custom',
      name: config.name?.trim() || 'Groq',
      model: config.model || CUSTOM_GATEWAY_PRESETS[1].models[0].id,
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
      sessionOnlyKey,
    };
  }
  if (rawProvider === 'gemini') {
    const legacyBroken =
      !config.model ||
      config.model === 'gemini-4-hydrogen' ||
      config.model === 'gemini-3.8-live';
    return {
      provider: 'custom',
      name: config.name?.trim() || 'Gemini (BYOK)',
      model: legacyBroken ? 'gemini-2.5-flash' : config.model,
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai',
      sessionOnlyKey,
    };
  }

  const detected = detectGatewayFromBaseUrl(config?.baseUrl);
  const preset = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === detected);
  return {
    provider: 'custom',
    name: config?.name?.trim() || (preset && preset.id !== 'custom_url' ? preset.name : 'Custom Provider'),
    model: config?.model || DEFAULT_BYOK_CONFIG.model,
    apiKey: config?.apiKey || '',
    baseUrl: config?.baseUrl ?? DEFAULT_BYOK_CONFIG.baseUrl,
    sessionOnlyKey,
  };
}

export function getDefaultModelForProvider(provider: AiProviderId): string {
  return PROVIDER_CATALOG[provider]?.models[0]?.id || DEFAULT_BYOK_CONFIG.model;
}

export function getModelDisplayLabel(
  provider: AiProviderId,
  modelId: string,
  liveModels?: ModelCatalogItem[],
): string {
  if (liveModels) {
    const inLive = liveModels.find((m) => m.id === modelId);
    if (inLive) return inLive.label;
  }
  const inPrimary = PROVIDER_CATALOG[provider]?.models.find((m) => m.id === modelId);
  if (inPrimary) return inPrimary.label;
  for (const preset of CUSTOM_GATEWAY_PRESETS) {
    const match = preset.models.find((m) => m.id === modelId);
    if (match) return match.label;
  }
  return modelId;
}

export function findModelEntry(
  provider: AiProviderId,
  modelId: string,
  baseUrl?: string,
  liveModels?: ModelCatalogItem[],
): ModelCatalogItem | undefined {
  if (liveModels) {
    const liveMatch = liveModels.find((item) => item.id === modelId);
    if (liveMatch) return liveMatch;
  }
  const gw = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === detectGatewayFromBaseUrl(baseUrl));
  if (gw) {
    const m = gw.models.find((item) => item.id === modelId);
    if (m) return m;
  }
  for (const preset of CUSTOM_GATEWAY_PRESETS) {
    const m = preset.models.find((item) => item.id === modelId);
    if (m) return m;
  }
  return PROVIDER_CATALOG[provider]?.models.find((m) => m.id === modelId);
}

/**
 * Detects whether a user's website prompt explicitly asks for live AI functionality inside the generated app.
 * Uses strict word-boundary patterns to avoid false positives on words like "train", "paint", or "detail".
 */
export function promptRequestsAi(prompt: string): boolean {
  const cleaned = (prompt || '').trim();
  if (!cleaned) return false;
  return (
    /\b(?:ai|llm|chatbot|chat-bot|ai-powered|ai-enabled|copilot|co-pilot)\b/i.test(cleaned) ||
    /\/api\/app-ai|mistai/i.test(cleaned) ||
    /\b(?:with|add|include|using|powered by)\s+(?:an?\s+)?(?:smart\s+)?(?:assistant|summarizer|translator|tutor|coach|analyzer|writer|generator)\b/i.test(
      cleaned,
    ) ||
    /\b(?:ai\s+(?:chat|writer|assistant|editor|tutor|planner|search|quiz|analyzer|generator))\b/i.test(
      cleaned,
    )
  );
}

export function shouldEnableAppAi(
  prompt: string,
  mode: AppAiMode = 'on_request',
  explicitOverride?: boolean,
): boolean {
  if (typeof explicitOverride === 'boolean') return explicitOverride;
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return promptRequestsAi(prompt);
}

export interface LiveCatalogResponse {
  gateway: CustomGatewayId;
  source: 'live' | 'preset';
  fetchedAt: string;
  models: ModelCatalogItem[];
  note?: string;
}

const clientCatalogCache = new Map<string, { expiresAt: number; data: LiveCatalogResponse }>();

export async function fetchLiveModelCatalog(params: {
  baseUrl: string;
  apiKey?: string;
  forceRefresh?: boolean;
}): Promise<LiveCatalogResponse> {
  const cleanUrl = (params.baseUrl || '').trim().replace(/\/+$/, '');
  const hasKey = Boolean(params.apiKey?.trim());
  const cacheKey = `${cleanUrl}|${hasKey ? 'auth' : 'anon'}`;

  if (!params.forceRefresh) {
    const hit = clientCatalogCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data;
    }
  }

  const resp = await fetch('/api/ai/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: cleanUrl,
      apiKey: params.apiKey?.trim() || undefined,
      forceRefresh: Boolean(params.forceRefresh),
    }),
  });

  if (!resp.ok) {
    const errPayload = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(errPayload.error || `Failed to load model catalog (${resp.status}).`);
  }

  const data = (await resp.json()) as LiveCatalogResponse;
  clientCatalogCache.set(cacheKey, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    data,
  });
  return data;
}
