import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createPreviewAiSession,
  isPrivateOrReservedIp,
  resolvePreviewAiSession,
  revokePreviewAiSession,
  SecurityValidationError,
  validateExternalUrlSyntax,
  verifyFirebaseJwtString,
} from './serverSecurity';
import {
  mapGeminiModels,
  mapGroqModels,
  mapOpenRouterModels,
} from './modelCatalogServer';

test('isPrivateOrReservedIp and validateExternalUrlSyntax block SSRF vectors', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.20.30.40'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('172.16.5.4'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);

  const blockedUrls = [
    'http://openrouter.ai/api/v1',
    'https://localhost:3000/v1',
    'https://127.0.0.1/v1',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.5/v1',
    'https://metadata.google.internal/computeMetadata/v1',
    'https://user:pass@openrouter.ai/api/v1',
    'file:///etc/passwd',
  ];

  for (const url of blockedUrls) {
    assert.throws(
      () => validateExternalUrlSyntax(url),
      SecurityValidationError,
      `Expected SSRF rejection for ${url}`,
    );
  }

  const parsed = validateExternalUrlSyntax('https://openrouter.ai/api/v1');
  assert.equal(parsed.hostname, 'openrouter.ai');
});

test('Preview AI session vault issues scoped tokens and revokes cleanly', () => {
  const { token, expiresAt } = createPreviewAiSession({
    provider: 'custom',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    apiKey: 'sk-or-v1-supersecret-preview-key',
  });

  assert.ok(token.startsWith('mist_sess_'));
  assert.ok(Date.parse(expiresAt) > Date.now());

  const resolved = resolvePreviewAiSession(token);
  assert.equal(resolved?.apiKey, 'sk-or-v1-supersecret-preview-key');
  assert.equal(resolved?.model, 'openrouter/free');

  assert.equal(revokePreviewAiSession(token), true);
  assert.equal(resolvePreviewAiSession(token), null);
  assert.equal(resolvePreviewAiSession('invalid-token'), null);
});

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signTestJwt(params: {
  privateKey: crypto.KeyObject;
  kid: string;
  payload: Record<string, unknown>;
}): string {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', kid: params.kid, typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(params.payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  signer.end();
  const sig = toBase64Url(signer.sign(params.privateKey));
  return `${header}.${body}.${sig}`;
}

test('verifyFirebaseJwtString verifies valid RS256 ID tokens and rejects tampered or wrong-project tokens', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const certsOverride = { 'test-kid-1': publicPem };
  const now = 1_800_000_000;

  const validJwt = signTestJwt({
    privateKey,
    kid: 'test-kid-1',
    payload: {
      aud: 'lithe-sensor-2v0ns',
      iss: 'https://securetoken.google.com/lithe-sensor-2v0ns',
      sub: 'user_abc_123',
      email: 'builder@example.com',
      email_verified: true,
      iat: now - 30,
      exp: now + 3600,
    },
  });

  const verified = await verifyFirebaseJwtString(validJwt, {
    expectedProjectId: 'lithe-sensor-2v0ns',
    certsOverride,
    nowSeconds: now,
  });
  assert.equal(verified.uid, 'user_abc_123');
  assert.equal(verified.email, 'builder@example.com');
  assert.equal(verified.emailVerified, true);

  // Wrong project / audience
  const wrongAudJwt = signTestJwt({
    privateKey,
    kid: 'test-kid-1',
    payload: {
      aud: 'other-project',
      iss: 'https://securetoken.google.com/lithe-sensor-2v0ns',
      sub: 'user_abc_123',
      iat: now - 30,
      exp: now + 3600,
    },
  });
  await assert.rejects(
    () =>
      verifyFirebaseJwtString(wrongAudJwt, {
        expectedProjectId: 'lithe-sensor-2v0ns',
        certsOverride,
        nowSeconds: now,
      }),
    SecurityValidationError,
  );

  // Expired token
  const expiredJwt = signTestJwt({
    privateKey,
    kid: 'test-kid-1',
    payload: {
      aud: 'lithe-sensor-2v0ns',
      iss: 'https://securetoken.google.com/lithe-sensor-2v0ns',
      sub: 'user_abc_123',
      iat: now - 7200,
      exp: now - 10,
    },
  });
  await assert.rejects(
    () =>
      verifyFirebaseJwtString(expiredJwt, {
        expectedProjectId: 'lithe-sensor-2v0ns',
        certsOverride,
        nowSeconds: now,
      }),
    SecurityValidationError,
  );
});

test('Live model mappers accurately classify Free vs Paid models and filter non-chat models', () => {
  const orModels = mapOpenRouterModels([
    {
      id: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
      name: 'NVIDIA: Llama 3.3 Nemotron Super 49B v1 (free)',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
      architecture: { output_modalities: ['text'] },
    },
    {
      id: 'openai/gpt-4.1',
      name: 'OpenAI: GPT-4.1',
      context_length: 1047576,
      pricing: { prompt: '0.000002', completion: '0.000008' },
      architecture: { output_modalities: ['text'] },
    },
    {
      id: 'black-forest-labs/flux.1-schnell',
      name: 'FLUX.1 Schnell',
      architecture: { output_modalities: ['image'] },
    },
  ]);

  assert.equal(orModels[0].id, 'openrouter/free');
  const nemotron = orModels.find((m) => m.id.includes('nemotron'))!;
  assert.equal(nemotron.billing, 'free');
  assert.equal(nemotron.billingLabel, 'Free');
  const gpt41 = orModels.find((m) => m.id === 'openai/gpt-4.1')!;
  assert.equal(gpt41.billing, 'paid');
  assert.equal(gpt41.billingLabel, 'Paid');
  assert.ok(gpt41.pricingSummary?.includes('$2.00/1M'));
  assert.equal(orModels.some((m) => m.id.includes('flux')), false);

  const groqModels = mapGroqModels([
    { id: 'llama-3.3-70b-versatile', active: true, context_window: 131072 },
    { id: 'whisper-large-v3', active: true },
    { id: 'moonshotai/kimi-k2-instruct', active: true, context_window: 131072 },
  ]);
  assert.equal(groqModels.some((m) => m.id.includes('whisper')), false);
  assert.equal(groqModels.find((m) => m.id === 'llama-3.3-70b-versatile')?.billing, 'free');
  assert.equal(groqModels.find((m) => m.id === 'moonshotai/kimi-k2-instruct')?.billing, 'paid');

  const geminiModels = mapGeminiModels([
    {
      name: 'models/gemini-2.5-flash',
      inputTokenLimit: 1048576,
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-2.5-pro',
      inputTokenLimit: 1048576,
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/text-embedding-004',
      supportedGenerationMethods: ['embedContent'],
    },
  ]);
  assert.equal(geminiModels.length, 2);
  assert.equal(geminiModels.find((m) => m.id === 'gemini-2.5-flash')?.billing, 'free');
  assert.equal(geminiModels.find((m) => m.id === 'gemini-2.5-pro')?.billing, 'paid');
});
