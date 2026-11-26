import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createMistApp } from './mistServerApp';
import { createMemoryDeploymentStore } from './deploymentStore';
import { executeSandboxTerminalCommand } from './mistSandboxRunner';
import type { ProjectFile } from '../types/mist';
import type { VerifiedFirebaseUser } from './serverSecurity';

function createMockUsers(): Record<string, VerifiedFirebaseUser> {
  return {
    'token-user-a': {
      userId: 'user-a',
      uid: 'user-a',
      email: 'alice@example.com',
      emailVerified: true,
      idToken: 'token-user-a',
    },
    'token-user-b': {
      userId: 'user-b',
      uid: 'user-b',
      email: 'bob@example.com',
      emailVerified: true,
      idToken: 'token-user-b',
    },
  };
}

function makeSampleProjectFiles(appTsxContent: string): ProjectFile[] {
  return [
    {
      id: 'f_app',
      path: 'src/App.tsx',
      language: 'tsx',
      content: appTsxContent,
    },
    {
      id: 'f_css',
      path: 'src/index.css',
      language: 'css',
      content: '@import "tailwindcss";\n',
    },
  ];
}

async function startTestApp(options?: {
  aiFetchImpl?: typeof fetch;
  mcpFetchImpl?: typeof fetch;
  renderFetchImpl?: typeof fetch;
  searchFetchImpl?: typeof fetch;
  skipDnsLookup?: boolean;
}) {
  const users = createMockUsers();
  const app = createMistApp({
    deploymentStore: createMemoryDeploymentStore(),
    skipDnsLookup: options?.skipDnsLookup ?? true,
    publishBaseUrl: 'https://sites.mist.me',
    aiRateLimitMax: 100,
    searchRateLimitMax: 100,
    renderRateLimitMax: 100,
    aiFetchImpl: options?.aiFetchImpl,
    mcpFetchImpl: options?.mcpFetchImpl,
    renderFetchImpl: options?.renderFetchImpl,
    searchFetchImpl: options?.searchFetchImpl,
    verifyAuthHeader: async (authHeader?: string) => {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Sign in required.');
      }
      const token = authHeader.slice('Bearer '.length).trim();
      const user = users[token];
      if (!user) throw new Error('Invalid token.');
      return user;
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

test('Isolated Sandbox Terminal rejects command injection, catches real tsc errors, runs isolated node scripts, and scrubs host secrets', async () => {
  const prevCanary = process.env.MIST_SECRET_CANARY;
  process.env.MIST_SECRET_CANARY = 'TOP_SECRET_HOST_VALUE_NEVER_LEAK';

  try {
    // 1. Command chaining / shell injection blocked cleanly
    await assert.rejects(
      () =>
        executeSandboxTerminalCommand({
          files: makeSampleProjectFiles('export default function App() { return <div>Ok</div>; }'),
          command: 'ls && rm -rf /',
        }),
      /disabled|disallowed|unsupported|rejected|blocked/i,
    );

    const unsupportedRes = await executeSandboxTerminalCommand({
      files: makeSampleProjectFiles('export default function App() { return <div>Ok</div>; }'),
      command: 'curl https://evil.example.com',
    });
    assert.notEqual(unsupportedRes.exitCode, 0);
    assert.match(unsupportedRes.stderr, /unsupported|available|sandbox/i);

    // 2. Real TypeScript compiler catches syntax & type errors in isolated sandbox
    const brokenFiles = makeSampleProjectFiles(`
import React from 'react';
export default function App() {
  const count: number = "not-a-number";
  return <div>{count}</div>
}
`);
    const badTsc = await executeSandboxTerminalCommand({
      files: brokenFiles,
      command: 'typecheck',
    });
    assert.notEqual(badTsc.exitCode, 0);
    assert.match(badTsc.stderr + badTsc.stdout, /TS2322|not-a-number|string|number/i);

    // 3. Passing build after fix
    const goodFiles = makeSampleProjectFiles(`
import React from 'react';
export default function App() {
  const count: number = 42;
  return <main className="p-4">Count: {count}</main>;
}
`);
    const goodTsc = await executeSandboxTerminalCommand({
      files: goodFiles,
      command: 'typecheck',
    });
    assert.equal(goodTsc.exitCode, 0, `Expected clean tsc, got: ${goodTsc.stderr}`);

    // 4. File inspection utilities (ls, cat, grep, wc) work on project workspace
    const lsRes = await executeSandboxTerminalCommand({ files: goodFiles, command: 'ls' });
    assert.equal(lsRes.exitCode, 0);
    assert.ok(lsRes.stdout.includes('src/App.tsx'));

    const grepRes = await executeSandboxTerminalCommand({ files: goodFiles, command: 'grep 42 src/App.tsx' });
    assert.equal(grepRes.exitCode, 0);
    assert.ok(grepRes.stdout.includes('const count: number = 42'));

    // 5. Node script execution runs inside isolated temp dir with scrubbed host secrets
    const scriptFiles: ProjectFile[] = [
      ...goodFiles,
      {
        id: 'f_script',
        path: 'src/check.ts',
        language: 'ts',
        content: `
console.log('CANARY=' + String(process.env.MIST_SECRET_CANARY));
console.log('MATH=' + (21 * 2));
`,
      },
    ];
    const nodeRes = await executeSandboxTerminalCommand({
      files: scriptFiles,
      command: 'node src/check.ts',
    });
    assert.equal(nodeRes.exitCode, 0, `Expected node sandbox success, got stderr: ${nodeRes.stderr}`);
    assert.ok(nodeRes.stdout.includes('MATH=42'));
    assert.ok(nodeRes.stdout.includes('CANARY=undefined'));
    assert.equal(nodeRes.stdout.includes('TOP_SECRET_HOST_VALUE_NEVER_LEAK'), false);
  } finally {
    if (prevCanary === undefined) {
      delete process.env.MIST_SECRET_CANARY;
    } else {
      process.env.MIST_SECRET_CANARY = prevCanary;
    }
  }
});

test('Agentic builder auto-detects build failure in sandbox terminal, self-repairs syntax error, and verifies clean build before finishing', async () => {
  let aiTurn = 0;
  let sawBuildFailureFeedback = false;

  const srv = await startTestApp({
    aiFetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      aiTurn += 1;
      const bodyStr = typeof init?.body === 'string' ? init.body : '';

      if (aiTurn === 1) {
        // Agent inspects App.tsx first
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'tc_read_1',
                      type: 'function',
                      function: {
                        name: 'read_file',
                        arguments: JSON.stringify({ path: 'src/App.tsx' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (aiTurn === 2) {
        // Agent writes code with a missing semicolon / broken TS syntax and immediately runs build
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'tc_edit_broken',
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({
                          path: 'src/App.tsx',
                          content: `import React from 'react';
export default function App() {
  const broken = "hello" const extra = 1;
  return <main>{broken} {extra}</main>;
}
`,
                        }),
                      },
                    },
                    {
                      id: 'tc_build_fail',
                      type: 'function',
                      function: {
                        name: 'run_terminal',
                        arguments: JSON.stringify({ command: 'build' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (aiTurn === 3) {
        // Verify real sandbox failure output reached the model in conversation history
        if (bodyStr.includes('exitCode') && /unexpected|expected|;/i.test(bodyStr)) {
          sawBuildFailureFeedback = true;
        }
        // Model fixes the semicolon bug and re-runs sandbox build
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'tc_edit_fix',
                      type: 'function',
                      function: {
                        name: 'edit_file',
                        arguments: JSON.stringify({
                          path: 'src/App.tsx',
                          target: '  const broken = "hello" const extra = 1;',
                          replacement: '  const broken = "hello";\n  const extra = 1;',
                        }),
                      },
                    },
                    {
                      id: 'tc_build_pass',
                      type: 'function',
                      function: {
                        name: 'run_terminal',
                        arguments: JSON.stringify({ command: 'build' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Final turn summary after clean build verification
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Fixed the missing semicolon and verified a clean sandbox build.',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  try {
    const resp = await fetch(`${srv.baseUrl}/api/ai/refine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        instruction: 'Update the App greeting safely',
        files: makeSampleProjectFiles(
          'import React from "react";\nexport default function App() { return <main>Initial</main>; }',
        ),
        providerConfig: {
          provider: 'custom',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-agent',
        },
      }),
    });

    assert.equal(resp.status, 200);
    const json = (await resp.json()) as {
      summary: string;
      buildVerified?: boolean;
      files: Array<{ path: string; content: string }>;
      terminalEntries?: Array<{ command: string; exitCode: number }>;
    };

    assert.equal(sawBuildFailureFeedback, true, 'Model must receive actual sandbox syntax error stderr');
    assert.equal(json.buildVerified, true);
    const appFile = json.files.find((f) => f.path === 'src/App.tsx');
    assert.ok(appFile?.content.includes('const broken = "hello";'));
    assert.ok((json.terminalEntries?.length || 0) >= 2);
    assert.notEqual(json.terminalEntries?.[0].exitCode, 0, 'First build must fail on missing semicolon');
    assert.equal(
      json.terminalEntries?.[json.terminalEntries.length - 1].exitCode,
      0,
      'Final build after self-repair must exit 0',
    );
  } finally {
    await srv.close();
  }
});

test('Multimodal /api/ai/verify-preview/stream delivers PNG screenshot and runtime console errors cleanly while stripping malicious payloads', async () => {
  const oneByOnePng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  let sawScreenshotPart = false;
  let sawRuntimeErrorText = false;
  let turnCount = 0;

  const srv = await startTestApp({
    aiFetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      turnCount += 1;
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(rawBody) as {
        messages?: Array<{ role: string; content: unknown }>;
      };

      const serializedMessages = JSON.stringify(parsed.messages || []);
      if (serializedMessages.includes('"type":"image_url"') && serializedMessages.includes(oneByOnePng)) {
        sawScreenshotPart = true;
      }
      if (serializedMessages.includes('ReferenceError: BrokenWidget is not defined')) {
        sawRuntimeErrorText = true;
      }

      if (turnCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'tc_fix_preview',
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({
                          path: 'src/App.tsx',
                          content: `import React from 'react';
export default function App() {
  return <main className="p-6">Fixed Preview Widget</main>;
}
`,
                        }),
                      },
                    },
                    {
                      id: 'tc_verify_build',
                      type: 'function',
                      function: {
                        name: 'run_terminal',
                        arguments: JSON.stringify({ command: 'build' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Resolved missing BrokenWidget crash and verified preview build.',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  try {
    const resp = await fetch(`${srv.baseUrl}/api/ai/verify-preview/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        instruction: 'Auto-repair runtime crash detected in live preview',
        files: makeSampleProjectFiles(
          'import React from "react";\nexport default function App() { return <BrokenWidget />; }',
        ),
        consoleEntries: [
          {
            id: 'log1',
            level: 'runtime_error',
            message: 'ReferenceError: BrokenWidget is not defined',
            source: 'src/App.tsx',
            line: 2,
            timestamp: new Date().toISOString(),
          },
        ],
        previewHealth: {
          capturedAt: new Date().toISOString(),
          rootHtmlLength: 0,
          textLength: 0,
          elementCount: 0,
          canvasCount: 0,
          horizontalOverflowPx: 0,
          viewportWidth: 1280,
          viewportHeight: 800,
          brokenImages: 0,
          runtimeErrorCount: 1,
          consoleErrorCount: 1,
        },
        screenshotDataUrl: oneByOnePng,
        providerConfig: {
          provider: 'custom',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          apiKey: 'sk-vision-key',
        },
      }),
    });

    assert.equal(resp.status, 200);
    const sseText = await resp.text();
    assert.ok(sseText.includes('"type":"complete"'));
    assert.equal(sawScreenshotPart, true, 'Model must receive multimodal image_url PNG frame');
    assert.equal(sawRuntimeErrorText, true, 'Model must receive runtime console error details');
    assert.ok(sseText.includes('Fixed Preview Widget'));

    // Non-PNG / malicious screenshot data URLs must be stripped cleanly before reaching the model
    sawScreenshotPart = false;
    turnCount = 0;
    const xssShotResp = await fetch(`${srv.baseUrl}/api/ai/verify-preview/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        instruction: 'Check layout safely',
        files: makeSampleProjectFiles(
          'import React from "react";\nexport default function App() { return <main>Safe</main>; }',
        ),
        screenshotDataUrl: 'data:text/html,<script>alert(1)</script>',
        providerConfig: {
          provider: 'custom',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          apiKey: 'sk-vision-key',
        },
      }),
    });
    assert.equal(xssShotResp.status, 200);
    await xssShotResp.text();
    assert.equal(sawScreenshotPart, false, 'Non-PNG screenshot URL must never be forwarded as image_url');
  } finally {
    await srv.close();
  }
});

test('Real HTTP MCP Server with OAuth 2.1 PKCE (RFC 9728/8414/7591), token refresh, tenant isolation, and sensitive-tool approval gate', async () => {
  // Real local MCP + OAuth 2.1 server listening on TCP port
  const issuedCodes = new Map<string, { codeChallenge: string; clientId: string; redirectUri: string }>();
  let currentAccessToken = 'mcp_tok_initial_1';
  let currentRefreshToken = 'mcp_ref_1';
  let tokenExpired = false;
  let deployCallCount = 0;
  let readCallCount = 0;

  const mcpHttpServer = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bodyStr = Buffer.concat(chunks).toString('utf8');

    const basePublicUrl = 'https://mcp-real-test.example';

    if (reqUrl.pathname === '/.well-known/oauth-protected-resource') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          resource: `${basePublicUrl}/mcp`,
          authorization_servers: [basePublicUrl],
        }),
      );
      return;
    }

    if (reqUrl.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: basePublicUrl,
          authorization_endpoint: `${basePublicUrl}/authorize`,
          token_endpoint: `${basePublicUrl}/token`,
          registration_endpoint: `${basePublicUrl}/register`,
          code_challenge_methods_supported: ['S256'],
          scopes_supported: ['mcp:tools', 'deploy:write'],
        }),
      );
      return;
    }

    if (reqUrl.pathname === '/register' && req.method === 'POST') {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ client_id: 'dyn_client_mist_1', token_endpoint_auth_method: 'none' }));
      return;
    }

    if (reqUrl.pathname === '/authorize') {
      const codeChallenge = reqUrl.searchParams.get('code_challenge') || '';
      const method = reqUrl.searchParams.get('code_challenge_method') || '';
      const clientId = reqUrl.searchParams.get('client_id') || '';
      const redirectUri = reqUrl.searchParams.get('redirect_uri') || '';
      assert.equal(method, 'S256');
      assert.equal(clientId, 'dyn_client_mist_1');
      const code = `auth_code_${crypto.randomBytes(6).toString('hex')}`;
      issuedCodes.set(code, { codeChallenge, clientId, redirectUri });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code }));
      return;
    }

    if (reqUrl.pathname === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(bodyStr);
      const grantType = params.get('grant_type');
      if (grantType === 'authorization_code') {
        const code = params.get('code') || '';
        const verifier = params.get('code_verifier') || '';
        const record = issuedCodes.get(code);
        if (!record) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        const computedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (computedChallenge !== record.codeChallenge) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_pkce_verifier' }));
          return;
        }
        issuedCodes.delete(code);
        tokenExpired = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: currentAccessToken,
            refresh_token: currentRefreshToken,
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
        return;
      }
      if (grantType === 'refresh_token') {
        if (params.get('refresh_token') !== currentRefreshToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        currentAccessToken = 'mcp_tok_refreshed_2';
        currentRefreshToken = 'mcp_ref_2';
        tokenExpired = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: currentAccessToken,
            refresh_token: currentRefreshToken,
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
        return;
      }
    }

    if (reqUrl.pathname === '/mcp' && req.method === 'POST') {
      const authHeader = req.headers.authorization || '';
      if (tokenExpired || authHeader !== `Bearer ${currentAccessToken}`) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${basePublicUrl}/.well-known/oauth-protected-resource"`,
        });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      const rpc = JSON.parse(bodyStr) as {
        id?: string | number;
        method: string;
        params?: Record<string, unknown>;
      };

      if (rpc.method === 'initialize') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'sess_real_mcp_1',
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2025-03-26',
              serverInfo: { name: 'RealTestMCP', version: '1.0.0' },
              capabilities: { tools: {} },
            },
          }),
        );
        return;
      }

      if (rpc.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }

      if (rpc.method === 'tools/list') {
        // Test real Streamable HTTP SSE format (`text/event-stream`)!
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id,
          result: {
            tools: [
              {
                name: 'list_services',
                description: 'List active cloud services (read-only)',
                inputSchema: { type: 'object', properties: {} },
                annotations: { readOnlyHint: true },
              },
              {
                name: 'deploy_service',
                description: 'Deploy production code to live service',
                inputSchema: {
                  type: 'object',
                  properties: { serviceId: { type: 'string' } },
                  required: ['serviceId'],
                },
                annotations: { destructiveHint: false, readOnlyHint: false },
              },
            ],
          },
        });
        res.end(`event: message\ndata: ${payload}\n\n`);
        return;
      }

      if (rpc.method === 'tools/call') {
        const name = String(rpc.params?.name || '');
        const toolArgs = (rpc.params?.arguments || {}) as Record<string, unknown>;
        if (name === 'list_services') {
          readCallCount += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                isError: false,
                content: [{ type: 'text', text: 'Services: srv_alpha (live), srv_beta (ready)' }],
              },
            }),
          );
          return;
        }
        if (name === 'deploy_service') {
          deployCallCount += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                isError: false,
                content: [{ type: 'text', text: `Triggered deploy for ${String(toolArgs.serviceId)}` }],
              },
            }),
          );
          return;
        }
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve) => mcpHttpServer.listen(0, '127.0.0.1', resolve));
  const mcpPort = (mcpHttpServer.address() as AddressInfo).port;
  const routeFetchToLocalMcp: typeof fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input.toString();
    const u = new URL(raw);
    const localUrl = `http://127.0.0.1:${mcpPort}${u.pathname}${u.search}`;
    return fetch(localUrl, init);
  };

  let aiStep = 0;
  const srv = await startTestApp({
    mcpFetchImpl: routeFetchToLocalMcp,
    aiFetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      aiStep += 1;
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      if (aiStep === 1) {
        // First invoke read-only MCP tool -> auto-executes without approval prompt
        assert.ok(bodyStr.includes('mcp_0_list_services'));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'tc_mcp_read',
                      type: 'function',
                      function: { name: 'mcp_0_list_services', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (aiStep === 2) {
        // Verify real MCP output reached model, now attempt sensitive mutating MCP deploy tool
        assert.ok(bodyStr.includes('srv_alpha (live)'));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'tc_mcp_deploy',
                      type: 'function',
                      function: {
                        name: 'mcp_0_deploy_service',
                        arguments: JSON.stringify({ serviceId: 'srv_alpha' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Checked services and executed approved MCP deployment.',
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch,
  });

  try {
    // 1. SSRF protection rejects private MCP URLs
    const ssrfResp = await fetch(`${srv.baseUrl}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({
        name: 'Internal Evil',
        url: 'http://127.0.0.1:9000/mcp',
        authType: 'none',
        enabled: true,
      }),
    });
    assert.equal(ssrfResp.status, 400);

    // 2. Save OAuth MCP server under Alice
    const createResp = await fetch(`${srv.baseUrl}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({
        id: 'mcp_real_1',
        name: 'Real Cloud MCP',
        url: 'https://mcp-real-test.example/mcp',
        authType: 'oauth2',
        transport: 'streamable_http',
        enabled: true,
      }),
    });
    assert.equal(createResp.status, 200);

    // 3. Start OAuth 2.1 PKCE discovery
    const oauthStartResp = await fetch(`${srv.baseUrl}/api/mcp/oauth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({ serverId: 'mcp_real_1' }),
    });
    assert.equal(oauthStartResp.status, 200);
    const { authorizeUrl } = (await oauthStartResp.json()) as { authorizeUrl: string };
    const authParsed = new URL(authorizeUrl);
    const state = authParsed.searchParams.get('state') || '';

    // Simulate user approving consent at real authorization server
    const authGrantResp = await routeFetchToLocalMcp(authorizeUrl);
    const { code } = (await authGrantResp.json()) as { code: string };

    // Callback exchanges code + PKCE verifier -> saves encrypted token in vault
    const cbResp = await fetch(
      `${srv.baseUrl}/api/mcp/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    );
    assert.equal(cbResp.status, 200);
    const cbHtml = await cbResp.text();
    assert.ok(cbHtml.includes('MIST_MCP_OAUTH_DONE'));

    // 4. Tenant Isolation: User B cannot see or test Alice's MCP server
    const bobList = await fetch(`${srv.baseUrl}/api/mcp/servers`, {
      headers: { Authorization: 'Bearer token-user-b' },
    });
    const bobJson = (await bobList.json()) as { servers: unknown[] };
    assert.equal(bobJson.servers.length, 0);

    const bobTest = await fetch(`${srv.baseUrl}/api/mcp/servers/mcp_real_1/test`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-user-b' },
    });
    assert.equal(bobTest.status, 404);

    // 5. Token expires -> 401 triggers automatic refresh_token rotation & retry!
    tokenExpired = true;
    const testConnResp = await fetch(`${srv.baseUrl}/api/mcp/servers/mcp_real_1/test`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-user-a' },
    });
    assert.equal(testConnResp.status, 200);
    const testConnJson = (await testConnResp.json()) as {
      ok: boolean;
      server: { tools?: Array<{ name: string }> };
    };
    assert.equal(testConnJson.ok, true);
    assert.deepEqual(
      (testConnJson.server.tools || []).map((t) => t.name),
      ['list_services', 'deploy_service'],
    );
    assert.equal(currentAccessToken, 'mcp_tok_refreshed_2', 'OAuth access token must auto-refresh');

    // 6. Streaming AI Builder triggers read tool automatically, pauses on sensitive deploy tool awaiting User Approval
    const aiStreamResp = await fetch(`${srv.baseUrl}/api/ai/refine/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({
        instruction: 'Check services and deploy srv_alpha',
        files: makeSampleProjectFiles(
          'import React from "react";\nexport default function App() { return <div>App</div>; }',
        ),
        providerConfig: {
          provider: 'custom',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-mcp-test',
        },
      }),
    });
    assert.equal(aiStreamResp.status, 200);

    const reader = aiStreamResp.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let approvalSolved = false;
    let streamText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      sseBuf += chunk;
      streamText += chunk;

      let nlIdx: number;
      while ((nlIdx = sseBuf.indexOf('\n')) !== -1) {
        const line = sseBuf.slice(0, nlIdx).trim();
        sseBuf = sseBuf.slice(nlIdx + 1);
        if (!line.startsWith('data:')) continue;
        let ev: { type?: string; approval?: { approvalId?: string } } | null = null;
        try {
          ev = JSON.parse(line.slice(5).trim()) as {
            type?: string;
            approval?: { approvalId?: string };
          };
        } catch {
          continue;
        }
        if (ev?.type === 'approval_required' && ev.approval?.approvalId && !approvalSolved) {
          approvalSolved = true;
          const approvalId = ev.approval.approvalId;
          assert.equal(deployCallCount, 0, 'Sensitive MCP action must NOT run before user approval');

          // User B cannot approve Alice's request!
          const bobApprove = await fetch(`${srv.baseUrl}/api/mcp/approvals/${approvalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-b' },
            body: JSON.stringify({ approved: true }),
          });
          assert.equal(bobApprove.status, 403);

          const aliceApprove = await fetch(`${srv.baseUrl}/api/mcp/approvals/${approvalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
            body: JSON.stringify({ approved: true }),
          });
          assert.equal(aliceApprove.status, 200);
        }
      }
    }

    assert.equal(readCallCount, 1);
    assert.equal(approvalSolved, true, 'SSE stream must emit approval_required event');
    assert.equal(deployCallCount, 1, 'Sensitive MCP tool must execute after Alice approves');
    assert.ok(streamText.includes('"type":"complete"'));
  } finally {
    await srv.close();
    await new Promise<void>((resolve) => mcpHttpServer.close(() => resolve()));
  }
});

test('Render account API integration lists live services and triggers real redeploy with failure honesty', async () => {
  let failDeployCall = false;
  const renderApiServer = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer rnd_valid_render_test_key_123456') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }

    if (reqUrl.pathname === '/v1/owners') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([{ owner: { id: 'own_1', name: 'Alice Workspace', email: 'alice@example.com', type: 'user' } }]),
      );
      return;
    }

    if (reqUrl.pathname === '/v1/services' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            service: {
              id: 'srv_static_1',
              name: 'mist-portfolio',
              ownerId: 'own_1',
              repo: 'https://github.com/alice/mist-portfolio',
              branch: 'main',
              serviceDetails: { url: 'https://mist-portfolio.onrender.com' },
              suspended: 'not_suspended',
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-11-01T00:00:00Z',
            },
          },
        ]),
      );
      return;
    }

    if (reqUrl.pathname === '/v1/services/srv_static_1/deploys' && req.method === 'POST') {
      if (failDeployCall) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Render upstream build queue unavailable' }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'dep_999', status: 'build_in_progress' }));
      return;
    }

    res.writeHead(404);
    res.end('{}');
  });

  await new Promise<void>((resolve) => renderApiServer.listen(0, '127.0.0.1', resolve));
  const rPort = (renderApiServer.address() as AddressInfo).port;
  const srv = await startTestApp({
    renderFetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === 'string' ? input : input.toString());
      return fetch(`http://127.0.0.1:${rPort}${u.pathname}${u.search}`, init);
    }) as typeof fetch,
  });

  try {
    const connResp = await fetch(`${srv.baseUrl}/api/render/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({ apiKey: 'rnd_valid_render_test_key_123456' }),
    });
    assert.equal(connResp.status, 200);

    const listResp = await fetch(`${srv.baseUrl}/api/render/services`, {
      headers: { Authorization: 'Bearer token-user-a' },
    });
    assert.equal(listResp.status, 200);
    const listJson = (await listResp.json()) as { services: Array<{ id: string; name: string }> };
    assert.equal(listJson.services.length, 1);
    assert.equal(listJson.services[0].id, 'srv_static_1');

    const deployResp = await fetch(`${srv.baseUrl}/api/render/services/srv_static_1/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({ clearCache: false }),
    });
    assert.equal(deployResp.status, 200);
    const deployJson = (await deployResp.json()) as { ok: boolean; deploy: { id: string; status: string } };
    assert.equal(deployJson.ok, true);
    assert.equal(deployJson.deploy.id, 'dep_999');

    // Render upstream failure must NEVER report fake success
    failDeployCall = true;
    const failedResp = await fetch(`${srv.baseUrl}/api/render/services/srv_static_1/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-user-a' },
      body: JSON.stringify({ clearCache: false }),
    });
    assert.equal(failedResp.status >= 400, true);
  } finally {
    await srv.close();
    await new Promise<void>((resolve) => renderApiServer.close(() => resolve()));
  }
});
