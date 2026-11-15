import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultModelForProvider,
  getModelDisplayLabel,
  PROVIDER_CATALOG,
} from './models';

test('Gemini catalog only contains supported Gemini models', () => {
  const ids = PROVIDER_CATALOG.gemini.models.map((m) => m.id);
  assert.ok(ids.includes('gemini-4-hydrogen'));
  assert.ok(ids.includes('gemini-3.1-flash-lite'));
  assert.ok(ids.includes('gemini-4-argon'));
  assert.ok(ids.includes('gemini-4-carbon'));
  assert.equal(getDefaultModelForProvider('gemini'), 'gemini-4-hydrogen');
});

test('Groq and OpenRouter expose expanded multi-model catalogs', () => {
  assert.ok(PROVIDER_CATALOG.groq.models.length >= 6);
  assert.ok(PROVIDER_CATALOG.openrouter.models.length >= 8);
  assert.equal(getDefaultModelForProvider('groq'), 'llama-3.3-70b-versatile');
  assert.equal(getDefaultModelForProvider('openrouter'), 'anthropic/claude-sonnet-4');
});

test('getModelDisplayLabel falls back gracefully for custom models', () => {
  assert.equal(
    getModelDisplayLabel('gemini', 'gemini-4-hydrogen'),
    'Gemini 4 Hydrogen',
  );
  assert.equal(
    getModelDisplayLabel('custom', 'my-org/custom-coder-v1'),
    'my-org/custom-coder-v1',
  );
});
