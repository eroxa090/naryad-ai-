import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, loadEnv } from 'vite'
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    define: { __AI_MOCK__: JSON.stringify(env.AI_MOCK === 'true') },
    plugins: [react(), tailwindcss(), VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'НарядAI', short_name: 'НарядAI', description: 'Выдача и контроль нарядов с ИИ', lang: 'ru',
        theme_color: '#146453', background_color: '#f3f6f5', display: 'standalone', start_url: '/', scope: '/',
        icons: [
          {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
          {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
          {src:'/icon-maskable.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
        ],
      },
      workbox: { navigateFallbackDenylist: [/^\/api\//], maximumFileSizeToCacheInBytes: 5*1024*1024 },
    })],
  }
})

