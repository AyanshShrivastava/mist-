import type { AiProviderId } from '../types/mist';

export type ModelErrorCode =
  | 'RATE_LIMIT'
  | 'CREDITS_REQUIRED'
  | 'SERVER_OUTAGE'
  | 'AUTH_ERROR'
  | 'MODEL_UNAVAILABLE'
  | 'UNKNOWN';

export interface ModelHealthIncident {
  provider: AiProviderId;
  model: string;
  code: ModelErrorCode;
  title: string;
  message: string;
  retryAfterSeconds?: number;
  updatedAt: string;
}

export function classifyModelError(params: {
  status?: number;
  message: string;
  provider: AiProviderId;
  model: string;
}): ModelHealthIncident {
  const { status, message, provider, model } = params;
  const lower = message.toLowerCase();
  const now = new Date().toISOString();

  const retryMatch = message.match(/retry[^\d]*(\d+)\s*s/i);
  const retryAfterSeconds = retryMatch ? Number(retryMatch[1]) : undefined;

  if (
    status === 402 ||
    lower.includes('openrouter_credits') ||
    lower.includes('requires more credits') ||
    lower.includes('can only afford') ||
    lower.includes('insufficient_quota') ||
    lower.includes('credit balance') ||
    lower.includes('upgrade to a paid account')
  ) {
    const affordMatch = message.match(/can only afford\s+(\d+)(?:\s*tokens?)?/i);
    const affordNote = affordMatch
      ? ` Account credits only allow ~${affordMatch[1]} tokens on this paid route.`
      : '';
    return {
      provider,
      model,
      code: 'CREDITS_REQUIRED',
      title: `${model} requires paid credits`,
      message: `${model} is a paid model and lacks sufficient credits.${affordNote} Switch to a :free or Free Tier BYOK model, or add provider credits.`,
      updatedAt: now,
    };
  }

  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('too many requests')
  ) {
    return {
      provider,
      model,
      code: 'RATE_LIMIT',
      title: `${model} is hitting rate limits`,
      message: retryAfterSeconds
        ? `Rate limit reached for ${model}. Retry in ~${retryAfterSeconds}s or switch to another model.`
        : `Rate limit reached for ${model}. Switch models or wait a moment before retrying.`,
      retryAfterSeconds,
      updatedAt: now,
    };
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('overloaded') ||
    lower.includes('unavailable') ||
    lower.includes('service unavailable') ||
    lower.includes('bad gateway') ||
    lower.includes('timeout')
  ) {
    return {
      provider,
      model,
      code: 'SERVER_OUTAGE',
      title: `${model} is experiencing a server outage`,
      message: `Upstream provider returned ${status || 'a temporary outage'} for ${model}. Try switching models or providers.`,
      updatedAt: now,
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('authentication')
  ) {
    return {
      provider,
      model,
      code: 'AUTH_ERROR',
      title: `API key rejected for ${provider}`,
      message: `Check your ${provider} API key in Settings or Providers and try again.`,
      updatedAt: now,
    };
  }

  if (
    status === 404 ||
    lower.includes('not_found') ||
    lower.includes('model not found') ||
    lower.includes('does not exist')
  ) {
    return {
      provider,
      model,
      code: 'MODEL_UNAVAILABLE',
      title: `${model} is unavailable`,
      message: `The selected model "${model}" could not be found on ${provider}. Pick another model.`,
      updatedAt: now,
    };
  }

  return {
    provider,
    model,
    code: 'UNKNOWN',
    title: `${model} request failed`,
    message: message || 'An unexpected provider error occurred.',
    updatedAt: now,
  };
}
