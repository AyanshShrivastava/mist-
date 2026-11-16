import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { createMistApp, ensureVendorRuntime } from './src/utils/mistServerApp';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const app = createMistApp();

async function startServer() {
  await ensureVendorRuntime();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Mist server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Mist server:', err);
  process.exit(1);
});
