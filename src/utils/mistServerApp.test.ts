import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMistApp, bundleProjectToHtml } from './mistServerApp';
import { createMemoryDeploymentStore } from './deploymentStore';
import type { VerifiedFirebaseUser } from './serverSecurity';

function createMockUsers(): Record<string, VerifiedFirebaseUser> {
  return {
    'token-user-a': {
      uid: 'user-a',
      email: 'alice@example.com',
      emailVerified: true,
      idToken: 'token-user-a',
    },
    'token-user-b': {
      uid: 'user-b',
      email: 'bob@example.com',
      emailVerified: true,
      idToken: 'token-user-b',
    },
    'token-unverified': {
      uid: 'user-unverified',
      email: 'pending@example.com',
      emailVerified: false,
      idToken: 'token-unverified',
    },
  };
}

async function startTestServer(options?: {
  aiFetchImpl?: typeof fetch;
  searchFetchImpl?: typeof fetch;
  aiRateLimitMax?: number;
  searchRateLimitMax?: number;
  trustProxy?: boolean;
}) {
  const users = createMockUsers();
  const store = createMemoryDeploymentStore();
  const app = createMistApp({
    deploymentStore: store,
    skipDnsLookup: true,
    trustProxy: options?.trustProxy ?? false,
    aiRateLimitMax: options?.aiRateLimitMax ?? 50,
    searchRateLimitMax: options?.searchRateLimitMax ?? 50,
    searchFetchImpl: options?.searchFetchImpl,
    verifyAuthHeader: async (authHeader?: string) => {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Sign in required.');
      }
      const token = authHeader.slice('Bearer '.length).trim();
      const matched = users[token];
      if (!matched) throw new Error('Invalid token.');
      return matched;
    },
    aiFetchImpl:
      options?.aiFetchImpl ||
      (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('openrouter.ai/api/v1/models')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'openrouter/free',
                  name: 'OpenRouter Free',
                  pricing: { prompt: '0', completion: '0' },
                  architecture: { output_modalities: ['text'] },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('generativelanguage.googleapis.com/v1beta/models')) {
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
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

test('Backend routes enforce Firebase Auth and verified email on AI & deployment endpoints', async () => {
  const srv = await startTestServer();
  try {
    // Protected routes fail 401 when unauthenticated
    for (const [method, endpoint] of [
      ['POST', '/api/ai/models'],
      ['POST', '/api/ai/test-provider'],
      ['POST', '/api/ai/session'],
      ['POST', '/api/ai/generate'],
      ['POST', '/api/ai/generate/stream'],
      ['POST', '/api/ai/refine'],
      ['POST', '/api/ai/refine/stream'],
      ['POST', '/api/ai/voice-turn'],
      ['GET', '/api/deployments'],
      ['POST', '/api/deployments'],
    ] as const) {
      const resp = await fetch(`${srv.baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      assert.equal(resp.status, 401, `Expected 401 on unauthenticated ${method} ${endpoint}`);
    }

    // Unverified email gets 403
    const unverifiedResp = await fetch(`${srv.baseUrl}/api/deployments`, {
      headers: { Authorization: 'Bearer token-unverified' },
    });
    assert.equal(unverifiedResp.status, 403);

    // Public GET /api/ai/models only allows unkeyed OpenRouter catalog
    const groqPublicResp = await fetch(
      `${srv.baseUrl}/api/ai/models?baseUrl=${encodeURIComponent('https://api.groq.com/openai/v1')}`,
    );
    assert.equal(groqPublicResp.status, 401);

    const orPublicResp = await fetch(
      `${srv.baseUrl}/api/ai/models?baseUrl=${encodeURIComponent('https://openrouter.ai/api/v1')}`,
    );
    assert.equal(orPublicResp.status, 200);
    const orJson = (await orPublicResp.json()) as { source: string };
    assert.equal(orJson.source, 'live');

    // Authenticated POST /api/ai/models returns live Gemini 4 Hydrogen without modifying ID
    const geminiResp = await fetch(`${srv.baseUrl}/api/ai/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-mock-user-key',
      }),
    });
    assert.equal(geminiResp.status, 200);
    const geminiJson = (await geminiResp.json()) as { models: Array<{ id: string }> };
    assert.equal(geminiJson.models[0].id, 'gemini-4-hydrogen');

    // Authenticated POST /api/ai/test-provider verifies model & capabilities
    const testResp = await fetch(`${srv.baseUrl}/api/ai/test-provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        provider: 'custom',
        name: 'Gemini (BYOK)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-4-hydrogen',
        apiKey: 'AIza-mock-user-key',
      }),
    });
    assert.equal(testResp.status, 200);
    const testJson = (await testResp.json()) as { ok: boolean; verified: boolean };
    assert.equal(testJson.ok, true);
    assert.equal(testJson.verified, true);
  } finally {
    await srv.close();
  }
});

test('POST /api/ai/generate/stream streams SSE progress and returns validated generated files', async () => {
  const generatedPayload = JSON.stringify({
    projectName: 'Stream Test Site',
    description: 'Generated from stream',
    summary: 'Built src/App.tsx and src/index.css',
    files: [
      {
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'export default function App() { return <main>Ready</main>; }',
      },
      {
        path: 'src/index.css',
        language: 'css',
        content: '@import "tailwindcss";',
      },
    ],
  });

  const encoder = new TextEncoder();
  const srv = await startTestServer({
    aiFetchImpl: (async () => {
      const sse = new ReadableStream<Uint8Array>({
        start(controller) {
          const half = Math.floor(generatedPayload.length / 2);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: generatedPayload.slice(0, half) } }] })}\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: generatedPayload.slice(half) } }] })}\n`,
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n'));
          controller.close();
        },
      });
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch,
  });

  try {
    const resp = await fetch(`${srv.baseUrl}/api/ai/generate/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        prompt: 'Simple static site',
        providerConfig: {
          provider: 'custom',
          name: 'Gemini (BYOK)',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-4-hydrogen',
          apiKey: 'AIza-mock-user-key',
        },
      }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.text();
    assert.ok(body.includes('"type":"complete"'));
    assert.ok(body.includes('Stream Test Site'));
  } finally {
    await srv.close();
  }
});

test('Deployments isolate owner listings and enforce ownership while keeping published /p/:slug public', async () => {
  const srv = await startTestServer();
  try {
    const sampleFiles = [
      {
        id: 'f1',
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'export default function App() { return <h1>Alice App</h1>; }',
      },
      {
        id: 'f2',
        path: 'src/index.css',
        language: 'css',
        content: '@import "tailwindcss";',
      },
    ];

    // Alice publishes a deployment
    const createResp = await fetch(`${srv.baseUrl}/api/deployments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        slug: 'alice-site',
        projectId: 'proj_alice_1',
        title: 'Alice Portfolio',
        files: sampleFiles,
      }),
    });
    assert.equal(createResp.status, 200);

    // Public viewer fetches /p/alice-site without auth
    const publicResp = await fetch(`${srv.baseUrl}/p/alice-site`);
    assert.equal(publicResp.status, 200);
    const html = await publicResp.text();
    assert.ok(html.includes('Alice Portfolio'));

    // Alice sees her deployment in GET /api/deployments
    const aliceList = (await (
      await fetch(`${srv.baseUrl}/api/deployments`, {
        headers: { Authorization: 'Bearer token-user-a' },
      })
    ).json()) as { deployments: Array<{ slug: string }> };
    assert.equal(aliceList.deployments.length, 1);
    assert.equal(aliceList.deployments[0].slug, 'alice-site');

    // Bob sees 0 deployments in GET /api/deployments
    const bobList = (await (
      await fetch(`${srv.baseUrl}/api/deployments`, {
        headers: { Authorization: 'Bearer token-user-b' },
      })
    ).json()) as { deployments: Array<{ slug: string }> };
    assert.equal(bobList.deployments.length, 0);

    // Bob cannot overwrite Alice's slug
    const bobOverwrite = await fetch(`${srv.baseUrl}/api/deployments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-b',
      },
      body: JSON.stringify({
        slug: 'alice-site',
        projectId: 'proj_bob_1',
        title: 'Hijacked',
        files: sampleFiles,
      }),
    });
    assert.equal(bobOverwrite.status, 403);

    // Bob cannot delete Alice's deployment
    const bobDelete = await fetch(`${srv.baseUrl}/api/deployments/alice-site`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-user-b' },
    });
    assert.equal(bobDelete.status, 403);

    // Alice can delete her own deployment
    const aliceDelete = await fetch(`${srv.baseUrl}/api/deployments/alice-site`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-user-a' },
    });
    assert.equal(aliceDelete.status, 200);
  } finally {
    await srv.close();
  }
});

test('Rate limiter ignores spoofable X-Forwarded-For headers when trustProxy is disabled', async () => {
  const srv = await startTestServer({ aiRateLimitMax: 2, trustProxy: false });
  try {
    const callTest = (fakeIp: string) =>
      fetch(`${srv.baseUrl}/api/ai/test-provider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-user-a',
          'X-Forwarded-For': fakeIp,
        },
        body: JSON.stringify({
          provider: 'custom',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openrouter/free',
          apiKey: 'sk-or-mock',
        }),
      });

    assert.equal((await callTest('198.51.100.1')).status, 200);
    assert.equal((await callTest('198.51.100.2')).status, 200);
    // Spoofing a third X-Forwarded-For still hits the 2-request rate limit
    const third = await callTest('203.0.113.99');
    assert.equal(third.status, 429);
  } finally {
    await srv.close();
  }
});

