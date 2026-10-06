// Диагностика деплоя: какие переменные заданы (без значений) и грузятся ли модули.
import type { VercelRequest, VercelResponse } from '@vercel/node'

const VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'TELEGRAM_BOT_TOKEN', 'APP_URL', 'AI_MOCK',
  'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const env = Object.fromEntries(VARS.map((k) => [k, Boolean(process.env[k])]))
  const modules: Record<string, string> = {}
  for (const [name, load] of [
    ['shared/types', () => import('../shared/types.js')],
    ['_lib/supabase', () => import('./_lib/supabase.js')],
    ['_lib/orders', () => import('./_lib/orders.js')],
  ] as const) {
    try { await load(); modules[name] = 'ok' } catch (e) { modules[name] = String(e).slice(0, 300) }
  }
  res.status(200).json({ env, modules, node: process.version })
}
