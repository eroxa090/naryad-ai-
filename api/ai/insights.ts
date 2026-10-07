// Пересчёт ИИ-аналитики (ai_insights): мастер/руководитель кнопкой или сервер по расписанию.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { runAnalytics } from './_lib/analytics.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  const internal = Boolean(process.env.CRON_SECRET) && req.headers['x-cron-secret'] === process.env.CRON_SECRET
  if (!internal) {
    const me = await requireEmployee(req, res)
    if (!me) return
    if (me.role === 'worker') return res.status(403).json({ error: 'Только мастер или руководитель' })
  }
  try {
    res.status(200).json({ insights: await runAnalytics() })
  } catch (e) {
    console.error('analytics failed', e)
    res.status(500).json({ error: 'Не удалось пересчитать аналитику' })
  }
}
