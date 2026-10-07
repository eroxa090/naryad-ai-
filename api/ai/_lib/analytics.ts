// ИИ-аналитика истории нарядов (модуль 6.5): цифры считает статистика, LLM только переписывает выводы.
// Находит: проблемное оборудование, повторные отказы, поломки после ППР, зависимость от смены,
// исполнителей с повторными поломками, аномальный расход материалов, и оценивает риск отказа каждой единицы.
import { z } from 'zod'
import type { AiInsight } from '../../../shared/types.js'
import { admin } from '../../_lib/supabase.js'
import { askJson, llmEnabled, modelSmart } from './claude.js'
import { clamp, plural } from './rules.js'

type Insight = Omit<AiInsight, 'id' | 'created_at'>
const DAY = 86_400_000
const H = 3_600_000
const fmt = (x: number, d = 1) => x.toFixed(d).replace(/\.0$/, '')
const almatyHour = (iso: string) => (new Date(iso).getUTCHours() + 5) % 24
const isNight = (iso: string) => { const h = almatyHour(iso); return h >= 20 || h < 8 }

async function all<T>(table: string, select = '*'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(select).range(from, from + 999)
    if (error) throw error
    out.push(...(data as T[]))
    if (!data || data.length < 1000) return out
  }
}

export async function computeInsights(now = Date.now()): Promise<Insight[]> {
  const [orders, equipment, faults, employees, materials, orderMats, sites] = await Promise.all([
    all<any>('orders', 'id, number, type, status, equipment_id, site_id, assignee_id, fault_code, created_at, accepted_at, closed_at'),
    all<any>('equipment'),
    all<any>('fault_codes'),
    all<any>('employees', 'id, full_name, role'),
    all<any>('materials'),
    all<any>('order_materials'),
    all<any>('sites'),
  ])
  const eqName = (id: number) => equipment.find((e) => e.id === id)?.name ?? `#${id}`
  const faultName = (c: string) => faults.find((f) => f.code === c)?.name?.toLowerCase() ?? c
  const empName = (id: number) => employees.find((e) => e.id === id)?.full_name ?? `#${id}`
  const from90 = now - 90 * DAY
  const period = { period_from: new Date(from90).toISOString(), period_to: new Date(now).toISOString() }
  const unplanned = orders.filter((o) => o.type === 'emergency' && Date.parse(o.created_at) >= from90 && o.status !== 'cancelled')
  const closed = orders.filter((o) => o.status === 'closed' && o.closed_at)
  const insights: Insight[] = []

  // повтор: внеплановый наряд того же шифра на том же оборудовании в течение 7 дней после закрытия
  const repeatOf = (o: any) =>
    unplanned.find((n) => n.id !== o.id && n.equipment_id === o.equipment_id && n.fault_code === o.fault_code &&
      Date.parse(n.created_at) > Date.parse(o.closed_at) && Date.parse(n.created_at) - Date.parse(o.closed_at) <= 7 * DAY)

  // 1. Топ проблемного оборудования
  const byEq = new Map<number, any[]>()
  for (const o of unplanned) byEq.set(o.equipment_id, [...(byEq.get(o.equipment_id) ?? []), o])
  const avg = unplanned.length / Math.max(1, equipment.length)
  const top = [...byEq.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3)
  for (const [id, list] of top) {
    if (list.length < avg * 1.8) continue
    const codes = new Map<string, number>()
    for (const o of list) codes.set(o.fault_code, (codes.get(o.fault_code) ?? 0) + 1)
    const [code, n] = [...codes.entries()].sort((a, b) => b[1] - a[1])[0]
    const downtime = list.reduce((s, o) => s + (o.closed_at ? (Date.parse(o.closed_at) - Date.parse(o.created_at)) / H : 0), 0)
    insights.push({
      kind: 'top_equipment', ...period,
      title: `${eqName(id)} ломается в ${fmt(list.length / avg)} раза чаще среднего`,
      text: `${eqName(id)}: ${list.length} внеплановых нарядов за 90 дней при среднем ${fmt(avg)}; ${n} из них — ${code} (${faultName(code)}). Простой ≈ ${fmt(downtime, 0)} ч.`,
      recommendation: code === 'М-02'
        ? 'Проверить соосность привода и натяжение, заменить подшипниковые узлы комплектом и включить узел в план ППР.'
        : `Провести диагностику по шифру ${code} и включить узел в ближайший ППР.`,
      data: { equipment_id: id, count: list.length, average: avg, top_fault: code, top_fault_count: n, downtime_hours: downtime },
    })
  }

  // 2. Повторные отказы одного шифра — ремонт не устраняет причину
  const repeats = new Map<string, number>()
  for (const o of closed) if (o.fault_code && repeatOf(o)) {
    const k = `${o.equipment_id}|${o.fault_code}`
    repeats.set(k, (repeats.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...repeats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    if (n < 5) continue
    const [id, code] = k.split('|')
    insights.push({
      kind: 'repeat_fault', ...period,
      title: `Повторные отказы ${code} на ${eqName(+id)}`,
      text: `${n} ${plural(n, 'раз', 'раза', 'раз')} за 90 дней ${faultName(code)} повторялся в течение 7 дней после ремонта — ремонт не устраняет причину.`,
      recommendation: 'Разобрать первопричину (износ сопряжённых деталей, условия эксплуатации), а не менять расходник.',
      data: { equipment_id: +id, fault_code: code, repeats: n },
    })
  }

  // 3. Поломки вскоре после планового ремонта — сигнал о качестве ППР.
  //    Сравниваем частоту отказов в 7 дней после ППР с обычной частотой отказов этой же единицы.
  for (const e of equipment) {
    const pprs = closed.filter((o) => o.equipment_id === e.id && o.fault_code === 'М-10' && Date.parse(o.closed_at) >= from90)
    if (pprs.length < 4) continue
    const fails = unplanned.filter((u) => u.equipment_id === e.id)
    const isAfter = (u: any) => pprs.some((p) => Date.parse(u.created_at) > Date.parse(p.closed_at) && Date.parse(u.created_at) - Date.parse(p.closed_at) <= 7 * DAY)
    const after = fails.filter(isAfter).length
    const afterDays = pprs.length * 7
    const rateAfter = after / afterDays
    const rateBase = (fails.length - after) / Math.max(1, 90 - afterDays)
    if (after < 4 || rateAfter < rateBase * 1.4) continue
    const hit = pprs.filter((p) => fails.some((u) => Date.parse(u.created_at) > Date.parse(p.closed_at) && Date.parse(u.created_at) - Date.parse(p.closed_at) <= 7 * DAY)).length
    insights.push({
      kind: 'after_ppr', ...period,
      title: `${e.name}: поломки сразу после ППР`,
      text: `После ${hit} из ${pprs.length} плановых ремонтов оборудование ломалось в течение 7 дней — в ${fmt(rateAfter / Math.max(rateBase, 0.001))} раза чаще, чем в остальное время.`,
      recommendation: 'Проверить качество ППР: регламент, затяжку и центровку после сборки, ввести приёмку ППР мастером.',
      data: { equipment_id: e.id, ppr: pprs.length, failed_after: hit, rate_ratio: rateAfter / Math.max(rateBase, 0.001) },
    })
  }

  // 4. Зависимость от смены: время реакции ночью против дня по участкам
  for (const s of sites) {
    const react = (night: boolean) => {
      const xs = orders.filter((o) => o.site_id === s.id && o.accepted_at && Date.parse(o.created_at) >= from90 && isNight(o.created_at) === night)
        .map((o) => (Date.parse(o.accepted_at) - Date.parse(o.created_at)) / 60_000)
      return xs.length >= 8 ? xs.reduce((a, b) => a + b, 0) / xs.length : null
    }
    const day = react(false), night = react(true)
    if (day && night && night / day >= 1.6) {
      insights.push({
        kind: 'shift_pattern', ...period,
        title: `${s.name}: ночью реакция в ${fmt(night / day)} раза медленнее`,
        text: `Среднее время принятия наряда ночью ${fmt(night, 0)} мин против ${fmt(day, 0)} мин днём.`,
        recommendation: 'Усилить ночную смену на участке или закрепить дежурного слесаря; проверить, доходят ли уведомления.',
        data: { site_id: s.id, night_min: night, day_min: day },
      })
    }
  }

  // 5. Исполнители с повторными поломками
  const perWorker = new Map<number, { n: number; bad: number }>()
  for (const o of closed) if (o.type === 'emergency' && o.assignee_id && Date.parse(o.closed_at) >= from90) {
    const w = perWorker.get(o.assignee_id) ?? { n: 0, bad: 0 }
    w.n++
    if (repeatOf(o)) w.bad++
    perWorker.set(o.assignee_id, w)
  }
  const teamRate = [...perWorker.values()].reduce((a, w) => a + w.bad, 0) / Math.max(1, [...perWorker.values()].reduce((a, w) => a + w.n, 0))
  for (const [id, w] of perWorker) {
    const rate = w.bad / w.n
    if (w.n >= 10 && rate >= Math.max(0.25, teamRate * 2)) {
      insights.push({
        kind: 'worker_pattern', ...period,
        title: `${empName(id)}: повторные поломки после ремонта`,
        text: `${w.bad} из ${w.n} аварийных нарядов (${fmt(rate * 100, 0)}%) дали повторный отказ в течение 7 дней; по бригадам в среднем ${fmt(teamRate * 100, 0)}%.`,
        recommendation: 'Назначить наставника, проверить технологию ремонта, временно ставить на сложные наряды в паре.',
        data: { employee_id: id, orders: w.n, repeats: w.bad, rate, team_rate: teamRate },
      })
    }
  }

  // 6. Аномальный расход материалов (средняя кратность нормы по исполнителю, z-оценка)
  const matById = new Map(materials.map((m) => [m.id, m]))
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const ratios = new Map<number, number[]>()
  for (const m of orderMats) {
    const o = orderById.get(m.order_id), mat = matById.get(m.material_id)
    if (!o?.assignee_id || !mat || !Number(mat.typical_qty)) continue
    ratios.set(o.assignee_id, [...(ratios.get(o.assignee_id) ?? []), Number(m.qty) / Number(mat.typical_qty)])
  }
  const means = [...ratios.entries()].filter(([, r]) => r.length >= 10).map(([id, r]) => [id, r.reduce((a, b) => a + b, 0) / r.length] as const)
  const mu = means.reduce((a, [, x]) => a + x, 0) / Math.max(1, means.length)
  const sd = Math.sqrt(means.reduce((a, [, x]) => a + (x - mu) ** 2, 0) / Math.max(1, means.length)) || 1
  for (const [id, x] of means) {
    if ((x - mu) / sd < 2 && x < 1.8) continue
    insights.push({
      kind: 'materials_anomaly', ...period,
      title: `${empName(id)}: расход материалов ×${fmt(x)} от нормы`,
      text: `В среднем списывает в ${fmt(x)} раза больше нормы; по смене — ×${fmt(mu)}.`,
      recommendation: 'Сверить списания со складом и фото работ; ввести подтверждение списания мастером.',
      data: { employee_id: id, ratio: x, team_ratio: mu },
    })
  }

  // 7. Риск отказа каждой единицы (карта здоровья): частота, тренд, повторы, критичность
  const in30 = (o: any, a: number, b: number) => Date.parse(o.created_at) >= now - a * DAY && Date.parse(o.created_at) < now - b * DAY
  const u30 = new Map<number, number>(), uPrev = new Map<number, number>()
  for (const o of unplanned) {
    if (in30(o, 30, 0)) u30.set(o.equipment_id, (u30.get(o.equipment_id) ?? 0) + 1)
    else if (in30(o, 60, 30)) uPrev.set(o.equipment_id, (uPrev.get(o.equipment_id) ?? 0) + 1)
  }
  const mean30 = [...u30.values()].reduce((a, b) => a + b, 0) / Math.max(1, equipment.length)
  for (const e of equipment) {
    const n = u30.get(e.id) ?? 0, prev = uPrev.get(e.id) ?? 0
    const rep = repeats.get([...repeats.keys()].find((k) => k.startsWith(`${e.id}|`)) ?? '') ?? 0
    const afterPpr = insights.some((i) => i.kind === 'after_ppr' && i.data.equipment_id === e.id)
    const risk = clamp(
      0.5 * clamp(n / Math.max(mean30 * 3, 1)) + 0.15 * clamp((n - prev) / Math.max(prev, 2)) +
      0.15 * clamp(rep / 4) + 0.1 * ((e.criticality - 1) / 2) + (afterPpr ? 0.1 : 0),
    )
    const nextDays = n ? Math.max(1, Math.round(30 / n)) : null
    insights.push({
      kind: 'equipment_risk', ...period,
      title: `${e.name}: риск отказа ${Math.round(risk * 100)}%`,
      text: n
        ? `${n} ${plural(n, 'внеплановый наряд', 'внеплановых наряда', 'внеплановых нарядов')} за 30 дней (за предыдущие 30 — ${prev}).${nextDays ? ` При такой частоте следующий отказ вероятен в ближайшие ~${nextDays} дн.` : ''}`
        : 'Внеплановых нарядов за 30 дней не было.',
      recommendation: risk >= 0.7 ? 'Высокий риск: внеплановая диагностика на этой неделе, запчасти держать на складе.'
        : risk >= 0.35 ? 'Средний риск: включить в ближайший ППР.' : 'Риск низкий: работа по графику.',
      data: { equipment_id: e.id, risk, unplanned_30d: n, prev_30d: prev, repeats: rep, next_failure_days: nextDays },
    })
  }

  // 8. Сводка
  const found = insights.filter((i) => i.kind !== 'equipment_risk')
  insights.push({
    kind: 'weekly_summary', ...period,
    title: 'Сводка ИИ по истории нарядов',
    text: `Проанализировано ${orders.length} нарядов за 90 дней, найдено закономерностей: ${found.length}. ` +
      found.slice(0, 4).map((i) => i.title).join('; ') + '.',
    recommendation: found[0]?.recommendation ?? null,
    data: { orders: orders.length, findings: found.length },
  })
  return insights
}

const Polish = z.object({ items: z.array(z.object({ i: z.number(), text: z.string(), recommendation: z.string() })) })

// LLM переписывает выводы понятным языком. ФИО заменяются кодами E<id> (персональные данные наружу не уходят),
// цифры модель не трогает.
async function polish(list: Insight[]): Promise<void> {
  const targets = list.map((x, i) => ({ x, i })).filter(({ x }) => x.kind !== 'equipment_risk')
  if (!targets.length) return
  const { data: people } = await admin.from('employees').select('id, full_name')
  const mask = (s: string) => (people ?? []).reduce((acc, p) => acc.split(p.full_name).join(`E${p.id}`), s)
  const unmask = (s: string) => s.replace(/E(\d+)/g, (c, id) => people?.find((p) => p.id === +id)?.full_name ?? c)
  const items = targets.map(({ x, i }) => ({ i, title: mask(x.title), text: mask(x.text), recommendation: mask(x.recommendation ?? '') }))
  const out = await askJson({
    tag: 'insights', model: modelSmart(), schema: Polish, maxTokens: 3000,
    system: 'Ты главный механик ГОКа. Перепиши выводы аналитики для мастера: коротко, по делу, без канцелярита. ' +
      'Цифры и коды сотрудников (E1, E2…) сохрани без изменений. Рекомендация — конкретное действие.',
    content: JSON.stringify(items),
  })
  for (const it of out.items) {
    const target = list[it.i]
    if (!target || target.kind === 'equipment_risk') continue
    target.text = unmask(it.text)
    target.recommendation = unmask(it.recommendation)
  }
}

export async function runAnalytics(): Promise<number> {
  const insights = await computeInsights()
  if (llmEnabled()) await polish(insights).catch((e) => console.error('insights polish failed', e))
  await admin.from('ai_insights').delete().gte('id', 0)
  const { error } = await admin.from('ai_insights').insert(insights)
  if (error) throw error
  return insights.length
}
