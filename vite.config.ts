import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    server: { proxy: { '/api': { target: 'https://naryadai-kz.vercel.app', changeOrigin: true } } },
    // Клиентские заглушки ИИ — только для офлайн-разработки без бэкенда. Обычно фронт ходит в /api/ai,
    // а серверный AI_MOCK решает, вызывать ли LLM (детерминированные проверки работают всегда).
    define: { __AI_MOCK__: JSON.stringify(env.VITE_AI_CLIENT_MOCK === 'true') },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Новая версия ставится сама: в интерфейсе нет кнопки «Обновить», иначе телефоны застревали на старой сборке.
        registerType: 'autoUpdate',
        manifest: {
          name: 'НарядAI',
          short_name: 'НарядAI',
          description: 'Выдача и контроль нарядов с ИИ',
          lang: 'ru',
          theme_color: '#ffffff',
          background_color: '#f3f4f6',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/api\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
      }),
    ],
  }
})
