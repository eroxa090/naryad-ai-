// Речь → текст (Whisper large-v3 через Groq, русский и казахский определяются автоматически).
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq, { toFile } from 'groq-sdk'
import type { TranscribeReq, TranscribeRes } from '../../shared/types.js'
import { onlyPost, requireEmployee } from '../_lib/auth.js'

const DEMO_TEXT = 'Насос Н-2 на обогатительной фабрике, течёт масло, срочно'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyPost(req, res)) return
  if (!(await requireEmployee(req, res))) return
  const { audio_base64, mime } = (req.body ?? {}) as TranscribeReq
  if (!audio_base64) return res.status(400).json({ error: 'Нет аудио' })

  if (!process.env.GROQ_API_KEY) return res.status(200).json({ text: DEMO_TEXT } satisfies TranscribeRes)

  const ext = mime?.includes('mp4') ? 'mp4' : mime?.includes('ogg') ? 'ogg' : 'webm'
  const file = await toFile(Buffer.from(audio_base64, 'base64'), `voice.${ext}`, { type: mime || 'audio/webm' })
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  try {
    const out = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3',
      // подсказка словаря повышает точность названий оборудования и терминов
      prompt: 'Наряд на ремонт: насос, конвейер, дробилка КМД-1750, мельница, грохот, подшипник, течь масла, ППР.',
      temperature: 0,
    })
    res.status(200).json({ text: out.text.trim() } satisfies TranscribeRes)
  } catch (e) {
    console.error('transcribe failed', e)
    res.status(502).json({ error: 'Не удалось распознать речь' })
  }
}
