import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelError } from './aiErrors';

test('classifyModelError classifies OpenRouter 402 credits/max_tokens failure as CREDITS_REQUIRED', () => {
  const incident = classifyModelError({
    status: 402,
    provider: 'custom',
    model: 'openai/gpt-4.1',
    message:
      'OpenRouter error (402): {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 5000.","code":402,"metadata":{"limit_source":"openrouter_credits"}}}',
  });

  assert.equal(incident.code, 'CREDITS_REQUIRED');
  assert.equal(incident.title, 'openai/gpt-4.1 requires paid credits');
  assert.ok(incident.message.includes('5000 tokens'));
  assert.ok(incident.message.includes('Free model'));
});

test('classifyModelError detects rate limit, outage, and auth errors accurately', () => {
  const rateLimit = classifyModelError({
    status: 429,
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
    message: 'Resource exhausted, retry in 12s',
  });
  assert.equal(rateLimit.code, 'RATE_LIMIT');
  assert.equal(rateLimit.retryAfterSeconds, 12);

  const outage = classifyModelError({
    status: 503,
    provider: 'custom',
    model: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    message: 'Service Unavailable',
  });
  assert.equal(outage.code, 'SERVER_OUTAGE');

  const auth = classifyModelError({
    status: 401,
    provider: 'custom',
    model: 'openai/gpt-4.1',
    message: 'Invalid API key',
  });
  assert.equal(auth.code, 'AUTH_ERROR');
});
