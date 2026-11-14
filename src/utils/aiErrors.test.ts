import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelError } from './aiErrors';

test('classifyModelError identifies 429 rate limits and retry seconds', () => {
  const res = classifyModelError({
    status: 429,
    message: 'RESOURCE_EXHAUSTED: Rate limit exceeded, retry in 15s',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
  });
  assert.equal(res.code, 'RATE_LIMIT');
  assert.equal(res.retryAfterSeconds, 15);
  assert.ok(res.title.includes('rate limits'));
});

test('classifyModelError identifies 503 upstream server outages', () => {
  const res = classifyModelError({
    status: 503,
    message: 'Service Unavailable: model overloaded',
    provider: 'gemini',
    model: 'gemini-4-hydrogen',
  });
  assert.equal(res.code, 'SERVER_OUTAGE');
  assert.ok(res.title.includes('server outage'));
});

test('classifyModelError identifies 401 invalid API keys', () => {
  const res = classifyModelError({
    status: 401,
    message: 'Invalid API key provided',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
  });
  assert.equal(res.code, 'AUTH_ERROR');
});

test('classifyModelError identifies 404 unavailable models', () => {
  const res = classifyModelError({
    status: 404,
    message: 'Model not found',
    provider: 'openrouter',
    model: 'unknown/model',
  });
  assert.equal(res.code, 'MODEL_UNAVAILABLE');
});
