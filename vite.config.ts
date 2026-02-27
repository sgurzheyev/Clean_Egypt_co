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
        alias: {
          '@': path.resolve(__dirname, '.'),
          // Принудительно указываем Vite на корень пакета, игнорируя ошибки в package.json
          'react-map-gl': path.resolve(__dirname, 'node_modules/react-map-gl'),
          'mapbox-gl': path.resolve(__dirname, 'node_modules/mapbox-gl'),
        }
      },
      build: {
        commonjsOptions: {
          transformMixedEsModules: true
        }
      }
    };
});
