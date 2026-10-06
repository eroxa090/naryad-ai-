// Уведомление исполнителю о новом наряде. Фронт вызывает после insert в orders: POST { order_id }.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { onlyPost, requireEmployee } from '../_lib/auth.js'
import { notify } from '../_lib/notify.js'
import { appLink, getOrderFull, hhmm } from '../_lib/orders.js'
import { PRIORITY_LABEL } from '../../shared/types.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  const me = await requireEmployee(req, res)
  if (!me) return
  const o = await getOrderFull(Number(req.body?.order_id))
  if (!o) return res.status(404).json({ error: 'Наряд не найден' })
  if (!o.assignee_id) return res.status(200).json({ ok: true, skipped: 'no assignee' })

  const urgent = o.priority === 'emergency'
  const link = appLink(o.id)
  const text =
    `${urgent ? '🚨 АВАРИЙНЫЙ НАРЯД' : '🛠 Новый наряд'} №${o.number}\n` +
    `${o.equipment?.name}, ${o.site?.name}\n` +
    `${o.description}\n` +
    `Приоритет: ${PRIORITY_LABEL[o.priority]}. Срок: до ${hhmm(o.deadline)}` +
    (urgent ? '\nТребуется ответ в течение 3 минут.' : '')
  const buttons = [
    [
      { text: '✅ Принять', callback_data: `a:${o.id}` },
      { text: '⏳ В очередь', callback_data: `q:${o.id}` },
    ],
    ...(link ? [[{ text: 'Открыть в приложении', url: link }]] : []),
  ]
  await notify(o.assignee_id, o.id, 'new_order', text, buttons)
  res.status(200).json({ ok: true })
}
