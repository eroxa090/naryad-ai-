const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

export interface InlineButton { text: string; callback_data?: string; url?: string }

export async function sendTelegram(chatId: number, text: string, buttons?: InlineButton[][]): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return
  const res = await fetch(`${API()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    }),
  })
  if (!res.ok) console.error('telegram send failed', res.status, await res.text())
}
