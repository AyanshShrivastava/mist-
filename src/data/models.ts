import type { AiProviderConfig, AiProviderId, ModelBilling, PrimaryProviderId } from '../types/mist';

export interface ModelCatalogItem {
  id: string;
  label: string;
  summary: string;
  tier: 'Default' | 'Fast' | 'Reasoning' | 'Pro' | 'Coding' | 'Voice' | 'Audio' | 'Media';
  billing: ModelBilling;
  billingLabel: string;
}

export type CustomGatewayId = 'openrouter' | 'groq' | 'nvidia' | 'custom_url';

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

export const PRIMARY_STUDIO_PROVIDERS: PrimaryProviderId[] = ['gemini', 'custom'];

export const PROVIDER_CATALOG: Record<
  AiProviderId,
  {
    name: string;
    shortDesc: string;
    requiresUserKey: boolean;
    models: ModelCatalogItem[];
  }
> = {
  gemini: {
    name: 'Gemini',
    shortDesc: 'Built-in server inference, expanded Gemini models & Live Voice Studio',
    requiresUserKey: false,
    models: [
      {
        id: 'gemini-4-hydrogen',
        label: 'Gemini 4 Hydrogen',
        summary: 'Default multimodal UI, React & TypeScript generation',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash Lite',
        summary: 'Ultra-low latency edits and lightweight refinement',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-3.8-live',
        label: 'Gemini 3.8 Live Voice',
        summary: 'Real-time bidirectional voice & audio design partner',
        tier: 'Voice',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-3.8-live-extended-thinking',
        label: 'Gemini 3.8 Live Thinking',
        summary: 'Real-time voice studio with extended architectural reasoning',
        tier: 'Voice',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-3.8-flash-lite-tts',
        label: 'Gemini 3.8 Flash Lite TTS',
        summary: 'High-throughput single & multi-voice text-to-speech',
        tier: 'Audio',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-3.8-flash-tts',
        label: 'Gemini 3.8 Flash TTS',
        summary: 'Expressive voice design & multi-speaker audio generation',
        tier: 'Audio',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-3.5-transcribe',
        label: 'Gemini 3.5 Transcribe',
        summary: 'Accurate audio transcription and speech-to-text',
        tier: 'Audio',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'gemini-4-argon',
        label: 'Gemini 4 Argon',
        summary: 'Advanced architecture & multi-file application reasoning (requires paid Gemini key)',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'gemini-4-carbon',
        label: 'Gemini 4 Carbon',
        summary: 'Maximum reasoning depth & complex full-stack synthesis (requires paid Gemini key)',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'gemini-3.1-flash-lite-image',
        label: 'Gemini 3.1 Flash Lite Image',
        summary: 'Fast image generation & visual asset editing (requires paid Gemini key)',
        tier: 'Media',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'gemini-nano-banana-2.1',
        label: 'Gemini Nano Banana 2.1',
        summary: 'High-resolution 1K/2K/4K image synthesis (requires paid Gemini key)',
        tier: 'Media',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'gemini-3-pro-image',
        label: 'Gemini 3 Pro Image',
        summary: 'Studio flagship visual & illustration generator (requires paid Gemini key)',
        tier: 'Media',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'gemini-omni-1.2-flash',
        label: 'Gemini Omni 1.2 Flash',
        summary: 'Video generation, editing & multimodal synthesis (requires paid Gemini key)',
        tier: 'Media',
        billing: 'paid',
        billingLabel: 'Paid',
      },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    shortDesc: 'Unified gateway with :free NVIDIA Nemotron, DeepSeek & Qwen models + paid flagships',
    requiresUserKey: true,
    models: [
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
        label: 'NVIDIA Llama 3.3 Nemotron Super 49B',
        summary: 'Free OpenRouter route — high-accuracy coding & reasoning',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'nvidia/nemotron-nano-9b-v2:free',
        label: 'NVIDIA Nemotron Nano 9B v2',
        summary: 'Free OpenRouter route — compact fast UI & JSON synthesis',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
        label: 'NVIDIA Llama 3.1 Nemotron 70B',
        summary: 'Free OpenRouter route — balanced 70B general & web engineering',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'deepseek/deepseek-chat-v3-0324:free',
        label: 'DeepSeek V3 0324 (:free)',
        summary: 'Free OpenRouter route — sharp React, TypeScript & Tailwind generation',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'deepseek/deepseek-r1-0528:free',
        label: 'DeepSeek R1 0528 (:free)',
        summary: 'Free OpenRouter route — deep chain-of-thought architecture',
        tier: 'Reasoning',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'qwen/qwen3-235b-a22b:free',
        label: 'Qwen 3 235B A22B (:free)',
        summary: 'Free OpenRouter route — 235B MoE flagship for structured apps',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'qwen/qwen3-coder:free',
        label: 'Qwen 3 Coder (:free)',
        summary: 'Free OpenRouter route — purpose-built agentic web coding model',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'meta-llama/llama-4-maverick:free',
        label: 'Llama 4 Maverick (:free)',
        summary: 'Free OpenRouter route — MoE model for responsive frontend generation',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'meta-llama/llama-4-scout:free',
        label: 'Llama 4 Scout (:free)',
        summary: 'Free OpenRouter route — fast long-context UI edits',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'google/gemma-3-27b-it:free',
        label: 'Gemma 3 27B (:free)',
        summary: 'Free OpenRouter route — clean open weights for UI polish',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'mistralai/mistral-small-3.1-24b-instruct:free',
        label: 'Mistral Small 3.1 24B (:free)',
        summary: 'Free OpenRouter route — snappy low-latency instruction following',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4',
        summary: 'Paid OpenRouter credits — precision frontend design & React systems',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'anthropic/claude-3.7-sonnet',
        label: 'Claude 3.7 Sonnet',
        summary: 'Paid OpenRouter credits — hybrid reasoning & UI craftsmanship',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'anthropic/claude-3.5-haiku',
        label: 'Claude 3.5 Haiku',
        summary: 'Paid OpenRouter credits — fast UI refinements',
        tier: 'Fast',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'openai/gpt-4.1',
        label: 'GPT-4.1',
        summary: 'Paid OpenRouter credits — long-context multi-file coding',
        tier: 'Coding',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'openai/gpt-4o',
        label: 'GPT-4o',
        summary: 'Paid OpenRouter credits — versatile generation & balanced speed',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'openai/o3-mini',
        label: 'OpenAI o3-mini',
        summary: 'Paid OpenRouter credits — focused algorithmic & logic reasoning',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        label: 'NVIDIA Nemotron Ultra 253B',
        summary: 'Paid OpenRouter credits — massive 253B reasoning flagship',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (OpenRouter)',
        summary: 'Paid OpenRouter credits — large-context design synthesis',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'deepseek/deepseek-r1',
        label: 'DeepSeek R1 (Paid Route)',
        summary: 'Paid OpenRouter credits — uncapped architectural planning',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
      },
    ],
  },
  groq: {
    name: 'Groq',
    shortDesc: 'Ultra-fast LPU inference via your Groq API key (Free rate-limited tier & Paid)',
    requiresUserKey: true,
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile',
        summary: 'Free Tier (rate-limited) / Paid — balanced 70B flagship on Groq LPUs',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        label: 'Llama 4 Maverick 17B',
        summary: 'Free Tier / Paid — 128-expert MoE built for fast structured React code',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        label: 'Llama 4 Scout 17B',
        summary: 'Free Tier / Paid — ultra-fast 16-expert rapid iteration model',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'moonshotai/kimi-k2-instruct',
        label: 'Moonshot Kimi K2 Instruct',
        summary: 'Paid / Developer Tier — strong long-context UI & code synthesis on Groq',
        tier: 'Coding',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'qwen/qwen3-32b',
        label: 'Qwen 3 32B',
        summary: 'Free Tier / Paid — crisp modern React & TypeScript coding',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'qwen-qwq-32b',
        label: 'Qwen QwQ 32B',
        summary: 'Free Tier / Paid — step-by-step layout & state reasoning',
        tier: 'Reasoning',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'deepseek-r1-distill-llama-70b',
        label: 'DeepSeek R1 Distill Llama 70B',
        summary: 'Free Tier / Paid — distilled deep reasoning for complex logic',
        tier: 'Reasoning',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B Instant',
        summary: 'Free Tier — sub-second responses for minor copy & CSS edits',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'mistral-saba-24b',
        label: 'Mistral Saba 24B',
        summary: 'Free Tier / Paid — clean compact instruction model',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'gemma2-9b-it',
        label: 'Gemma 2 9B Instruct',
        summary: 'Free Tier — lightweight instant edits',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'allam-2-7b',
        label: 'ALLaM 2 7B',
        summary: 'Free Tier — multilingual Arabic & English generation',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
    ],
  },
  custom: {
    name: 'Custom',
    shortDesc: 'Connect OpenRouter, Groq, NVIDIA NIM, or any OpenAI-compatible Base URL & Model',
    requiresUserKey: true,
    models: [
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
        label: 'NVIDIA Nemotron Super 49B (:free)',
        summary: 'Free OpenRouter route — great default without needing credits',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'deepseek/deepseek-chat-v3-0324:free',
        label: 'DeepSeek V3 0324 (:free)',
        summary: 'Free OpenRouter route — crisp React & Tailwind output',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'qwen/qwen3-235b-a22b:free',
        label: 'Qwen 3 235B A22B (:free)',
        summary: 'Free OpenRouter route — large MoE multi-file generation',
        tier: 'Pro',
        billing: 'free',
        billingLabel: 'Free',
      },
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile (Groq)',
        summary: 'Groq Free Tier — fast LPU code & UI synthesis',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Tier',
      },
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4',
        summary: 'Paid — requires OpenRouter credits or Anthropic-compatible gateway',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'openai/gpt-4.1',
        label: 'GPT-4.1',
        summary: 'Paid — requires OpenAI or OpenRouter credits',
        tier: 'Coding',
        billing: 'paid',
        billingLabel: 'Paid',
      },
    ],
  },
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
      'Open openrouter.ai/keys and sign in to your OpenRouter dashboard.',
      'Select Create Key and copy the key starting with sk-or-.',
      'Pick any Free (:free) model like NVIDIA Nemotron or DeepSeek V3 without credits, or Paid models if you have credits.',
    ],
    models: PROVIDER_CATALOG.openrouter.models,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    portalLabel: 'console.groq.com/keys',
    portalUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    steps: [
      'Sign in at console.groq.com/keys with your Groq developer account.',
      'Select Create API Key, label it Mist Studio, and copy the key starting with gsk_.',
      'Choose a Free Tier or Paid model below and click Test Connection.',
    ],
    models: PROVIDER_CATALOG.groq.models,
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
      'Use NVIDIA Nemotron models with NVIDIA free developer credits or paid API quota.',
    ],
    models: [
      {
        id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        label: 'NVIDIA Nemotron Super 49B v1.5',
        summary: 'Free Trial Credits / Paid — NVIDIA flagship reasoning & React code model',
        tier: 'Default',
        billing: 'free',
        billingLabel: 'Free Trial',
      },
      {
        id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        label: 'NVIDIA Nemotron Ultra 253B',
        summary: 'Paid / Developer Credits — massive 253B multi-step architecture',
        tier: 'Reasoning',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'nvidia/nvidia-nemotron-nano-9b-v2',
        label: 'NVIDIA Nemotron Nano 9B v2',
        summary: 'Free Trial Credits — rapid lightweight component & style edits',
        tier: 'Fast',
        billing: 'free',
        billingLabel: 'Free Trial',
      },
      {
        id: 'qwen/qwen3-235b-a22b',
        label: 'Qwen 3 235B A22B (NIM)',
        summary: 'Free Trial Credits / Paid — high-capacity MoE coder',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Free Trial',
      },
    ],
  },
  {
    id: 'custom_url',
    name: 'Custom URL',
    baseUrl: '',
    placeholder: 'sk-...',
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'gpt-4o-mini (Custom / OpenAI)',
        summary: 'Paid API — compact fast OpenAI-compatible model',
        tier: 'Fast',
        billing: 'paid',
        billingLabel: 'Paid',
      },
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        label: 'Qwen2.5-Coder-32B-Instruct (Self-Hosted)',
        summary: 'Free (Self-hosted Ollama / vLLM) or Paid endpoint',
        tier: 'Coding',
        billing: 'free',
        billingLabel: 'Self-Hosted',
      },
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        label: 'Llama-3.3-70B-Instruct-Turbo',
        summary: 'Paid / Endpoint-billed — Together AI or Fireworks Turbo route',
        tier: 'Pro',
        billing: 'paid',
        billingLabel: 'Paid',
      },
    ],
  },
];

