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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), firebaseMessagingSwPlugin(mode)],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
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
