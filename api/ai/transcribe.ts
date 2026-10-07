// Речь → текст (Whisper large-v3 через Groq, русский и казахский определяются автоматически).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq, { toFile } from 'groq-sdk'
import type { TranscribeReq, TranscribeRes } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  if (!(await requireEmployee(req, res))) return
  const { audio_base64, mime } = (req.body ?? {}) as TranscribeReq
  if (!audio_base64) return res.status(400).json({ error: 'Нет аудио' })

  // Без ключа не подставляем выдуманный текст: фронт сообщит, что серверное распознавание не подключено.
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'Распознавание речи на сервере не подключено' })

  const ext = mime?.includes('mp4') ? 'mp4' : mime?.includes('ogg') ? 'ogg' : 'webm'
  const file = await toFile(Buffer.from(audio_base64, 'base64'), `voice.${ext}`, { type: mime || 'audio/webm' })
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  try {
    const out = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      // подсказка словаря повышает точность названий оборудования и терминов
      prompt:
        'Наряд на ремонт, коды кириллицей: насос Н-1, Н-2, Н-3; конвейер К-1, К-2, К-3, К-4, К-5; дробилка КМД-1750, ККД-1500, КСД-2200; ' +
        'мельница МШЦ-3600, МШР-3200; грохот ГИТ-51, ГИЛ-52; кран КМ-10; подшипник, течь масла, вибрация, ППР, срочно.',
      temperature: 0,
    })
    res.status(200).json({ text: out.text.trim() } satisfies TranscribeRes)
  } catch (e) {
    console.error('transcribe failed', e)
    res.status(502).json({ error: 'Не удалось распознать речь' })
  }
}
