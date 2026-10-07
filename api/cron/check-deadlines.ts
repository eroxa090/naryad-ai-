// ИИ-контроль сроков (модуль 6.1). Вызывается раз в минуту из Supabase pg_cron (см. supabase/migrations/002_cron.sql).
// Сообщения шаблонные — без LLM, бесплатно.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCronSecret } from '../_lib/auth.js'
import { admin } from '../_lib/supabase.js'
import { notify } from '../_lib/notify.js'
import { getOrderFull, hhmm, lastComment, minutesText } from '../_lib/orders.js'
import { ORDER_STATUS_LABEL } from '../../shared/types.js'
import { runAnalytics } from '../ai/_lib/analytics.js'

const REMIND_BEFORE_MIN = 30
const REPEAT_OVERDUE_MIN = 30
const ESCALATE_MANAGER_AFTER_MIN = 120
const ACCEPT_TIMEOUT_MIN = { emergency: 3, other: 10 }
const ACTIVE = ['issued', 'accepted', 'queued', 'in_progress', 'paused', 'needs_rework']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req, res)) return
  const now = Date.now()
  const result = { reminders: 0, overdue: 0, escalations: 0 }

  // 1. Напоминание за 30 минут до срока
  const { data: soon } = await admin
    .from('orders')
    .select('id')
    .in('status', ACTIVE)
    .is('reminded_at', null)
    .gt('deadline', new Date(now).toISOString())
    .lte('deadline', new Date(now + REMIND_BEFORE_MIN * 60_000).toISOString())
  for (const { id } of soon ?? []) {
    const o = await getOrderFull(id)
    if (!o?.assignee_id) continue
    const left = (new Date(o.deadline).getTime() - now) / 60_000
    await notify(o.assignee_id, o.id, 'reminder',
      `⏰ Наряд №${o.number}: до срока ${minutesText(left)} (до ${hhmm(o.deadline)}).\n${o.equipment?.name}, ${o.site?.name}.`)
    await admin.from('orders').update({ reminded_at: new Date(now).toISOString() }).eq('id', o.id)
    result.reminders++
  }

  // 2. Просрочка: исполнителю и мастеру, повтор каждые 30 мин, руководителю после 2 ч
  const { data: late } = await admin
    .from('orders')
    .select('id, overdue_notified_at, is_overdue')
    .in('status', ACTIVE)
    .lt('deadline', new Date(now).toISOString())
  for (const row of late ?? []) {
    const last = row.overdue_notified_at ? new Date(row.overdue_notified_at).getTime() : 0
    if (now - last < REPEAT_OVERDUE_MIN * 60_000) continue
    const o = await getOrderFull(row.id)
    if (!o) continue
    const lateMin = (now - new Date(o.deadline).getTime()) / 60_000
    const since = o.started_at ? ` с ${hhmm(o.started_at)}` : ''
    const comment = await lastComment(o.id)
    const text =
      `🔴 Наряд №${o.number} просрочен на ${minutesText(lateMin)}. ${o.equipment?.name}, ${o.site?.name}.\n` +
      `Исполнитель: ${o.assignee?.full_name ?? 'не назначен'}. Статус: ${ORDER_STATUS_LABEL[o.status].toLowerCase()}${since}.` +
      (comment ? `\nПоследний комментарий: «${comment}»` : '')
    if (o.assignee_id) await notify(o.assignee_id, o.id, 'overdue', text)
    await notify(o.master_id, o.id, 'overdue', text)
    if (lateMin >= ESCALATE_MANAGER_AFTER_MIN) {
      const { data: managers } = await admin.from('employees').select('id').eq('role', 'manager')
      for (const m of managers ?? []) await notify(m.id, o.id, 'escalation', `⚠️ Длительная просрочка.\n${text}`)
    }
    if (!row.is_overdue) {
      await admin.from('order_events').insert({
        order_id: o.id, action: 'overdue', comment: `Просрочен на ${minutesText(lateMin)}`,
      })
    }
    await admin.from('orders').update({ is_overdue: true, overdue_notified_at: new Date(now).toISOString() }).eq('id', o.id)
    result.overdue++
  }

  // 3. Эскалация: наряд не принят за 10 мин (аварийный — за 3 мин) → мастеру с предложением другого свободного
  const { data: unaccepted } = await admin
    .from('orders')
    .select('id, priority, created_at, assigned_at')
    .eq('status', 'issued')
    .is('escalated_at', null)
  for (const row of unaccepted ?? []) {
    const limit = row.priority === 'emergency' ? ACCEPT_TIMEOUT_MIN.emergency : ACCEPT_TIMEOUT_MIN.other
    // считаем от момента назначения: после переназначения таймер начинается заново
    if (now - new Date(row.assigned_at ?? row.created_at).getTime() < limit * 60_000) continue
    const o = await getOrderFull(row.id)
    if (!o) continue
    const alt = await findFreeWorker(o.assignee?.specialty, o.assignee_id)
    const text =
      `⚠️ Наряд №${o.number} не принят за ${limit} мин. ${o.equipment?.name}, ${o.site?.name}.\n` +
      `Исполнитель: ${o.assignee?.full_name ?? '—'}.` +
      (alt ? `\nПредлагаем свободного: ${alt.full_name} (${alt.specialty}).` : '\nСвободных исполнителей нужной специальности нет.')
    await notify(o.master_id, o.id, 'escalation', text,
      alt ? [[{ text: `Переназначить на ${alt.full_name}`, callback_data: `r:${o.id}:${alt.id}` }]] : undefined)
    await admin.from('order_events').insert({ order_id: o.id, action: 'escalate', comment: text })
    await admin.from('orders').update({ escalated_at: new Date(now).toISOString() }).eq('id', o.id)
    result.escalations++
  }

  // 4. ИИ-аналитика раз в сутки (карта здоровья, закономерности)
  const { data: lastInsight } = await admin.from('ai_insights').select('created_at').order('created_at', { ascending: false }).limit(1)
  if (!lastInsight?.length || now - Date.parse(lastInsight[0].created_at) > 24 * 3_600_000) {
    await runAnalytics().then((n) => Object.assign(result, { insights: n })).catch((e) => console.error('analytics failed', e))
  }

  res.status(200).json(result)
}

async function findFreeWorker(specialty: string | undefined, exceptId: number | null) {
  const { data: free } = await admin.from('v_employee_status').select('employee_id').eq('status', 'free')
  const ids = (free ?? []).map((r) => r.employee_id).filter((id) => id !== exceptId)
  if (!ids.length) return null
  let q = admin.from('employees').select('id, full_name, specialty').in('id', ids)
  if (specialty) q = q.eq('specialty', specialty)
  const { data } = await q.limit(1)
  return data?.[0] ?? null
}
