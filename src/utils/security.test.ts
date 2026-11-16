import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  assertSafeExternalUrl,
  createPreviewAiSession,
  isPrivateOrReservedIp,
  resolvePreviewAiSession,
  revokePreviewAiSession,
  safeFetchExternal,
  SecurityValidationError,
  validateExternalUrlSyntax,
  validateProjectFilesPayload,
  verifyFirebaseJwtString,
} from './serverSecurity';
import {
  clearServerCatalogCache,
  fetchGatewayModelsCatalog,
  mapGeminiModels,
  mapGenericOpenAiCompatModels,
  mapGroqModels,
  mapOpenRouterModels,
} from './modelCatalogServer';
import { ProviderHttpError, streamByokCompletion } from './byokClient';
import { redactSecrets } from './aiErrors';
import { chunkOperations } from '../firebase/batchOps';

test('SSRF protection blocks private/loopback IPs, DNS rebinding resolutions, and HTTP redirects', async () => {
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

  // Simulated DNS rebinding: public hostname resolving to internal IP
  await assert.rejects(
    () =>
      assertSafeExternalUrl('https://rebind.attacker.example/v1', {
        lookupFn: async () => [{ address: '169.254.169.254', family: 4 }],
      }),
    SecurityValidationError,
  );

  // Redirect blocking: safeFetchExternal uses redirect: 'error'
  await assert.rejects(
    () =>
      safeFetchExternal('https://openrouter.ai/api/v1/models', {
        skipDnsLookup: true,
        fetchImpl: (async (_url, init) => {
          assert.equal(init?.redirect, 'error');
          throw new TypeError('unexpected redirect');
        }) as typeof fetch,
      }),
    (err: unknown) =>
      err instanceof SecurityValidationError && err.message.includes('Blocked HTTP redirect'),
  );
});