test('bundleProjectToHtml isolates opaque preview sandbox without exposing direct localStorage or mist_sess tokens', async () => {
  const bundled = await bundleProjectToHtml({
    title: 'Sandbox Test',
    includeInspector: true,
    enableAppAi: true,
    files: [
      {
        id: '1',
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'export default function App() { return <div>Sandbox OK</div>; }',
      },
      {
        id: '2',
        path: 'src/index.css',
        language: 'css',
        content: '@import "tailwindcss";',
      },
    ],
  });
  assert.equal(bundled.bundleError, undefined);
  assert.ok(bundled.html.includes('MIST_APP_AI_REQUEST'));
  assert.ok(bundled.html.includes('MIST_SET_APP_AI_STATE'));
  assert.equal(bundled.html.includes('MIST_SET_BYOK_SESSION'), false);
  assert.ok(bundled.html.includes('e.source !== window.parent'));
});

test('POST /api/search and /api/search/test enforce auth, rate limits, and Brave key handling', async () => {
  const srv = await startTestServer({
    searchRateLimitMax: 3,
    searchFetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-Subscription-Token'), 'BSA_user_test_search_key_123');
      const u = new URL(typeof input === 'string' ? input : input.toString());
      return new Response(
        JSON.stringify({
          grounding: {
            generic: [
              {
                url: 'https://developer.mozilla.org/en-US/docs/Web',
                title: `MDN Docs for ${u.searchParams.get('q')}`,
                snippets: ['Verified web standards snippet.'],
                page_age: '2026-10-12',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  try {
    // Requires auth
    const unauth = await fetch(`${srv.baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'web specs' }),
    });
    assert.equal(unauth.status, 401);

    // /api/search/test returns verified count
    const testResp = await fetch(`${srv.baseUrl}/api/search/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        searchConfig: {
          provider: 'brave_llm_context',
          apiKey: 'BSA_user_test_search_key_123',
        },
      }),
    });
    assert.equal(testResp.status, 200);
    const testJson = (await testResp.json()) as { ok: boolean; verified: boolean; resultCount: number };
    assert.equal(testJson.ok, true);
    assert.equal(testJson.verified, true);
    assert.equal(testJson.resultCount, 1);

    // /api/search returns grounded WebSearchOutcome
    const searchResp = await fetch(`${srv.baseUrl}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        query: 'current css anchor positioning',
        searchConfig: {
          provider: 'brave_llm_context',
          apiKey: 'BSA_user_test_search_key_123',
        },
      }),
    });
    assert.equal(searchResp.status, 200);
    const searchJson = (await searchResp.json()) as {
      status: string;
      sources: Array<{ id: string; url: string; publishedDate?: string }>;
    };
    assert.equal(searchJson.status, 'performed');
    assert.equal(searchJson.sources[0].id, 'S1');
    assert.equal(searchJson.sources[0].publishedDate, '2026-10-12');

    // Rate limiter triggers on 4th request (searchRateLimitMax = 3)
    const thirdResp = await fetch(`${srv.baseUrl}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        query: 'q3',
        searchConfig: { provider: 'brave_llm_context', apiKey: 'BSA_user_test_search_key_123' },
      }),
    });
    assert.equal(thirdResp.status, 200);
    const fourthResp = await fetch(`${srv.baseUrl}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        query: 'q4',
        searchConfig: { provider: 'brave_llm_context', apiKey: 'BSA_user_test_search_key_123' },
      }),
    });
    assert.equal(fourthResp.status, 429);
  } finally {
    await srv.close();
  }
});

test('Provider-independent web search works identically across OpenRouter, Groq, Gemini BYOK, NVIDIA, OpenAI, and Custom endpoints, including follow-up search and search failure honesty', async () => {
  const searchApiSecret = 'BSA_SECRET_NEVER_EXPOSE_987654321';
  let searchCallCount = 0;
  let forceSearchFailure = false;
  let enableFollowUpFlow = false;

  const srv = await startTestServer({
    searchFetchImpl: (async (input: RequestInfo | URL) => {
      searchCallCount += 1;
      if (forceSearchFailure) {
        return new Response('Invalid search token', { status: 401 });
      }
      const u = new URL(typeof input === 'string' ? input : input.toString());
      const q = u.searchParams.get('q') || '';
      return new Response(
        JSON.stringify({
          grounding: {
            generic: [
              {
                url: `https://news.example.org/item-${searchCallCount}`,
                title: `Verified Result ${searchCallCount} (${q.slice(0, 20)})`,
                snippets: [`Fact ${searchCallCount} extracted cleanly.`],
                page_age: '2026-11-10',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
    aiFetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      assert.equal(
        bodyStr.includes(searchApiSecret),
        false,
        'Search API key must NEVER be forwarded to LLM provider',
      );
      const parsedBody = JSON.parse(bodyStr) as {
        messages?: Array<{ role: string; content: string }>;
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
      };
      const userText =
        parsedBody.messages?.map((m) => m.content).join('\n') ||
        parsedBody.contents?.flatMap((c) => c.parts?.map((p) => p.text || '') || []).join('\n') ||
        '';

      // Follow-up search step when prompted with allowFollowUpSearch
      if (
        enableFollowUpFlow &&
        userText.includes('FOLLOW-UP SEARCH OPTION') &&
        !userText.includes('item-2')
      ) {
        const followUp = JSON.stringify({
          action: 'search_more',
          queries: ['exact 2026 release notes'],
          reason: 'Need version number details',
        });
        return new Response(
          JSON.stringify({ choices: [{ message: { content: followUp } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const payload = JSON.stringify({
        projectName: 'Research App',
        description: 'Built with live web context',
        summary: 'Retrieved context summary citing [S1] and invalid [S99].',
        files: [
          {
            path: 'src/App.tsx',
            language: 'tsx',
            content: 'export default function App() { return <main>Live Grounded</main>; }',
          },
          {
            path: 'src/index.css',
            language: 'css',
            content: '@import "tailwindcss";',
          },
        ],
      });

      const isGeminiNative = _input.toString().includes('generativelanguage.googleapis.com/v1beta/models');
      if (isGeminiNative) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: payload }] } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ choices: [{ message: { content: payload } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  try {
    const providers = [
      { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
      { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
      { name: 'Gemini (BYOK)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-4-hydrogen' },
      { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/llama-3.1-nemotron-70b-instruct' },
      { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      { name: 'Custom Gateway', baseUrl: 'https://llm.custom-proxy.example/v1', model: 'custom-model' },
    ];

    for (const p of providers) {
      const before = searchCallCount;
      const genResp = await fetch(`${srv.baseUrl}/api/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-user-a',
        },
        body: JSON.stringify({
          prompt: 'Build an overview page using current 2026 specifications',
          searchMode: 'on',
          searchConfig: {
            provider: 'brave_llm_context',
            apiKey: searchApiSecret,
          },
          providerConfig: {
            provider: 'custom',
            name: p.name,
            baseUrl: p.baseUrl,
            model: p.model,
            apiKey: 'llm-provider-key',
          },
        }),
      });
      assert.equal(genResp.status, 200, `Provider ${p.name} should succeed with shared web search`);
      const genJson = (await genResp.json()) as {
        summary: string;
        files: Array<{ content: string }>;
        searchOutcome: { status: string; citedIds: string[]; sources: Array<{ id: string }> };
      };
      assert.equal(searchCallCount, before + 1);
      assert.equal(genJson.searchOutcome.status, 'performed');
      assert.deepEqual(genJson.searchOutcome.citedIds, ['S1']);
      assert.equal(genJson.summary.includes('[S99]'), false, 'Hallucinated [S99] must be stripped');
      assert.equal(
        genJson.files.some((f) => f.content.includes(searchApiSecret)),
        false,
        'Search API key must never appear in generated files',
      );
    }

    // Search Off triggers zero search requests
    const countBeforeOff = searchCallCount;
    const offResp = await fetch(`${srv.baseUrl}/api/ai/refine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        instruction: 'Update heading to 2026 edition',
        searchMode: 'off',
        searchConfig: { provider: 'brave_llm_context', apiKey: searchApiSecret },
        files: [
          { id: 'f1', path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){return <h1/>;}' },
          { id: 'f2', path: 'src/index.css', language: 'css', content: '@import "tailwindcss";' },
        ],
        providerConfig: {
          provider: 'custom',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openrouter/free',
          apiKey: 'llm-key',
        },
      }),
    });
    assert.equal(offResp.status, 200);
    assert.equal(searchCallCount, countBeforeOff);
    const offJson = (await offResp.json()) as { searchOutcome: { status: string } };
    assert.equal(offJson.searchOutcome.status, 'skipped');

    // Follow-up search_more protocol works without native LLM tool calling
    enableFollowUpFlow = true;
    const countBeforeFollowUp = searchCallCount;
    const followUpResp = await fetch(`${srv.baseUrl}/api/ai/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        prompt: 'Latest framework updates',
        searchMode: 'on',
        searchConfig: { provider: 'brave_llm_context', apiKey: searchApiSecret },
        providerConfig: {
          provider: 'custom',
          name: 'Groq',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'llama-3.3-70b-versatile',
          apiKey: 'llm-key',
        },
      }),
    });
    assert.equal(followUpResp.status, 200);
    const followUpJson = (await followUpResp.json()) as {
      searchOutcome: { status: string; queries: string[]; sources: Array<{ id: string }> };
    };
    assert.equal(searchCallCount, countBeforeFollowUp + 2);
    assert.equal(followUpJson.searchOutcome.sources.length, 2);
    assert.ok(followUpJson.searchOutcome.queries.includes('exact 2026 release notes'));
    enableFollowUpFlow = false;

    // When search fails (e.g. invalid Brave key), searchOutcome reports failure honestly with zero fake sources & strips [S1]
    forceSearchFailure = true;
    const failResp = await fetch(`${srv.baseUrl}/api/ai/refine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        instruction: 'Use live web info',
        searchMode: 'on',
        searchConfig: { provider: 'brave_llm_context', apiKey: searchApiSecret },
        files: [
          { id: 'f1', path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){return <h1/>;}' },
          { id: 'f2', path: 'src/index.css', language: 'css', content: '@import "tailwindcss";' },
        ],
        providerConfig: {
          provider: 'custom',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'llm-key',
        },
      }),
    });
    assert.equal(failResp.status, 200);
    const failJson = (await failResp.json()) as {
      summary: string;
      searchOutcome: { status: string; sources: unknown[]; citedIds: string[]; error?: string };
    };
    assert.equal(failJson.searchOutcome.status, 'failed');
    assert.equal(failJson.searchOutcome.sources.length, 0);
    assert.equal(failJson.searchOutcome.citedIds.length, 0);
    assert.equal(failJson.summary.includes('[S1]'), false);
    assert.ok(failJson.searchOutcome.error?.includes('rejected the search API key'));
  } finally {
    await srv.close();
  }
});

test('POST /api/ai/generate/stream emits search_start, search_results, and complete searchOutcome events', async () => {
  const generatedPayload = JSON.stringify({
    projectName: 'Stream Grounded App',
    description: 'Uses live search stream',
    summary: 'Built using live research [S1].',
    files: [
      {
        path: 'src/App.tsx',
        language: 'tsx',
        content: 'export default function App() { return <main>Streamed</main>; }',
      },
      {
        path: 'src/index.css',
        language: 'css',
        content: '@import "tailwindcss";',
      },
    ],
  });

  const encoder = new TextEncoder();
  const srv = await startTestServer({
    searchFetchImpl: (async () =>
      new Response(
        JSON.stringify({
          grounding: {
            generic: [
              {
                url: 'https://example.org/spec-2026',
                title: '2026 Live Spec',
                snippets: ['Verified SSE web context.'],
                page_age: '2026-11-12',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch,
    aiFetchImpl: (async () => {
      const sse = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: generatedPayload } }] })}\n`,
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n'));
          controller.close();
        },
      });
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch,
  });

  try {
    const resp = await fetch(`${srv.baseUrl}/api/ai/generate/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        prompt: 'Build a dashboard with the latest 2026 live specs',
        searchMode: 'auto',
        searchConfig: {
          provider: 'brave_llm_context',
          apiKey: 'BSA_stream_test_key_123456',
        },
        providerConfig: {
          provider: 'custom',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openrouter/free',
          apiKey: 'sk-or-test',
        },
      }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.text();
    assert.ok(body.includes('"type":"search_start"'));
    assert.ok(body.includes('"type":"search_results"'));
    assert.ok(body.includes('2026 Live Spec'));
    assert.ok(body.includes('"type":"complete"'));
    assert.ok(body.includes('"citedIds":["S1"]'));
  } finally {
    await srv.close();
  }
});
