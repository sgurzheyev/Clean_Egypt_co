/**
 * After `vite build`, write dist/privacy.html with the policy markup in the
 * first HTML response. Play Console and curl do not run the SPA.
 * Filesystem on Vercel serves this file; other client routes fall through
 * vercel.json to index.html. /api is not rewritten.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(root, 'dist', 'index.html');
const distPrivacy = path.join(root, 'dist', 'privacy.html');

if (!fs.existsSync(distIndex)) {
  console.error('prerender-privacy: dist/index.html missing. Run vite build first.');
  process.exit(1);
}

const vite = await createServer({
  configFile: false,
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, entries: [] },
  plugins: [react()],
  resolve: {
    alias: {
      'react-router-dom': path.resolve(root, 'scripts/ssr-link-shim.js'),
    },
  },
});

try {
  const privacyMod = await vite.ssrLoadModule('/components/Privacy.tsx');
  const Privacy = privacyMod.default;
  const body = renderToStaticMarkup(React.createElement(Privacy));
  if (!body.includes('GarbaGin Privacy Policy') || !body.includes('GURGINI LLC')) {
    throw new Error('prerendered privacy markup is missing required text');
  }

  let html = fs.readFileSync(distIndex, 'utf8');
  html = html.replace(
    '<title>GarbaGin</title>',
    '<title>GarbaGin Privacy Policy</title>'
  );
  html = html.replace(
    'content="GarbaGin — global marketplace for cleaning missions, crowdfunding cleanup, and municipal tasks."',
    'content="GarbaGin Privacy Policy. GURGINI LLC, New Mexico. How the Clean Egypt marketplace collects and uses personal information."'
  );
  html = html.replace(
    '<link rel="canonical" href="https://garbagin.com/" />',
    '<link rel="canonical" href="https://www.garbagin.com/privacy" />'
  );
  if (!html.includes('<div id="root"></div>')) {
    throw new Error('dist/index.html has no empty #root');
  }
  html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  fs.writeFileSync(distPrivacy, html);
  console.log('prerender-privacy: wrote dist/privacy.html', body.length, 'chars');
} finally {
  await vite.close();
}
