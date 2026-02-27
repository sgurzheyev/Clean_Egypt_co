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
        // Добавляем для стабильности Mapbox в браузере
        global: 'window',
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          // ФИКС: Принудительно указываем Vite путь к модулю карты
          'react-map-gl': path.resolve(__dirname, './node_modules/react-map-gl/dist/esm/index.js'),
        }
      },
      // Оптимизация для продакшн-сборки
      build: {
        rollupOptions: {
          external: [],
        },
        commonjsOptions: {
          include: [/react-map-gl/, /node_modules/],
        }
      }
    };
});