export function detectGatewayFromBaseUrl(baseUrl?: string): CustomGatewayId {
  const lower = (baseUrl || '').toLowerCase();
  if (lower.includes('openrouter.ai')) return 'openrouter';
  if (lower.includes('api.groq.com')) return 'groq';
  if (lower.includes('nvidia.com')) return 'nvidia';
  return 'custom_url';
}

export function normalizeProviderConfigToStudio(config: AiProviderConfig): AiProviderConfig {
  if (config.provider === 'gemini') {
    return config;
  }
  if (config.provider === 'openrouter') {
    return {
      provider: 'custom',
      model: config.model || PROVIDER_CATALOG.openrouter.models[0].id,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
    };
  }
  if (config.provider === 'groq') {
    return {
      provider: 'custom',
      model: config.model || PROVIDER_CATALOG.groq.models[0].id,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
    };
  }
  return {
    ...config,
    provider: 'custom',
  };
}

export function getDefaultModelForProvider(provider: AiProviderId): string {
  return PROVIDER_CATALOG[provider].models[0].id;
}

export function getModelDisplayLabel(provider: AiProviderId, modelId: string): string {
  const inPrimary = PROVIDER_CATALOG[provider]?.models.find((m) => m.id === modelId);
  if (inPrimary) return inPrimary.label;
  for (const preset of CUSTOM_GATEWAY_PRESETS) {
    const match = preset.models.find((m) => m.id === modelId);
    if (match) return match.label;
  }
  return modelId;
}

export function findModelEntry(provider: AiProviderId, modelId: string, baseUrl?: string): ModelCatalogItem | undefined {
  if (provider === 'gemini') {
    return PROVIDER_CATALOG.gemini.models.find((m) => m.id === modelId);
  }
  const gw = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === detectGatewayFromBaseUrl(baseUrl));
  if (gw) {
    const m = gw.models.find((item) => item.id === modelId);
    if (m) return m;
  }
  return (
    PROVIDER_CATALOG[provider]?.models.find((m) => m.id === modelId) ||
    PROVIDER_CATALOG.openrouter.models.find((m) => m.id === modelId) ||
    PROVIDER_CATALOG.groq.models.find((m) => m.id === modelId)
  );
}