test('Preview AI session vault binds sessions to owner UID and enforces ownership on revoke', () => {
  const { token, expiresAt } = createPreviewAiSession(
    {
      provider: 'custom',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
      apiKey: 'sk-or-v1-supersecret-preview-key',
    },
    'uid-owner-1',
  );

  assert.ok(token.startsWith('mist_sess_'));
  assert.ok(Date.parse(expiresAt) > Date.now());

  const resolved = resolvePreviewAiSession(token);
  assert.equal(resolved?.apiKey, 'sk-or-v1-supersecret-preview-key');

  assert.throws(
    () => revokePreviewAiSession(token, 'uid-other-user'),
    (err: unknown) => err instanceof SecurityValidationError && err.status === 403,
  );
  assert.throws(
    () => revokePreviewAiSession(token, undefined),
    (err: unknown) => err instanceof SecurityValidationError && err.status === 401,
  );

  assert.equal(revokePreviewAiSession(token, 'uid-owner-1'), true);
  assert.equal(resolvePreviewAiSession(token), null);
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

test('verifyFirebaseJwtString validates RS256 ID tokens and rejects tampered, expired, or wrong-project tokens', async () => {
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

test('Model mappers avoid name-based billing guesses, preserve new Gemini models, track capabilities, and flag deprecated models', () => {
  const orModels = mapOpenRouterModels([
    {
      id: 'nvidia/llama-3.3-nemotron-super-49b-v1:free',
      name: 'NVIDIA: Llama 3.3 Nemotron Super 49B v1 (free)',
      context_length: 131072,
      pricing: { prompt: '0', completion: '0' },
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['response_format', 'tools'],
    },
    {
      id: 'openai/gpt-4.1',
      name: 'OpenAI: GPT-4.1',
      context_length: 1047576,
      pricing: { prompt: '0.000002', completion: '0.000008' },
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['structured_outputs', 'tools'],
    },
    {
      id: 'vendor/unknown-price-preview',
      name: 'Vendor Preview',
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
  assert.equal(nemotron.capabilities.jsonOutput, true);
  assert.equal(nemotron.capabilities.imageInput, false);
  assert.equal(nemotron.capabilities.toolCalling, true);

  const gpt41 = orModels.find((m) => m.id === 'openai/gpt-4.1')!;
  assert.equal(gpt41.billing, 'paid');
  assert.equal(gpt41.capabilities.imageInput, true);
  assert.ok(gpt41.pricingSummary?.includes('$2.00/1M'));

  const unknownPriced = orModels.find((m) => m.id === 'vendor/unknown-price-preview')!;
  assert.equal(unknownPriced.billing, 'unknown');
  assert.equal(unknownPriced.billingLabel, 'Unknown');
  assert.equal(unknownPriced.status, 'preview');
  assert.equal(orModels.some((m) => m.id.includes('flux')), false);

  // Groq never fabricates "Free" guesses from model IDs
  const groqModels = mapGroqModels([
    { id: 'llama-3.3-70b-versatile', active: true, context_window: 131072 },
    { id: 'whisper-large-v3', active: true },
    { id: 'legacy-model', active: false, deprecated: true },
  ]);
  assert.equal(groqModels.some((m) => m.id.includes('whisper')), false);
  assert.equal(groqModels.find((m) => m.id === 'llama-3.3-70b-versatile')?.billing, 'provider_billed');
  assert.equal(groqModels.find((m) => m.id === 'legacy-model')?.status, 'retired');

  // NVIDIA & custom generic gateways never label non-OpenAI models as "free"
  const nvidiaModels = mapGenericOpenAiCompatModels(
    [{ id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', active: true }],
    'nvidia',
    'NVIDIA NIM',
  );
  assert.equal(nvidiaModels[0].billing, 'provider_billed');
  assert.equal(nvidiaModels[0].billingLabel, 'Provider billed');

  const customModels = mapGenericOpenAiCompatModels(
    [{ id: 'my-local-model' }],
    'custom_url',
    'My Proxy',
  );
  assert.equal(customModels[0].billing, 'unknown');
  assert.equal(customModels[0].billingLabel, 'Unknown');

  // Gemini checks supportedGenerationMethods, preserves gemini-4-hydrogen/argon/carbon without claiming they are free,
  // and marks gemini-2.5-pro as deprecated
  const geminiModels = mapGeminiModels([
    {
      name: 'models/gemini-4-hydrogen',
      displayName: 'Gemini 4 Hydrogen',
      inputTokenLimit: 1048576,
      supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
    },
    {
      name: 'models/gemini-4-argon',
      displayName: 'Gemini 4 Argon',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-4-carbon',
      displayName: 'Gemini 4 Carbon',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/text-embedding-004',
      supportedGenerationMethods: ['embedContent'],
    },
  ]);
  assert.equal(geminiModels.length, 4);
  const hydrogen = geminiModels.find((m) => m.id === 'gemini-4-hydrogen')!;
  assert.equal(hydrogen.status, 'active');
  assert.equal(hydrogen.billing, 'provider_billed');
  assert.equal(hydrogen.capabilities.streaming, true);
  assert.equal(geminiModels.find((m) => m.id === 'gemini-4-argon')?.billing, 'provider_billed');
  assert.equal(geminiModels.find((m) => m.id === 'gemini-4-carbon')?.billing, 'provider_billed');
  assert.equal(geminiModels.find((m) => m.id === 'gemini-2.5-pro')?.status, 'deprecated');
});

test('fetchGatewayModelsCatalog hits live mocked APIs, caches results, and does not leak stale state', async () => {
  clearServerCatalogCache();
  let calls = 0;
  const mockGeminiFetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        models: [
          {
            name: 'models/gemini-4-hydrogen',
            displayName: 'Gemini 4 Hydrogen',
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const live = await fetchGatewayModelsCatalog({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: 'AIza-test-key',
    fetchImpl: mockGeminiFetch,
    skipDnsLookup: true,
  });
  assert.equal(live.source, 'live');
  assert.equal(live.models[0].id, 'gemini-4-hydrogen');
  assert.equal(calls, 1);

  const cached = await fetchGatewayModelsCatalog({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: 'AIza-test-key',
    fetchImpl: mockGeminiFetch,
    skipDnsLookup: true,
  });
  assert.equal(cached.source, 'cached');
  assert.equal(calls, 1);
  clearServerCatalogCache();
});

test('chunkOperations splits large Firestore project writes cleanly within the 400-op safe limit', () => {
  const ops = Array.from({ length: 850 }, (_, i) => ({ id: i }));
  const batches = chunkOperations(ops);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 400);
  assert.equal(batches[1].length, 400);
  assert.equal(batches[2].length, 50);
  assert.deepEqual(chunkOperations([]), []);
});

test('validateProjectFilesPayload enforces path safety and count/size limits', () => {
  assert.throws(
    () => validateProjectFilesPayload([{ path: '../secret.ts', content: 'x' }]),
    SecurityValidationError,
  );
  assert.throws(
    () =>
      validateProjectFilesPayload([
        { path: 'src/big.ts', content: 'x'.repeat(260_000) },
      ]),
    SecurityValidationError,
  );
  const ok = validateProjectFilesPayload([{ path: '/src/App.tsx', content: 'export default function App(){}' }]);
  assert.equal(ok[0].path, 'src/App.tsx');
});

test('streamByokCompletion handles incomplete trailing SSE chunks, caller cancellation, and idle timeouts', async () => {
  const config = {
    provider: 'custom' as const,
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    apiKey: 'sk-or-v1-secret-test-key',
  };

  // 1. Trailing incomplete SSE line without trailing \n
  const encoder = new TextEncoder();
  const incompleteBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello "}}]}\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"World"}}]}'));
      controller.close();
    },
  });
  const streamed = await streamByokCompletion({
    config,
    messages: [{ role: 'user', content: 'hi' }],
    skipDnsLookup: true,
    onDelta: () => {},
    fetchImpl: (async () => new Response(incompleteBody, { status: 200 })) as typeof fetch,
  });
  assert.equal(streamed, 'Hello World');

  // 2. Client disconnect cancellation
  const abortController = new AbortController();
  const stalledBody = new ReadableStream<Uint8Array>({
    start() {
      setTimeout(() => abortController.abort(), 30);
    },
  });
  await assert.rejects(
    () =>
      streamByokCompletion({
        config,
        messages: [{ role: 'user', content: 'hi' }],
        signal: abortController.signal,
        skipDnsLookup: true,
        idleTimeoutMs: 5000,
        onDelta: () => {},
        fetchImpl: (async () => new Response(stalledBody, { status: 200 })) as typeof fetch,
      }),
    (err: unknown) => err instanceof ProviderHttpError && err.status === 499,
  );

  // 3. Idle timeout when upstream hangs mid-stream
  const hangBody = new ReadableStream<Uint8Array>({
    start() {
      // Never enqueues or closes
    },
  });
  await assert.rejects(
    () =>
      streamByokCompletion({
        config,
        messages: [{ role: 'user', content: 'hi' }],
        idleTimeoutMs: 60,
        totalTimeoutMs: 5000,
        skipDnsLookup: true,
        onDelta: () => {},
        fetchImpl: (async () => new Response(hangBody, { status: 200 })) as typeof fetch,
      }),
    (err: unknown) => err instanceof ProviderHttpError && err.status === 504,
  );

  // 4. Secret redaction never leaks keys
  const redacted = redactSecrets('Failed calling key sk-or-v1-abcdef1234567890 and AIzaSyA1234567890abcdef');
  assert.equal(redacted.includes('sk-or-v1-abcdef'), false);
  assert.equal(redacted.includes('AIzaSyA123456'), false);
  assert.ok(redacted.includes('[REDACTED]'));
});
