import type { AiProviderId } from '../types/mist';

export interface ModelCatalogItem {
  id: string;
  label: string;
  summary: string;
  tier: 'Default' | 'Fast' | 'Reasoning' | 'Pro' | 'Coding';
}

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
    shortDesc: 'Built-in server inference + Live Voice Studio',
    requiresUserKey: false,
    models: [
      {
        id: 'gemini-4-hydrogen',
        label: 'Gemini 4 Hydrogen',
        summary: 'Default multimodal UI generation & rapid iteration',
        tier: 'Default',
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash Lite',
        summary: 'Ultra-low latency edits and lightweight refinement',
        tier: 'Fast',
      },
      {
        id: 'gemini-4-argon',
        label: 'Gemini 4 Argon',
        summary: 'Advanced architecture & multi-file application reasoning',
        tier: 'Reasoning',
      },
      {
        id: 'gemini-4-carbon',
        label: 'Gemini 4 Carbon',
        summary: 'Maximum quality full-stack & complex component generation',
        tier: 'Pro',
      },
    ],
  },
  groq: {
    name: 'Groq',
    shortDesc: 'Ultra-fast LPU inference via your Groq API key',
    requiresUserKey: true,
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile',
        summary: 'Balanced 70B flagship on Groq LPUs',
        tier: 'Default',
      },
      {
        id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        label: 'Llama 4 Maverick 17B',
        summary: 'Mixture-of-experts model built for fast structured UI output',
        tier: 'Pro',
      },
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        label: 'Llama 4 Scout 17B',
        summary: 'High-throughput 16-expert architecture for rapid edits',
        tier: 'Fast',
      },
      {
        id: 'qwen-qwq-32b',
        label: 'Qwen QwQ 32B',
        summary: 'Step-by-step code & layout reasoning',
        tier: 'Reasoning',
      },
      {
        id: 'qwen/qwen3-32b',
        label: 'Qwen 3 32B',
        summary: 'Clean modern React & TypeScript synthesis',
        tier: 'Coding',
      },
      {
        id: 'deepseek-r1-distill-llama-70b',
        label: 'DeepSeek R1 Distill Llama 70B',
        summary: 'Distilled deep reasoning for complex interactive logic',
        tier: 'Reasoning',
      },
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B Instant',
        summary: 'Sub-second responses for small visual & copy tweaks',
        tier: 'Fast',
      },
      {
        id: 'gemma2-9b-it',
        label: 'Gemma 2 9B Instruct',
        summary: 'Compact lightweight model for quick copy updates',
        tier: 'Fast',
      },
      {
        id: 'mixtral-8x7b-32768',
        label: 'Mixtral 8x7B 32K',
        summary: 'Sparse MoE model with 32K context window',
        tier: 'Coding',
      },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    shortDesc: 'Unified gateway to Anthropic, OpenAI, Google, DeepSeek & Meta',
    requiresUserKey: true,
    models: [
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4',
        summary: 'Precision frontend design, React architecture & polish',
        tier: 'Default',
      },
      {
        id: 'anthropic/claude-3.7-sonnet',
        label: 'Claude 3.7 Sonnet',
        summary: 'Strong hybrid reasoning & UI component craftsmanship',
        tier: 'Pro',
      },
      {
        id: 'anthropic/claude-3.5-haiku',
        label: 'Claude 3.5 Haiku',
        summary: 'Snappy UI refinements and low-latency edits',
        tier: 'Fast',
      },
      {
        id: 'openai/gpt-4.1',
        label: 'GPT-4.1',
        summary: 'Long-context structured JSON & multi-file coding',
        tier: 'Coding',
      },
      {
        id: 'openai/gpt-4o',
        label: 'GPT-4o',
        summary: 'Versatile generation and balanced speed',
        tier: 'Pro',
      },
      {
        id: 'openai/gpt-4o-mini',
        label: 'GPT-4o Mini',
        summary: 'Economical fast generation & copy edits',
        tier: 'Fast',
      },
      {
        id: 'openai/o3-mini',
        label: 'OpenAI o3-mini',
        summary: 'Focused logical & algorithmic reasoning',
        tier: 'Reasoning',
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (OR)',
        summary: 'Large-context multimodal design synthesis via OpenRouter',
        tier: 'Pro',
      },
      {
        id: 'google/gemini-2.5-flash',
        label: 'Gemini 2.5 Flash (OR)',
        summary: 'Fast streaming generation via OpenRouter',
        tier: 'Fast',
      },
      {
        id: 'deepseek/deepseek-chat',
        label: 'DeepSeek V3 Chat',
        summary: 'High value full-stack TypeScript & Tailwind generation',
        tier: 'Coding',
      },
      {
        id: 'deepseek/deepseek-r1',
        label: 'DeepSeek R1',
        summary: 'Deep architectural planning before code output',
        tier: 'Reasoning',
      },
      {
        id: 'qwen/qwen-2.5-coder-32b-instruct',
        label: 'Qwen 2.5 Coder 32B',
        summary: 'Purpose-built open coding model for TypeScript',
        tier: 'Coding',
      },
      {
        id: 'meta-llama/llama-4-maverick',
        label: 'Llama 4 Maverick',
        summary: 'Open-weight flagship MoE model',
        tier: 'Pro',
      },
    ],
  },
  custom: {
    name: 'Custom Endpoint',
    shortDesc: 'Any OpenAI-compatible Base URL (Together, Fireworks, Ollama, vLLM)',
    requiresUserKey: true,
    models: [
      {
        id: 'gpt-4o-mini',
        label: 'gpt-4o-mini',
        summary: 'Generic OpenAI-compatible model identifier',
        tier: 'Default',
      },
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        label: 'Qwen2.5-Coder-32B-Instruct',
        summary: 'Popular self-hosted or Together/vLLM coder model',
        tier: 'Coding',
      },
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        label: 'Llama-3.3-70B-Instruct-Turbo',
        summary: 'Together AI / Fireworks high-speed 70B preset',
        tier: 'Fast',
      },
    ],
  },
};

export function getDefaultModelForProvider(provider: AiProviderId): string {
  return PROVIDER_CATALOG[provider].models[0].id;
}

export function getModelDisplayLabel(provider: AiProviderId, modelId: string): string {
  const found = PROVIDER_CATALOG[provider]?.models.find((m) => m.id === modelId);
  return found ? found.label : modelId;
}
