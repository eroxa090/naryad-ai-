// ИИ-проверка выполненного наряда (модули 6.2–6.4).
// 1) Правила (всегда, бесплатно): полнота, время против норматива и срока, расход материалов, антифрод фото.
// 2) LLM (если включён): соответствие работ проблеме, логичность материалов, сравнение фото «до/после».
// Итог: вердикт, оценка 1–5, пояснение мастеру и обратная связь исполнителю. Финальное слово — за мастером.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import type { AiCheck, AiReview, AiVerdict, CheckOrderReq } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { admin } from '../_lib/supabase.js'
import { notify } from '../_lib/notify.js'
import { askJson, imageBlock, llmEnabled, modelSmart } from './_lib/claude.js'
import { SAME_PHOTO, downloadPhoto, forLlm, hashDistance, photoHash } from './_lib/photos.js'

const LlmSchema = z.object({
  work_matches_problem: z.boolean(),
  work_note: z.string(),
  materials_logical: z.boolean(),
  materials_note: z.string(),
  problem_fixed_on_photo: z.enum(['yes', 'no', 'unclear', 'no_photos']),
  photo_score: z.number().nullable(),
  photo_note: z.string(),
  score: z.number(),
  explanation: z.string(),
  worker_feedback: z.string(),
  confidence: z.number(),
})

const SYSTEM = `Ты — ИИ-контролёр смены на горно-обогатительном комбинате. Проверяешь закрытый наряд на ремонт оборудования.
Тебе дают факты наряда (проблема, выполненные работы, шифр неисправности, материалы с нормой расхода, время) и фото «до» и «после».
Оцени:
- work_matches_problem: устраняют ли описанные работы заявленную проблему;
- materials_logical: соответствуют ли списанные материалы типу работ и шифру, нет ли завышения против нормы;
- problem_fixed_on_photo: видно ли на фото «после», что проблема устранена (течь, обрыв, разрушение, загрязнение), то же ли это оборудование; "unclear", если по фото нельзя судить; "no_photos", если фото «после» нет;
- photo_score: 1–5 видимое качество работ (аккуратность, мусор, незакреплённые элементы, снятые кожухи) или null без фото;
- score: итоговая оценка 1–5;
- explanation: 2–3 предложения для мастера — что проверено и почему такая оценка;
- worker_feedback: 1–2 предложения исполнителю — что сделано хорошо и что улучшить;
- confidence: 0..1, насколько ты уверен. Если фото нечёткие или фактов мало — снижай уверенность, не выдумывай.
Пиши по-русски, коротко, без канцелярита.`

