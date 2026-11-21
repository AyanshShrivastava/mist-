import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  isValidSlug,
  extractSubdomain,
  getContentType,
  render404Page,
  handlePublishedSite,
  proxyToHeroku,
  RESERVED_SUBDOMAINS,
  type Env,
} from './index';

test('isValidSlug validates correct DNS slugs and rejects invalid formats', () => {
  // Valid
  assert.equal(isValidSlug('my-portfolio'), true);
  assert.equal(isValidSlug('alpha123'), true);
  assert.equal(isValidSlug('site-v2-test'), true);
  assert.equal(isValidSlug('abc'), true);

  // Invalid: length bounds
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug('ab'), false); // min 3 chars
  assert.equal(isValidSlug('a'.repeat(64)), false); // max 63 chars

  // Invalid: characters
  assert.equal(isValidSlug('My-Site'), false); // uppercase
  assert.equal(isValidSlug('site_test'), false); // underscores
  assert.equal(isValidSlug('site.test'), false); // dots
  assert.equal(isValidSlug('site test'), false); // spaces

  // Invalid: leading/trailing/consecutive hyphens
  assert.equal(isValidSlug('-site'), false);
  assert.equal(isValidSlug('site-'), false);
  assert.equal(isValidSlug('site--test'), false);
});

test('extractSubdomain distinguishes apex domain from subdomains correctly', () => {
  // Apex cases
  assert.deepEqual(extractSubdomain('mist.me', 'mist.me'), { isApex: true, subdomain: null });
  assert.deepEqual(extractSubdomain('MIST.ME', 'mist.me'), { isApex: true, subdomain: null });
  assert.deepEqual(extractSubdomain('localhost', 'mist.me'), { isApex: true, subdomain: null });
  assert.deepEqual(extractSubdomain('127.0.0.1', 'mist.me'), { isApex: true, subdomain: null });

  // Subdomain cases
  assert.deepEqual(extractSubdomain('my-app.mist.me', 'mist.me'), { isApex: false, subdomain: 'my-app' });
  assert.deepEqual(extractSubdomain('www.mist.me', 'mist.me'), { isApex: false, subdomain: 'www' });
  assert.deepEqual(extractSubdomain('api.mist.me', 'mist.me'), { isApex: false, subdomain: 'api' });
  assert.deepEqual(extractSubdomain('test-site.localhost', 'mist.me'), { isApex: false, subdomain: 'test-site' });
});

