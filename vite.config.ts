import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Inject VITE_FIREBASE_* into the FCM service worker from .env (never commit secrets). */
function firebaseMessagingSwPlugin(mode: string): Plugin {
  const root = path.resolve(__dirname);
  const templatePath = path.join(root, 'scripts', 'firebase-messaging-sw.template.js');

  const render = (outFile: string) => {
    if (!fs.existsSync(templatePath)) return;
    const env = loadEnv(mode, root, '');
    const projectId = env.VITE_FIREBASE_PROJECT_ID || '';
    const authDomain =
      env.VITE_FIREBASE_AUTH_DOMAIN ||
      (projectId ? `${projectId}.firebaseapp.com` : '');
    const src = fs.readFileSync(templatePath, 'utf8');
    const injected = src
      .split('__VITE_FIREBASE_API_KEY__')
      .join(env.VITE_FIREBASE_API_KEY || '')
      .split('__VITE_FIREBASE_AUTH_DOMAIN__')
      .join(authDomain)
      .split('__VITE_FIREBASE_PROJECT_ID__')
      .join(projectId)
      .split('__VITE_FIREBASE_MESSAGING_SENDER_ID__')
      .join(env.VITE_FIREBASE_MESSAGING_SENDER_ID || '')
      .split('__VITE_FIREBASE_APP_ID__')
      .join(env.VITE_FIREBASE_APP_ID || '');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, injected, 'utf8');
  };

  return {
    name: 'firebase-messaging-sw-inject',
    buildStart() {
      render(path.join(root, 'public', 'firebase-messaging-sw.generated.js'));
    },
    closeBundle() {
      render(path.join(root, 'dist', 'firebase-messaging-sw.js'));
      render(path.join(root, 'dist', 'firebase-messaging-sw.generated.js'));
    },
  };
}

/** Cold GET /privacy must include the policy text, not only the empty SPA shell. */
function prerenderPrivacyPlugin(): Plugin {
  return {
    name: 'prerender-privacy-html',
    apply: 'build',
    closeBundle() {
      const script = path.join(__dirname, 'scripts', 'prerender-privacy.mjs');
      const result = spawnSync(process.execPath, [script], {
        cwd: __dirname,
        stdio: 'inherit',
        env: process.env,
      });
      if (result.status !== 0) {
        throw new Error(`prerender-privacy failed (exit ${result.status ?? 'signal'})`);
      }
    },
  };
}

function vortexDevProxy(env: Record<string, string>): Plugin {
  return {
    name: 'garba-vortex-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        const pathOnly = rawUrl.split('?')[0];
        if (pathOnly !== '/api/garba-vortex-heatmap') {
          next();
          return;
        }
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        try {
          const src = new URL(rawUrl, 'http://localhost');
          const { queryGarbaVortexHeatmap } = await import('./api/garba-vortex-heatmap.ts');
          const result = await queryGarbaVortexHeatmap({
            searchParams: src.searchParams,
            supabaseUrl: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
            anonKey: env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY,
          });
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', result.cacheControl);
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result.body));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'heatmap';
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'private, no-store');
          res.end(JSON.stringify({ storm: false, cache_seconds: 0, cells: [], error: message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      firebaseMessagingSwPlugin(mode),
      vortexDevProxy(env),
      prerenderPrivacyPlugin(),
    ],
    define: {
      // Do not embed GEMINI_API_KEY / other secrets into the client bundle.
      global: 'window',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            map: ['mapbox-gl'],
            firebase: ['firebase/app', 'firebase/messaging'],
          },
        },
      },
    },
  };
});
