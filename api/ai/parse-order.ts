// Фраза мастера → карточка наряда. Сначала правила (бесплатно, мгновенно);
// LLM подключается, только если правила не нашли оборудование или шифр.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import type { ParseOrderReq, ParseOrderRes } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { askJson, llmEnabled, modelFast } from './_lib/claude.js'
import { loadRefs, parseOrderText, type Refs } from './_lib/rules.js'

const Schema = z.object({
  description: z.string(),
  type: z.enum(['planned', 'emergency']),
  priority: z.enum(['emergency', 'high', 'normal', 'planned']),
  equipment_id: z.number().nullable(),
  fault_code: z.string().nullable(),
  confidence: z.number(),
})

const systemPrompt = (refs: Refs) => `Ты помощник мастера смены горно-обогатительного комбината. Преобразуй фразу мастера в карточку наряда на ремонт.
Правила:
- description: короткое описание проблемы и работ на русском, исправь ошибки распознавания речи.
- type: "planned" для планового ремонта/ППР/ТО, иначе "emergency" (внеплановая поломка).
- priority: "emergency" если авария, остановка, опасность или слово «срочно»; "planned" для плановых; "high" если важно; иначе "normal".
- equipment_id: id из справочника, только если оборудование однозначно; иначе null.
- fault_code: код из справочника шифров или null.
- confidence: 0..1.

Участки: ${refs.sites.map((s) => `${s.id}=${s.name}`).join('; ')}
Оборудование (id: название, участок): ${refs.equipment.map((e) => `${e.id}: ${e.name}, уч.${e.site_id}`).join('; ')}
Шифры: ${refs.faults.map((f) => `${f.code} ${f.name}`).join('; ')}`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  if (!(await requireEmployee(req, res))) return
  const { text } = (req.body ?? {}) as ParseOrderReq
  if (!text?.trim()) return res.status(400).json({ error: 'Пустой текст' })

  const refs = await loadRefs()
  const rules = parseOrderText(text, refs)
  let out: ParseOrderRes = rules

  if (llmEnabled() && (!rules.equipment_id || !rules.fault_code)) {
    try {
      const ai = await askJson({ tag: 'parse-order', model: modelFast(), system: systemPrompt(refs), content: text, schema: Schema, maxTokens: 600 })
      const eq = refs.equipment.find((e) => e.id === ai.equipment_id)
      const fault = refs.faults.find((f) => f.code === ai.fault_code)
      out = {
        description: ai.description || rules.description,
        type: ai.type,
        priority: ai.priority,
        equipment_id: rules.equipment_id ?? eq?.id ?? null,
        site_id: rules.site_id ?? eq?.site_id ?? null,
        fault_code: rules.fault_code ?? fault?.code ?? null,
        norm_hours: rules.norm_hours ?? (fault ? Number(fault.norm_hours) : null),
        confidence: Math.max(rules.confidence, Math.min(1, ai.confidence)),
      }
    } catch (e) {
      console.error('parse-order LLM failed, using rules', e)
    }
  }
  res.status(200).json(out)
}
