// Отчёт за смену/период: цифры из БД, текстовая сводка — LLM (или шаблон без LLM).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import type { ShiftReportReq, ShiftReportRes } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { admin } from '../_lib/supabase.js'
import { askJson, llmEnabled, modelFast } from './_lib/claude.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  const me = await requireEmployee(req, res)
  if (!me) return
  const { from, to, site_id } = (req.body ?? {}) as ShiftReportReq
  const t0 = Date.parse(from), t1 = Date.parse(to)
  if (!t0 || !t1 || t1 <= t0) return res.status(400).json({ error: 'Неверный период' })

  let q = admin.from('orders')
    .select('id, number, type, status, priority, is_overdue, created_at, closed_at, equipment:equipment_id(name), fault_code')
    .lte('created_at', to)
    .or(`closed_at.is.null,closed_at.gte.${from}`)
  if (site_id) q = q.eq('site_id', site_id)
  const { data: orders } = await q
  const list = (orders ?? []) as any[]
  const created = list.filter((o) => Date.parse(o.created_at) >= t0)
  const { count: rejected } = await admin.from('order_events').select('id', { count: 'exact', head: true })
    .eq('action', 'reject').gte('created_at', from).lte('created_at', to)
    .in('order_id', list.map((o) => o.id).length ? list.map((o) => o.id) : [-1])
  // простой: время внеплановых нарядов внутри периода (оценка по времени аварийных работ)
  const downtime = list.filter((o) => o.type === 'emergency' && o.status !== 'cancelled').reduce((s, o) => {
    const a = Math.max(Date.parse(o.created_at), t0), b = Math.min(o.closed_at ? Date.parse(o.closed_at) : Date.now(), t1)
    return s + Math.max(0, b - a) / 3_600_000
  }, 0)
  const stats = {
    issued: created.length,
    closed: list.filter((o) => o.closed_at && Date.parse(o.closed_at) >= t0 && Date.parse(o.closed_at) <= t1).length,
    overdue: list.filter((o) => o.is_overdue && !['closed', 'cancelled'].includes(o.status)).length,
    rejected: rejected ?? 0,
    downtime_hours: Math.round(downtime * 10) / 10,
  }
  const byEq = new Map<string, number>()
  for (const o of created.filter((o) => o.type === 'emergency')) byEq.set(o.equipment?.name, (byEq.get(o.equipment?.name) ?? 0) + 1)
  const topEq = [...byEq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  let summary = `За период выдано ${stats.issued}, закрыто ${stats.closed}, просрочено ${stats.overdue}, отклонено ${stats.rejected}. ` +
    `Простой по внеплановым работам ≈ ${stats.downtime_hours} ч.` +
    (topEq.length ? ` Чаще всего ломалось: ${topEq.map(([n, c]) => `${n} (${c})`).join(', ')}.` : '')
  if (llmEnabled()) {
    try {
      const out = await askJson({
        tag: 'shift-report', model: modelFast(), maxTokens: 500,
        schema: z.object({ summary: z.string() }),
        system: 'Ты пишешь сводку смены для мастера ГОКа: 3–4 предложения, главное — проблемы и что сделать следующей смене. Цифры не меняй.',
        content: JSON.stringify({ stats, top_equipment: topEq, overdue_now: list.filter((o) => o.is_overdue).map((o) => `№${o.number} ${o.equipment?.name}`).slice(0, 5) }),
      })
      summary = out.summary
    } catch (e) {
      console.error('shift-report LLM failed', e)
    }
  }
  res.status(200).json({ stats, summary } satisfies ShiftReportRes)
}
