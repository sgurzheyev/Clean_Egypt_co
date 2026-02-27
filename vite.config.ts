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
                  // Упрощаем: убираем прямой путь через node_modules
                  'react-map-gl': 'react-map-gl',
                }
              },
              optimizeDeps: {
                // Принудительно включаем карту в предварительную сборку
                include: ['react-map-gl', 'mapbox-gl']
              }   // Оптимизация для продакшн-сборки
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
