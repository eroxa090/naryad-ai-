// Telegram-бот @naryad_ai_kz_bot.
//  /start <login>     — привязать Telegram к сотруднику
//  /my                — мои активные наряды (исполнитель)
//  кнопки             — Принять / В очередь / Начать / Переназначить (эскалация)
//  текст от мастера   — «кто свободен», «что просрочено» отвечаем сами, остальное → ИИ-ассистент
// Webhook ставится с secret_token = CRON_SECRET (см. README).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Employee } from '../../shared/types.js'
import { ORDER_STATUS_LABEL } from '../../shared/types.js'
import { admin } from '../_lib/supabase.js'
import { sendTelegram, tg } from '../_lib/telegram.js'
import { getOrderFull, hhmm } from '../_lib/orders.js'

const ACTIONS: Record<string, { action: string; done: string }> = {
  a: { action: 'accept', done: '✅ Принят в работу' },
  q: { action: 'queue', done: '⏳ Поставлен в очередь' },
  s: { action: 'start', done: '▶️ Исполнение начато' },
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers['x-telegram-bot-api-secret-token'] !== process.env.CRON_SECRET) {
    return res.status(401).end()
  }
  try {
    const u = req.body
    if (u.callback_query) await onCallback(u.callback_query)
    else if (u.message?.text) await onMessage(u.message)
  } catch (e) {
    console.error('telegram webhook error', e)
  }
  res.status(200).json({ ok: true }) // Telegram всегда получает 200, иначе будет ретраить
}

async function employeeByChat(chatId: number): Promise<Employee | null> {
  const { data } = await admin.from('employees').select('*').eq('telegram_chat_id', chatId).maybeSingle()
  return (data as Employee) ?? null
}

async function onMessage(msg: { chat: { id: number }; text: string }) {
  const chatId = msg.chat.id
  const text = msg.text.trim()

  if (text.startsWith('/start')) {
    const login = text.split(/\s+/)[1]?.toLowerCase()
    if (!login) {
      return sendTelegram(chatId, 'Здравствуйте! Это бот НарядAI.\nЧтобы получать наряды, отправьте: <b>/start ваш_логин</b>\nНапример: /start worker1')
    }
    const { data: emp } = await admin.from('employees').select('id, full_name, role').eq('login', login).maybeSingle()
    if (!emp) return sendTelegram(chatId, `Сотрудник с логином «${login}» не найден.`)
    await admin.from('employees').update({ telegram_chat_id: null }).eq('telegram_chat_id', chatId)
    await admin.from('employees').update({ telegram_chat_id: chatId }).eq('id', emp.id)
    const hint = emp.role === 'worker'
      ? 'Сюда будут приходить наряды. Команда /my — ваши активные наряды.'
      : 'Сюда будут приходить просрочки и эскалации. Спрашивайте: «кто свободен?», «что просрочено?», «отчёт за смену».'
    return sendTelegram(chatId, `✅ ${emp.full_name}, Telegram привязан.\n${hint}`)
  }

  const me = await employeeByChat(chatId)
  if (!me) return sendTelegram(chatId, 'Сначала привяжите аккаунт: /start ваш_логин')

  if (text === '/my' || /мои наряд/i.test(text)) return sendMyOrders(chatId, me)

  if (me.role === 'worker') {
    return sendTelegram(chatId, 'Используйте кнопки под нарядами или приложение. Команда /my — ваши наряды.')
  }

  if (/свобод/i.test(text)) return sendFree(chatId)
  if (/просроч/i.test(text)) return sendOverdue(chatId)
  return askAssistant(chatId, me, text)
}

