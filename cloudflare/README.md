# Mist Cloudflare Edge Router

Edge Worker and Workers Static Assets configuration for **Mist** (`mist.me`).

## Architecture & Responsibilities

1. **Static Asset Delivery (`mist.me`)**:
   - Uses **Cloudflare Workers Static Assets** (`assets: { directory: "../dist" }`) to serve the compiled Vite client directly from Cloudflare's edge cache.
   - Applies immutable caching (`public, max-age=31536000, immutable`) to versioned chunks under `/assets/*`.
   - Supports seamless Single Page Application (SPA) fallback for application routes.

2. **Secure Control Plane Reverse Proxy (`/api/*`)**:
   - Forwards all API requests to the private Mist Heroku backend (`HEROKU_API_ORIGIN`).
   - Strips incoming client-sent `x-mist-edge-secret` headers to prevent header injection.
   - Injects the authenticated edge-origin secret (`MIST_EDGE_ORIGIN_SECRET`) to ensure Heroku accepts requests only when routed through Cloudflare.
   - Forwards the true client IP (`cf-connecting-ip` -> `x-forwarded-for`).
   - Streams Server-Sent Events (`text/event-stream`) without edge buffering.

3. **Wildcard Published Project Hosting (`<slug>.mist.me`)**:
   - Intercepts all subdomain traffic via Cloudflare proxied wildcard DNS (`*.mist.me`).
   - Validates the project slug against DNS standards (3-63 chars, lowercase alphanumeric and hyphens).
   - Rejects reserved system subdomains (`www`, `api`, `auth`, `admin`, `dashboard`, `assets`, `status`, `mail`).
   - Directly fetches compiled project artifacts from the Cloudflare R2 bucket (`PUBLISHED_BUCKET`).
   - Serves HTML with `Content-Type: text/html; charset=utf-8` and edge caching.
   - Provides SPA route fallback (`sites/<slug>/index.html`) and branded 404 pages.

## Directory Structure

```
cloudflare/
├── wrangler.jsonc      # Cloudflare Workers configuration (Routes, Static Assets, R2)
├── package.json        # Edge dependencies & test scripts
├── README.md           # Edge documentation
└── src/
    ├── index.ts        # Worker edge router & reverse proxy
    └── index.test.ts   # Edge test suite (slugs, R2 lookup, proxy, SSE)
```

## Local Development & Testing

Run the edge router tests:
```bash
npm run test
# or within cloudflare/:
cd cloudflare && npm test
```

Preview edge worker locally using Wrangler:
```bash
wrangler dev
```

## Deployment to Cloudflare

1. Build the production frontend:
   ```bash
   npm run build
   ```
2. Configure edge secrets in Cloudflare:
   ```bash
   wrangler secret put MIST_EDGE_ORIGIN_SECRET
   ```
3. Deploy the worker:
   ```bash
   wrangler deploy
   ```
