import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_GATEWAY_PRESETS,
  detectGatewayFromBaseUrl,
  findModelEntry,
  getDefaultModelForProvider,
  getModelDisplayLabel,
  normalizeProviderConfigToStudio,
  PRIMARY_STUDIO_PROVIDERS,
  PROVIDER_CATALOG,
} from './models';

test('PRIMARY_STUDIO_PROVIDERS exposes only Gemini and Custom', () => {
  assert.deepEqual(PRIMARY_STUDIO_PROVIDERS, ['gemini', 'custom']);
});

test('Gemini catalog contains expanded models and clear Free/Paid tags', () => {
  const ids = PROVIDER_CATALOG.gemini.models.map((m) => m.id);
  assert.ok(ids.includes('gemini-4-hydrogen'));
  assert.ok(ids.includes('gemini-3.1-flash-lite'));
  assert.ok(ids.includes('gemini-4-argon'));
  assert.ok(ids.includes('gemini-4-carbon'));
  assert.ok(ids.includes('gemini-3.8-live'));
  assert.equal(getDefaultModelForProvider('gemini'), 'gemini-4-hydrogen');

  const hydrogen = findModelEntry('gemini', 'gemini-4-hydrogen');
  const argon = findModelEntry('gemini', 'gemini-4-argon');
  assert.equal(hydrogen?.billing, 'free');
  assert.equal(argon?.billing, 'paid');
});

test('OpenRouter, Groq, and NVIDIA NIM presets include NVIDIA Nemotron and valid Free/Paid billing tags', () => {
  assert.ok(PROVIDER_CATALOG.groq.models.length >= 10);
  assert.ok(PROVIDER_CATALOG.openrouter.models.length >= 18);
  assert.equal(getDefaultModelForProvider('groq'), 'llama-3.3-70b-versatile');
  assert.equal(
    getDefaultModelForProvider('openrouter'),
    'nvidia/llama-3.3-nemotron-super-49b-v1:free',
  );

  const openrouterIds = PROVIDER_CATALOG.openrouter.models.map((m) => m.id);
  assert.ok(openrouterIds.some((id) => id.includes('nemotron')));

  const nvidiaPreset = CUSTOM_GATEWAY_PRESETS.find((g) => g.id === 'nvidia');
  assert.ok(nvidiaPreset);
  assert.ok(nvidiaPreset.models.some((m) => m.id.includes('nemotron')));

  for (const [providerId, catalog] of Object.entries(PROVIDER_CATALOG)) {
    for (const model of catalog.models) {
      assert.ok(
        model.billing === 'free' || model.billing === 'paid',
        `Expected free/paid billing on ${providerId}/${model.id}`,
      );
      assert.ok(
        model.billingLabel.length > 0,
        `Expected billingLabel on ${providerId}/${model.id}`,
      );
    }
  }
});

test('normalizeProviderConfigToStudio maps legacy openrouter/groq to custom with gateway baseUrl', () => {
  const normalizedOr = normalizeProviderConfigToStudio({
    provider: 'openrouter',
    model: 'openai/gpt-4.1',
    apiKey: 'sk-or-test',
  });
  assert.equal(normalizedOr.provider, 'custom');
  assert.equal(normalizedOr.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(detectGatewayFromBaseUrl(normalizedOr.baseUrl), 'openrouter');

  const normalizedGroq = normalizeProviderConfigToStudio({
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    apiKey: 'gsk-test',
  });
  assert.equal(normalizedGroq.provider, 'custom');
  assert.equal(normalizedGroq.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(detectGatewayFromBaseUrl(normalizedGroq.baseUrl), 'groq');
});

test('getModelDisplayLabel resolves known models and falls back cleanly for custom IDs', () => {
  assert.equal(
    getModelDisplayLabel('gemini', 'gemini-4-hydrogen'),
    'Gemini 4 Hydrogen',
  );
  assert.equal(
    getModelDisplayLabel('custom', 'nvidia/llama-3.3-nemotron-super-49b-v1.5'),
    'NVIDIA Nemotron Super 49B v1.5',
  );
  assert.equal(
    getModelDisplayLabel('custom', 'my-org/custom-coder-v1'),
    'my-org/custom-coder-v1',
  );
});
