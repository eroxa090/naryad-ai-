import { t } from '../lib/i18n'
import i18n from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { api } from '../lib/api'
import { message } from '../lib/supabase'

// Распознавание речи:
// 1) запись уходит на сервер (Whisper через Groq с подсказкой кодов оборудования) — точнее всего;
// 2) если сервер недоступен — встроенное распознавание браузера (Web Speech API, ru-RU / kk-KZ);
// 3) если ни то ни другое недоступно — честная ошибка, никаких подставных фраз.
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
const RecognitionCtor = (): (new () => Recognition) | undefined =>
  (window as unknown as Record<string, new () => Recognition>).SpeechRecognition ??
  (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition

export function Voice({ onText }: { onText: (text: string) => void | Promise<void> }) {
  const recorder = useRef<MediaRecorder | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const [state, setState] = useState<'idle' | 'recording' | 'loading'>('idle')
  const [error, setError] = useState('')
  const [heard, setHeard] = useState('')
  const useBrowser = useRef(false)

  useEffect(
    () => () => {
      recognition.current?.abort()
      if (recorder.current) {
        recorder.current.onstop = null
        if (recorder.current.state !== 'inactive') recorder.current.stop()
        recorder.current.stream.getTracks().forEach((tr) => tr.stop())
      }
    },
    [],
  )

  async function finish(text: string) {
    const clean = text.trim()
    if (!clean) {
      setError(t('Ничего не распознано. Говорите ближе к телефону и повторите.'))
      return
    }
    setHeard(clean)
    setState('loading')
    try {
      await onText(clean)
    } catch (e) {
      setError(message(e))
    } finally {
      setState('idle')
    }
  }

  function startBrowser(Ctor: new () => Recognition) {
    const r = new Ctor()
    recognition.current = r
    r.lang = i18n.language === 'kk' ? 'kk-KZ' : 'ru-RU'
    r.continuous = true
    r.interimResults = true
    let final = ''
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) final += res[0].transcript + ' '
        else interim += res[0].transcript
      }
      setHeard((final + interim).trim())
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed') setError(t('Нет доступа к микрофону. Разрешите его в настройках браузера.'))
      else if (e.error !== 'aborted' && e.error !== 'no-speech') setError(`${t('Ошибка распознавания')}: ${e.error}`)
    }
    r.onend = () => {
      recognition.current = null
      void finish(final)
    }
    r.start()
    setState('recording')
  }

  async function startRecorder() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error(t('Запись недоступна. Введите текст вручную; микрофон требует HTTPS.'))
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const r = new MediaRecorder(stream)
    recorder.current = r
    const chunks: Blob[] = []
    r.ondataavailable = (e) => chunks.push(e.data)
    r.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop())
      setState('loading')
      try {
        const blob = new Blob(chunks, { type: r.mimeType })
        if (blob.size > 8 * 1024 * 1024) throw new Error(t('Запись слишком длинная. Запишите короткое описание.'))
        const audio_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        await finish((await api.transcribe({ audio_base64, mime: r.mimeType })).text)
      } catch (e) {
        setState('idle')
        if (RecognitionCtor()) {
          useBrowser.current = true
          setError(t('Сервер распознавания недоступен. Нажмите ещё раз — распознаем прямо в телефоне.'))
        } else setError(message(e))
      }
    }
    r.start()
    setState('recording')
  }

  async function start() {
    setError('')
    setHeard('')
    try {
      const Ctor = RecognitionCtor()
      const canRecord = typeof navigator.mediaDevices?.getUserMedia === 'function' && 'MediaRecorder' in window
      if (Ctor && (useBrowser.current || !canRecord)) startBrowser(Ctor)
      else await startRecorder()
    } catch (e) {
      setError(message(e))
      setState('idle')
    }
  }

  function stop() {
    if (recognition.current) recognition.current.stop()
    else recorder.current?.stop()
  }

  return (
    <div className="voice">
      <button
        type="button"
        className={state === 'recording' ? 'danger big' : 'secondary big'}
        disabled={state === 'loading'}
        onClick={() => (state === 'recording' ? stop() : void start())}
      >
        {state === 'recording' ? (
          <>
            <Square aria-hidden size={22} /> {t('Закончить запись')}
          </>
        ) : state === 'loading' ? (
          t('Распознаём…')
        ) : (
          <>
            <Mic aria-hidden size={22} /> {t('Нажмите и продиктуйте')}
          </>
        )}
      </button>
      {state === 'recording' && <p className="muted">{t('Говорите: оборудование, что случилось, срочность.')}</p>}
      {heard && (
        <p className="heard">
          {t('Распознано')}: «{heard}»
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}
