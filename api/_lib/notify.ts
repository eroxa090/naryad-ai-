import type { Notification } from '../../shared/types.js'
import { admin } from './supabase.js'
import { sendTelegram, type InlineButton } from './telegram.js'

// Пишет уведомление в БД (приложение получает его через Realtime) и дублирует в Telegram.
export async function notify(
  employeeId: number,
  orderId: number | null,
  kind: Notification['kind'],
  text: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await admin.from('notifications').insert({ employee_id: employeeId, order_id: orderId, kind, text })
  const { data: emp } = await admin.from('employees').select('telegram_chat_id').eq('id', employeeId).single()
  if (emp?.telegram_chat_id) await sendTelegram(emp.telegram_chat_id, text, buttons)
}
