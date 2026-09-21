import fs from 'fs';
import path from 'path';
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

function liveTrafficDevProxy(): Plugin {
  return {
    name: 'live-traffic-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        const pathOnly = rawUrl.split('?')[0];
        if (pathOnly !== '/api/opensky-states' && pathOnly !== '/api/adsb-nearby') {
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
          const json = (status: number, body: unknown) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=8');
            res.end(JSON.stringify(body));
          };
          const ua = { Accept: 'application/json', 'User-Agent': 'GarbaGin/1.0 (+https://garbagin.com)' };
          if (pathOnly === '/api/opensky-states') {
            const lamin = src.searchParams.get('lamin');
            const lomin = src.searchParams.get('lomin');
            const lamax = src.searchParams.get('lamax');
            const lomax = src.searchParams.get('lomax');
            if (!lamin || !lomin || !lamax || !lomax) {
              json(400, { error: 'lamin,lomin,lamax,lomax required', states: [] });
              return;
            }
            const target = `https://opensky-network.org/api/states/all?lamin=${encodeURIComponent(lamin)}&lomin=${encodeURIComponent(lomin)}&lamax=${encodeURIComponent(lamax)}&lomax=${encodeURIComponent(lomax)}`;
            try {
              const upstream = await fetch(target, {
                headers: ua,
                signal: AbortSignal.timeout(5_000),
              });
              const text = await upstream.text();
              let body: unknown = { states: [] };
              try {
                body = text ? JSON.parse(text) : { states: [] };
              } catch {
                body = { error: 'OpenSky returned non-JSON', states: [] };
              }
              json(200, body);
            } catch (err) {
              const message = err instanceof Error ? err.message : 'OpenSky unreachable';
              json(200, { error: message, states: [] });
            }
            return;
          }
          const lat = src.searchParams.get('lat');
          const lon = src.searchParams.get('lon');
          const dist = src.searchParams.get('dist') || '80';
          if (!lat || !lon) {
            json(400, { error: 'lat,lon required', ac: [] });
            return;
          }
          const hosts = [
            `https://api.adsb.lol/v2/lat/${encodeURIComponent(lat)}/lon/${encodeURIComponent(lon)}/dist/${encodeURIComponent(dist)}`,
            `https://opendata.adsb.fi/api/v2/lat/${encodeURIComponent(lat)}/lon/${encodeURIComponent(lon)}/dist/${encodeURIComponent(dist)}`,
          ];
          for (const target of hosts) {
            try {
              const upstream = await fetch(target, {
                headers: ua,
                signal: AbortSignal.timeout(6_000),
              });
              const ct = String(upstream.headers.get('content-type') || '');
              if (!upstream.ok || !ct.toLowerCase().includes('json')) continue;
              const parsed = JSON.parse(await upstream.text()) as {
                ac?: unknown;
                aircraft?: unknown;
              };
              const ac = Array.isArray(parsed.ac)
                ? parsed.ac
                : Array.isArray(parsed.aircraft)
                  ? parsed.aircraft
                  : [];
              json(200, { ac });
              return;
            } catch {
              /* try next host */
            }
          }
          json(200, { error: 'adsb unreachable', ac: [] });
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          const message = err instanceof Error ? err.message : 'upstream failed';
          res.end(JSON.stringify({ error: message }));
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
    plugins: [react(), firebaseMessagingSwPlugin(mode), liveTrafficDevProxy()],
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
