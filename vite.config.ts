import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        global: 'window', // Необходим для Mapbox в браузере
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          // Убираем проблемный путь! Позволяем Vite искать по имени пакета.
        }
      },
      build: {
        commonjsOptions: {
          include: [/node_modules/],
          transformMixedEsModules: true
        }
      },
      ssr: {
        // Принудительно выносим карту в external, чтобы не было конфликтов импорта
        noExternal: ['react-map-gl', 'mapbox-gl']
      }
    };
});