test('getContentType maps file extensions to correct MIME types', () => {
  assert.equal(getContentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(getContentType('style.css'), 'text/css; charset=utf-8');
  assert.equal(getContentType('bundle.js'), 'application/javascript; charset=utf-8');
  assert.equal(getContentType('data.json'), 'application/json; charset=utf-8');
  assert.equal(getContentType('logo.svg'), 'image/svg+xml');
  assert.equal(getContentType('photo.png'), 'image/png');
  assert.equal(getContentType('binary.wasm'), 'application/octet-stream');
});

test('render404Page returns branded HTML 404 response', async () => {
  const res = render404Page('missing-project', 'mist.me');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const text = await res.text();
  assert.match(text, /404 NOT FOUND/);
  assert.match(text, /missing-project\.mist\.me/);
  assert.match(text, /Create on Mist/);
});

test('handlePublishedSite enforces reserved subdomains and format validation', async () => {
  const env: Env = {
    APEX_DOMAIN: 'mist.me',
    PUBLISHED_BUCKET: {
      get: async () => null,
    },
  };

  // 1. Reserved subdomain: www -> redirects to apex
  const wwwReq = new Request('https://www.mist.me/some/path');
  const wwwRes = await handlePublishedSite('www', wwwReq, new URL(wwwReq.url), env);
  assert.equal(wwwRes.status, 301);
  assert.equal(wwwRes.headers.get('location'), 'https://mist.me/some/path');

  // 2. Reserved subdomains: auth, admin, dashboard, assets, status, mail -> 403 Forbidden
  for (const reserved of ['auth', 'admin', 'dashboard', 'assets', 'status', 'mail']) {
    const req = new Request(`https://${reserved}.mist.me/`);
    const res = await handlePublishedSite(reserved, req, new URL(req.url), env);
    assert.equal(res.status, 403, `Subdomain ${reserved} should return 403`);
    const text = await res.text();
    assert.match(text, /reserved subdomain/i);
  }

  // 3. Invalid slug: too short or bad chars -> 400 Bad Request
  const badReq = new Request('https://bad--slug.mist.me/');
  const badRes = await handlePublishedSite('bad--slug', badReq, new URL(badReq.url), env);
  assert.equal(badRes.status, 400);

  // 4. Disallow non-GET/HEAD methods
  const postReq = new Request('https://valid-slug.mist.me/', { method: 'POST' });
  const postRes = await handlePublishedSite('valid-slug', postReq, new URL(postReq.url), env);
  assert.equal(postRes.status, 405);
});

test('handlePublishedSite serves R2 artifact and supports SPA fallback', async () => {
  const r2Storage = new Map<string, string>();
  r2Storage.set('sites/my-site/index.html', '<!DOCTYPE html><html><body>Published HTML</body></html>');
  r2Storage.set('sites/my-site/styles.css', 'body { color: blue; }');

  const env: Env = {
    APEX_DOMAIN: 'mist.me',
    PUBLISHED_BUCKET: {
      get: async (key: string) => {
        const content = r2Storage.get(key);
        if (!content) return null;
        return {
          body: new Response(content).body!,
          httpEtag: '"mock-etag-123"',
          httpMetadata: { contentType: getContentType(key) },
        };
      },
    },
  };

  // 1. Root index.html request
  const rootReq = new Request('https://my-site.mist.me/');
  const rootRes = await handlePublishedSite('my-site', rootReq, new URL(rootReq.url), env);
  assert.equal(rootRes.status, 200);
  assert.equal(rootRes.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(rootRes.headers.get('etag'), '"mock-etag-123"');
  assert.match(rootRes.headers.get('cache-control') || '', /public/);
  const rootBody = await rootRes.text();
  assert.match(rootBody, /Published HTML/);

  // 2. Specific sub-resource request (styles.css)
  const cssReq = new Request('https://my-site.mist.me/styles.css');
  const cssRes = await handlePublishedSite('my-site', cssReq, new URL(cssReq.url), env);
  assert.equal(cssRes.status, 200);
  assert.equal(cssRes.headers.get('content-type'), 'text/css; charset=utf-8');
  const cssBody = await cssRes.text();
  assert.equal(cssBody, 'body { color: blue; }');

  // 3. SPA Route fallback (e.g. /dashboard/profile -> falls back to index.html)
  const spaReq = new Request('https://my-site.mist.me/dashboard/profile');
  const spaRes = await handlePublishedSite('my-site', spaReq, new URL(spaReq.url), env);
  assert.equal(spaRes.status, 200);
  assert.equal(spaRes.headers.get('content-type'), 'text/html; charset=utf-8');
  const spaBody = await spaRes.text();
  assert.match(spaBody, /Published HTML/);

  // 4. Missing project -> returns 404 page
  const missingReq = new Request('https://non-existent-site.mist.me/');
  const missingRes = await handlePublishedSite('non-existent-site', missingReq, new URL(missingReq.url), env);
  assert.equal(missingRes.status, 404);
  const missingBody = await missingRes.text();
  assert.match(missingBody, /Project Unavailable/);
});

test('proxyToHeroku sanitizes client headers, attaches edge origin secret, and preserves SSE streaming', async () => {
  let capturedTargetUrl = '';
  let capturedHeaders: Headers | null = null;
  let capturedMethod = '';

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedTargetUrl = input.toString();
      capturedHeaders = new Headers(init?.headers);
      capturedMethod = init?.method || 'GET';

      // Simulate Heroku SSE response
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"status":"generating"}\n\n'));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }) as any;

    const env: Env = {
      HEROKU_API_ORIGIN: 'https://mist-heroku-api.internal',
      MIST_EDGE_ORIGIN_SECRET: 'super-edge-secret-456',
      APEX_DOMAIN: 'mist.me',
    };

    const clientReq = new Request('https://mist.me/api/ai/generate/stream?model=auto', {
      method: 'POST',
      headers: {
        'x-mist-edge-secret': 'attacker-spoofed-secret', // Must be stripped and replaced!
        'cf-connecting-ip': '203.0.113.195',
        'authorization': 'Bearer clerk_test_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Build a store' }),
    });

    const res = await proxyToHeroku(clientReq, new URL(clientReq.url), env);

    assert.equal(capturedTargetUrl, 'https://mist-heroku-api.internal/api/ai/generate/stream?model=auto');
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedHeaders!.get('x-mist-edge-secret'), 'super-edge-secret-456');
    assert.equal(capturedHeaders!.get('authorization'), 'Bearer clerk_test_token');
    assert.equal(capturedHeaders!.get('cf-connecting-ip'), '203.0.113.195');
    assert.equal(capturedHeaders!.get('x-forwarded-host'), 'mist.me');

    // Verify response preserved SSE streaming headers
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    assert.equal(res.headers.get('x-accel-buffering'), 'no');
    assert.match(res.headers.get('cache-control') || '', /no-cache/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker fetch handler routes /cdn-health, apex static assets, and subdomains', async () => {
  let assetFetchCalled = false;
  const env: Env = {
    APEX_DOMAIN: 'mist.me',
    ASSETS: {
      fetch: async (req: Request) => {
        assetFetchCalled = true;
        return new Response('<html>Mist Vite App</html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    },
    PUBLISHED_BUCKET: {
      get: async () => null,
    },
  };

  // 1. Edge health check
  const healthRes = await worker.fetch(new Request('https://mist.me/cdn-health'), env);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.status, 'healthy');

  // 2. Static asset request on apex
  const assetRes = await worker.fetch(new Request('https://mist.me/assets/index-D7P4gJS7.js'), env);
  assert.equal(assetRes.status, 200);
  assert.equal(assetFetchCalled, true);
  assert.match(assetRes.headers.get('cache-control') || '', /immutable/);

  // 3. Subdomain request routed to published site handler
  const subRes = await worker.fetch(new Request('https://unknown-subdomain.mist.me/'), env);
  assert.equal(subRes.status, 404);
  const subBody = await subRes.text();
  assert.match(subBody, /Project Unavailable/);
});
