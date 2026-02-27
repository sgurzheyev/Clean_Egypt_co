import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        nodePolyfills() // Маскирует ошибки старых библиотек
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        global: 'window',
      },
      resolve: {
          resolve: {
                  alias: {
                    '@': path.resolve(__dirname, '.'),
                    // Указываем на конкретный файл индекса, а не на всю папку
                    'react-map-gl': path.resolve(__dirname, 'node_modules/react-map-gl/dist/esm/index.js'),
                    'mapbox-gl': path.resolve(__dirname, 'node_modules/mapbox-gl/dist/mapbox-gl.js'),
                  }
                },
      build: {
        commonjsOptions: {
          transformMixedEsModules: true
        }
      }
    };
});