type Check = AiCheck & { level: 'ok' | 'warn' | 'fail' }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  const me = await requireEmployee(req, res)
  if (!me) return
  const { order_id, force } = (req.body ?? {}) as CheckOrderReq & { force?: boolean }

  const { data: order } = await admin
    .from('orders')
    .select('*, equipment:equipment_id(name, type), fault:fault_code(code, name, norm_hours)')
    .eq('id', order_id)
    .single()
  if (!order) return res.status(404).json({ error: 'Наряд не найден' })
  if (me.role === 'worker' && order.assignee_id !== me.id) return res.status(403).json({ error: 'Это не ваш наряд' })

  // Повторный вызов не тратит деньги: возвращаем свежую проверку этого же отчёта.
  const { data: last } = await admin
    .from('ai_reviews').select('*').eq('order_id', order_id).order('created_at', { ascending: false }).limit(1)
  const latest = last?.[0] as AiReview | undefined
  if (latest && !force && (order.status !== 'submitted' || latest.created_at >= order.submitted_at)) {
    return res.status(200).json(latest)
  }
  if (order.status !== 'submitted') return res.status(409).json({ error: 'Наряд ещё не сдан на проверку' })

  const [{ data: events }, { data: mats }, { data: photos }] = await Promise.all([
    admin.from('order_events').select('action, created_at').eq('order_id', order_id).order('created_at'),
    admin.from('order_materials').select('qty, material:material_id(name, unit, typical_qty)').eq('order_id', order_id),
    admin.from('order_photos').select('*').eq('order_id', order_id).order('created_at'),
  ])

  const checks: Check[] = []
  const add = (name: AiCheck['name'], level: Check['level'], note: string) => checks.push({ name, level, ok: level === 'ok', note })

  // --- полнота ---
  const after = (photos ?? []).filter((p) => p.kind === 'after')
  const before = (photos ?? []).filter((p) => p.kind === 'before')
  const missing: string[] = []
  if (!order.work_done?.trim() || order.work_done.trim().length < 10) missing.push('описание работ')
  if (!order.fault_code) missing.push('шифр неисправности')
  if (!after.length && order.type === 'emergency') missing.push('фото «после» (обязательно для внепланового наряда)')
  if (missing.length) add('completeness', 'fail', `Не заполнено: ${missing.join(', ')}.`)
  else if (!after.length) add('completeness', 'warn', 'Нет фото «после» — качество работ не подтверждено.')
  else add('completeness', 'ok', 'Работы, шифр, материалы и фото заполнены.')

  // --- время против норматива и срока (паузы не считаем) ---
  const norm = Number(order.fault?.norm_hours ?? 0)
  if (order.started_at && order.submitted_at) {
    let pausedMs = 0
    let pauseStart: number | null = null
    for (const ev of events ?? []) {
      if (ev.action === 'pause') pauseStart = Date.parse(ev.created_at)
      if (ev.action === 'resume' && pauseStart) {
        pausedMs += Date.parse(ev.created_at) - pauseStart
        pauseStart = null
      }
    }
    const hours = (Date.parse(order.submitted_at) - Date.parse(order.started_at) - pausedMs) / 3_600_000
    const late = Date.parse(order.submitted_at) > Date.parse(order.deadline)
    if (norm && hours > norm * 2) add('time', 'warn', `Работа заняла ${hours.toFixed(1)} ч при нормативе ${norm} ч.`)
    else if (late) add('time', 'warn', 'Наряд сдан позже срока.')
    else add('time', 'ok', norm ? `${hours.toFixed(1)} ч при нормативе ${norm} ч.` : `${hours.toFixed(1)} ч.`)
  }

  // --- расход материалов против нормы ---
  const matList = (mats ?? []).map((m: any) => ({
    name: m.material?.name as string, unit: m.material?.unit as string,
    qty: Number(m.qty), norm: Number(m.material?.typical_qty ?? 0),
  }))
  const over = matList.filter((m) => m.norm > 0 && m.qty / m.norm > 1.5)
  const heavy = over.filter((m) => m.qty / m.norm >= 2)
  const overText = (list: typeof over) =>
    list.map((m) => `${m.name}: ${m.qty} ${m.unit} при норме ${m.norm} (×${(m.qty / m.norm).toFixed(1)})`).join('; ')
  if (heavy.length) add('materials', 'fail', `Завышенный расход: ${overText(heavy)}.`)
  else if (over.length) add('materials', 'warn', `Расход выше обычного: ${overText(over)}.`)
  else add('materials', 'ok', matList.length ? 'Расход материалов в пределах нормы.' : 'Материалы не списывались.')

  // --- антифрод фото: старое фото, повтор из другого наряда, «после» = «до» ---
  const images = new Map<number, Buffer>()
  for (const p of photos ?? []) {
    const img = await downloadPhoto(p.storage_path)
    if (!img) continue
    images.set(p.id, img)
    if (!p.phash) {
      p.phash = await photoHash(img)
      await admin.from('order_photos').update({ phash: p.phash }).eq('id', p.id)
    }
  }
  const fraud: string[] = []
  if (after.length) {
    const { data: others } = await admin
      .from('order_photos').select('phash, order:order_id(number)').neq('order_id', order_id).not('phash', 'is', null)
    for (const p of after) {
      if (p.taken_at && order.started_at && Date.parse(p.taken_at) < Date.parse(order.started_at) - 10 * 60_000) {
        fraud.push(`фото «после» снято ${new Date(p.taken_at).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })} — раньше начала работ`)
      }
      if (!p.phash) continue
      const dup = (others ?? []).find((o: any) => hashDistance(o.phash, p.phash) <= SAME_PHOTO)
      if (dup) fraud.push(`фото «после» совпадает с фото из наряда №${(dup as any).order?.number}`)
      if (before.some((b) => b.phash && hashDistance(b.phash, p.phash) <= SAME_PHOTO)) fraud.push('фото «после» совпадает с фото «до»')
    }
    const noExif = after.filter((p) => !p.taken_at).length
    if (fraud.length) add('photo_fraud', 'fail', `Подозрение на подмену фото: ${[...new Set(fraud)].join('; ')}.`)
    else if (noExif) add('photo_fraud', 'warn', 'У части фото нет даты съёмки (скриншот или фото из мессенджера).')
    else add('photo_fraud', 'ok', 'Фото сделаны во время работ и не повторяют прежние.')
  }

  // --- LLM: смысловая проверка и сравнение фото ---
  let llm: z.infer<typeof LlmSchema> | null = null
  let model = 'rules'
  if (llmEnabled()) {
    try {
      const facts = {
        тип: order.type === 'emergency' ? 'внеплановый' : 'плановый',
        оборудование: `${order.equipment?.name} (${order.equipment?.type})`,
        проблема: order.description,
        выполненные_работы: order.work_done,
        шифр: order.fault ? `${order.fault.code} ${order.fault.name}` : null,
        норматив_ч: norm || null,
        материалы: matList.map((m) => `${m.name} ${m.qty} ${m.unit} (норма ${m.norm})`),
        комментарий: order.comment,
        замечания_правил: checks.filter((c) => c.level !== 'ok').map((c) => c.note),
      }
      const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: `Факты наряда:\n${JSON.stringify(facts, null, 1)}` }]
      for (const [label, list] of [['ДО', before], ['ПОСЛЕ', after]] as const) {
        for (const [i, p] of list.slice(0, 2).entries()) {
          const img = images.get(p.id)
          if (!img) continue
          content.push({ type: 'text', text: `Фото ${label} #${i + 1}:` }, imageBlock(await forLlm(img)))
        }
      }
      llm = await askJson({ tag: 'check-order', model: modelSmart(), system: SYSTEM, content, schema: LlmSchema, maxTokens: 1500 })
      model = modelSmart()
      add('work_matches_problem', llm.work_matches_problem ? 'ok' : 'fail', llm.work_note)
      if (!llm.materials_logical && !checks.some((c) => c.name === 'materials' && c.level === 'fail')) {
        add('materials', 'warn', llm.materials_note)
      }
      if (llm.problem_fixed_on_photo !== 'no_photos') {
        const level = llm.problem_fixed_on_photo === 'yes' ? 'ok' : llm.problem_fixed_on_photo === 'no' && llm.confidence >= 0.75 ? 'fail' : 'warn'
        add('photo', level, llm.photo_note)
      }
    } catch (e) {
      console.error('check-order LLM failed, rules only', e)
    }
  }

  // --- итог ---
  const fails = checks.filter((c) => c.level === 'fail')
  const warns = checks.filter((c) => c.level === 'warn')
  let score = llm ? Math.round(llm.score) : 5 - warns.length - 2 * fails.length
  if (fails.length) score = Math.min(score, 2)
  score = Math.max(1, Math.min(5, score))
  const verdict: AiVerdict = fails.length ? 'needs_rework' : warns.length || score <= 3 ? 'accepted_with_notes' : 'accepted'
  const explanation = llm?.explanation ?? (fails.length || warns.length
    ? [...fails, ...warns].map((c) => c.note).join(' ')
    : 'Наряд заполнен полностью, время в пределах норматива, расход материалов в норме, фото подлинные.')
  const worker_feedback = llm?.worker_feedback ?? (fails.length
    ? `Нужно исправить: ${fails.map((c) => c.note).join(' ')}`
    : warns.length
      ? `Принято с замечаниями: ${warns.map((c) => c.note).join(' ')}`
      : 'Хорошая работа: отчёт полный, уложились в норматив.')
  const photoScore = llm?.photo_score != null ? Math.max(1, Math.min(5, Math.round(llm.photo_score))) : null
  // Без LLM фото визуально не оценивались — пусть посмотрит мастер.
  const needs_master_review = llm ? llm.confidence < 0.6 : after.length > 0 && !fails.length

  const { data: review, error } = await admin.from('ai_reviews').insert({
    order_id, verdict, score, photo_score: photoScore, explanation, worker_feedback,
    checks: checks.map(({ level: _l, ...c }) => c), needs_master_review, model,
  }).select().single()
  if (error) return res.status(500).json({ error: error.message })

  const verdictText = { accepted: 'принято', accepted_with_notes: 'принято с замечаниями', needs_rework: 'требует доработки' }[verdict]
  await admin.from('order_events').insert({
    order_id, action: 'ai_review', comment: `ИИ: ${verdictText}, оценка ${score}/5. ${fails.map((c) => c.note).join(' ')}`.trim(),
  })
  if (verdict === 'needs_rework') {
    await admin.rpc('change_order_status', { p_order_id: order_id, p_action: 'rework', p_payload: { reason: fails[0].note } })
    await notify(order.assignee_id, order_id, 'rework', `🔁 Наряд №${order.number} возвращён на доработку.\n${worker_feedback}`)
  } else {
    await notify(order.assignee_id, order_id, 'review', `🤖 Наряд №${order.number} проверен ИИ: ${score}/5 (${verdictText}).\n${worker_feedback}`)
  }
  await notify(order.master_id, order_id, 'review',
    `🤖 ИИ проверил наряд №${order.number}: ${verdictText}, ${score}/5.${needs_master_review ? ' Нужна ваша проверка.' : ''}\n${explanation}`)

  res.status(200).json(review)
}