async function onCallback(cb: { id: string; data: string; message?: { chat: { id: number }; message_id: number } }) {
  const chatId = cb.message?.chat.id
  const me = chatId ? await employeeByChat(chatId) : null
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: false })
  if (!me || !cb.message) return answer('Сначала привяжите аккаунт: /start логин')

  const [kind, idStr, extra] = cb.data.split(':')
  const orderId = Number(idStr)
  const o = await getOrderFull(orderId)
  if (!o) return answer('Наряд не найден')

  let rpc: { action: string; payload: Record<string, unknown>; done: string }
  if (kind === 'r') {
    if (me.role === 'worker') return answer('Только мастер может переназначить')
    rpc = { action: 'reassign', payload: { assignee_id: Number(extra) }, done: '🔁 Наряд переназначен' }
  } else if (ACTIONS[kind]) {
    if (o.assignee_id !== me.id) return answer('Это не ваш наряд')
    rpc = { action: ACTIONS[kind].action, payload: {}, done: ACTIONS[kind].done }
  } else {
    return answer('Неизвестное действие')
  }

  const { error } = await admin.rpc('change_order_status', {
    p_order_id: orderId,
    p_action: rpc.action,
    p_payload: { ...rpc.payload, actor_id: me.id, comment: 'через Telegram' },
  })
  if (error) return answer(error.message)

  await answer(rpc.done)
  const next = kind === 'a' || kind === 'q' ? [[{ text: '▶️ Начать исполнение', callback_data: `s:${orderId}` }]] : []
  await tg('editMessageReplyMarkup', {
    chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: next },
  })
  await sendTelegram(chatId!, `${rpc.done}: наряд №${o.number}, ${o.equipment?.name}.`)
  if (kind === 'r') {
    // уведомление новому исполнителю отправит фронт/мастер через /api/orders/notify-new; здесь — коротко в Telegram
    const { data: emp } = await admin.from('employees').select('telegram_chat_id').eq('id', Number(extra)).single()
    if (emp?.telegram_chat_id) {
      await sendTelegram(emp.telegram_chat_id, `🛠 Вам переназначен наряд №${o.number}\n${o.equipment?.name}, ${o.site?.name}\n${o.description}`,
        [[{ text: '✅ Принять', callback_data: `a:${o.id}` }, { text: '⏳ В очередь', callback_data: `q:${o.id}` }]])
    }
  }
}

async function sendMyOrders(chatId: number, me: Employee) {
  const { data } = await admin
    .from('orders')
    .select('id, number, status, deadline, priority, equipment:equipment_id(name)')
    .eq('assignee_id', me.id)
    .in('status', ['issued', 'accepted', 'queued', 'in_progress', 'paused', 'needs_rework'])
    .order('deadline')
  if (!data?.length) return sendTelegram(chatId, 'Активных нарядов нет 👍')
  const lines = data.map((o: any) =>
    `${o.priority === 'emergency' ? '🚨' : '•'} №${o.number} ${o.equipment?.name} — ${ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL]}, срок ${hhmm(o.deadline)}`)
  return sendTelegram(chatId, `Ваши наряды:\n${lines.join('\n')}`)
}

async function sendFree(chatId: number) {
  const { data: st } = await admin.from('v_employee_status').select('employee_id').eq('status', 'free')
  const ids = (st ?? []).map((r) => r.employee_id)
  if (!ids.length) return sendTelegram(chatId, 'Свободных исполнителей сейчас нет.')
  const { data } = await admin.from('employees').select('full_name, specialty').in('id', ids).order('specialty')
  return sendTelegram(chatId, `🟢 Свободны:\n${(data ?? []).map((e) => `• ${e.full_name} — ${e.specialty}`).join('\n')}`)
}

async function sendOverdue(chatId: number) {
  const { data } = await admin
    .from('orders')
    .select('number, deadline, equipment:equipment_id(name), assignee:assignee_id(full_name)')
    .eq('is_overdue', true)
    .not('status', 'in', '(closed,cancelled)')
  if (!data?.length) return sendTelegram(chatId, 'Просроченных нарядов нет 👍')
  return sendTelegram(chatId, `🔴 Просрочены:\n${data.map((o: any) =>
    `• №${o.number} ${o.equipment?.name} — ${o.assignee?.full_name ?? '—'}, срок был ${hhmm(o.deadline)}`).join('\n')}`)
}

async function askAssistant(chatId: number, me: Employee, question: string) {
  if (!process.env.APP_URL) return sendTelegram(chatId, 'ИИ-ассистент пока не подключён. Спросите: «кто свободен?» или «что просрочено?»')
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
  const r = await fetch(`${process.env.APP_URL}/api/ai/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.CRON_SECRET ?? '' },
    body: JSON.stringify({ question, employee_id: me.id }),
  })
  const body = r.ok ? ((await r.json()) as { answer?: string }) : null
  return sendTelegram(chatId, body?.answer ?? 'Не удалось получить ответ ИИ-ассистента. Попробуйте позже.')
}
