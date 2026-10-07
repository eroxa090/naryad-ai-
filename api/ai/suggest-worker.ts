// Подбор исполнителя без LLM: специальность, занятость, рейтинг и опыт на таком оборудовании.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Employee, EmployeeStatusRow, SuggestWorkerReq, SuggestWorkerRes, WorkerRatingRow } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { admin } from '../_lib/supabase.js'
import { plural, specialtyFor } from './_lib/rules.js'

const STATUS_SCORE = { free: 30, has_queue: 15, busy: 5, off_shift: 0 } as const
const STATUS_TEXT = { free: 'свободен', has_queue: 'есть очередь', busy: 'занят', off_shift: 'не на смене' } as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  if (!(await requireEmployee(req, res))) return
  const { equipment_id, fault_code } = (req.body ?? {}) as SuggestWorkerReq

  const { data: eq } = await admin.from('equipment').select('id, name, type').eq('id', equipment_id).single()
  if (!eq) return res.status(404).json({ error: 'Оборудование не найдено' })
  const need = specialtyFor(fault_code, eq.type)

  const [{ data: workers }, { data: statuses }, { data: ratings }, { data: sameType }] = await Promise.all([
    admin.from('employees').select('*').eq('role', 'worker').eq('on_shift', true),
    admin.from('v_employee_status').select('*'),
    admin.from('v_worker_rating').select('*'),
    admin.from('equipment').select('id').eq('type', eq.type),
  ])
  const typeIds = (sameType ?? []).map((e) => e.id)
  const { data: history } = await admin
    .from('orders').select('assignee_id').eq('status', 'closed').in('equipment_id', typeIds)
  const experience = new Map<number, number>()
  for (const o of history ?? []) experience.set(o.assignee_id, (experience.get(o.assignee_id) ?? 0) + 1)

  const candidates = ((workers ?? []) as Employee[]).map((w) => {
    const st = ((statuses ?? []) as EmployeeStatusRow[]).find((s) => s.employee_id === w.id)
    const status = st?.status ?? 'off_shift'
    const rating = Number(((ratings ?? []) as WorkerRatingRow[]).find((r) => r.employee_id === w.id)?.rating ?? 60)
    const exp = experience.get(w.id) ?? 0
    const specOk = w.specialty === need
    const score = Math.round(
      (specOk ? 40 : 0) + STATUS_SCORE[status] - (st?.queue_count ?? 0) * 3 + rating * 0.2 + Math.min(exp, 10),
    )
    const reason = [
      specOk ? `${w.specialty}, ${w.grade} разряд` : `нужен ${need}, а это ${w.specialty}`,
      STATUS_TEXT[status] + (st?.queue_count ? ` (${st.queue_count} в очереди)` : ''),
      `рейтинг ${Math.round(rating)}`,
      exp ? `${exp} ${plural(exp, 'наряд', 'наряда', 'нарядов')} на оборудовании типа «${eq.type}»` : 'нет опыта на таком оборудовании',
    ].join(' · ')
    return { employee_id: w.id, score: Math.max(0, Math.min(100, score)), reason }
  })
  candidates.sort((a, b) => b.score - a.score)
  res.status(200).json({ candidates: candidates.slice(0, 5) } satisfies SuggestWorkerRes)
}
