// ИИ-ассистент мастера (модуль 6.7): «кто свободен из электриков?», «что просрочено?», «отчёт за неделю».
// Вызывается из приложения (Bearer) и из Telegram-бота (x-internal-secret + employee_id).
// В LLM уходят только факты из БД; ФИО заменены кодами E<id> и подставляются обратно на сервере.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import type { AssistantReq, AssistantRes } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { admin } from '../_lib/supabase.js'
import { askJson, llmEnabled, modelFast } from './_lib/claude.js'

const ACTIVE = ['issued', 'accepted', 'queued', 'in_progress', 'paused', 'needs_rework']
const STATUS = { free: 'свободен', has_queue: 'есть очередь', busy: 'в работе', off_shift: 'не на смене' } as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  const internal = Boolean(process.env.CRON_SECRET) && req.headers['x-internal-secret'] === process.env.CRON_SECRET
  if (!internal) {
    const me = await requireEmployee(req, res)
    if (!me) return
    if (me.role === 'worker') return res.status(403).json({ error: 'Ассистент доступен мастеру и руководителю' })
  }
  const { question } = (req.body ?? {}) as AssistantReq
  if (!question?.trim()) return res.status(400).json({ error: 'Пустой вопрос' })

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [{ data: emps }, { data: statuses }, { data: active }, { data: week }, { data: insights }, { data: sites }] = await Promise.all([
    admin.from('employees').select('id, full_name, specialty, grade, brigade, on_shift').eq('role', 'worker'),
    admin.from('v_employee_status').select('*'),
    admin.from('orders').select('number, status, priority, is_overdue, deadline, assignee_id, site_id, equipment:equipment_id(name)').in('status', ACTIVE),
    admin.from('orders').select('status, type, site_id, is_overdue, equipment:equipment_id(name)').gte('created_at', weekAgo),
    admin.from('ai_insights').select('kind, title, recommendation').neq('kind', 'equipment_risk').order('created_at', { ascending: false }).limit(8),
    admin.from('sites').select('id, name'),
  ])
  const code = (id: number | null) => (id ? `E${id}` : 'не назначен')
  const siteName = (id: number) => sites?.find((s) => s.id === id)?.name ?? ''
  const people = (emps ?? []).map((e) => ({
    code: code(e.id), специальность: e.specialty, разряд: e.grade, бригада: e.brigade,
    статус: STATUS[(statuses?.find((s) => s.employee_id === e.id)?.status ?? 'off_shift') as keyof typeof STATUS],
  }))
  const facts = {
    сейчас: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }),
    исполнители: people,
    активные_наряды: (active ?? []).map((o: any) => ({
      номер: o.number, статус: o.status, приоритет: o.priority, просрочен: o.is_overdue,
      оборудование: o.equipment?.name, участок: siteName(o.site_id), исполнитель: code(o.assignee_id),
    })),
    за_7_дней: (sites ?? []).map((s) => {
      const xs = (week ?? []).filter((o: any) => o.site_id === s.id)
      return { участок: s.name, выдано: xs.length, закрыто: xs.filter((o: any) => o.status === 'closed').length, внеплановых: xs.filter((o: any) => o.type === 'emergency').length }
    }),
    выводы_аналитики: (insights ?? []).map((i) => `${i.title}. ${i.recommendation ?? ''}`),
  }
  const unmask = (s: string) => s.replace(/E(\d+)/g, (c, id) => emps?.find((e) => e.id === +id)?.full_name ?? c)

  let answer: string | null = null
  if (llmEnabled()) {
    try {
      const out = await askJson({
        tag: 'assistant', model: modelFast(), maxTokens: 700,
        schema: z.object({ answer: z.string() }),
        system: 'Ты ИИ-ассистент мастера смены ГОКа. Отвечай коротко (до 6 строк), по фактам из JSON, списками где уместно. ' +
          'Сотрудников называй только их кодом (E12) — система подставит ФИО. Если фактов не хватает, так и скажи. ' +
          'Фамилии в выводах аналитики переписывай как есть.',
        content: `Факты:\n${JSON.stringify(facts)}\n\nВопрос мастера: ${question}`,
      })
      answer = unmask(out.answer)
    } catch (e) {
      console.error('assistant LLM failed, rules', e)
    }
  }
  answer ??= ruleAnswer(question, facts, unmask)
  res.status(200).json({ answer } satisfies AssistantRes)
}

// Ответы без LLM на частые вопросы.
function ruleAnswer(q: string, f: any, unmask: (s: string) => string): string {
  const t = q.toLowerCase()
  if (/свобод/.test(t)) {
    const spec = ['электрик', 'слесар', 'сварщик'].find((s) => t.includes(s))
    const free = f.исполнители.filter((p: any) => p.статус === 'свободен' && (!spec || p.специальность.startsWith(spec)))
    return free.length ? `Свободны:\n${free.map((p: any) => `• ${unmask(p.code)} — ${p.специальность}, ${p.разряд} разряд`).join('\n')}`
      : 'Свободных исполнителей нужной специальности сейчас нет.'
  }
  if (/просроч/.test(t)) {
    const xs = f.активные_наряды.filter((o: any) => o.просрочен)
    return xs.length ? `Просрочены:\n${xs.map((o: any) => `• №${o.номер} ${o.оборудование} — ${unmask(o.исполнитель)}`).join('\n')}` : 'Просроченных нарядов нет.'
  }
  if (/отч[её]т|недел|сводк|итог/.test(t)) {
    return `За 7 дней:\n${f.за_7_дней.map((s: any) => `• ${s.участок}: выдано ${s.выдано}, закрыто ${s.закрыто}, внеплановых ${s.внеплановых}`).join('\n')}`
  }
  if (/проблем|ломает|риск|аналит/.test(t) && f.выводы_аналитики.length) {
    return `Главное по аналитике:\n${f.выводы_аналитики.slice(0, 4).map((x: string) => `• ${x}`).join('\n')}`
  }
  return 'Могу ответить: кто свободен (можно указать специальность), что просрочено, отчёт за неделю, проблемное оборудование.'
}
