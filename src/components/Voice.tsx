import { t } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { message } from '../lib/supabase'
export function Voice({
  onText,
}: {
  onText: (text: string) => void | Promise<void>
}) {
  const recorder = useRef<MediaRecorder | null>(null)
  const [state, setState] = useState<'idle' | 'recording' | 'loading'>('idle')
  const [error, setError] = useState('')
  useEffect(
    () => () => {
      if (recorder.current) {
        recorder.current.onstop = null
        if (recorder.current.state !== 'inactive') recorder.current.stop()
        recorder.current.stream.getTracks().forEach((t) => t.stop())
      }
    },
    [],
  )
  async function start() {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          t(
            'Запись недоступна. Введите текст вручную; микрофон требует HTTPS.',
          ),
        )
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream)
      recorder.current = r
      const chunks: Blob[] = []
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('loading')
        try {
          const blob = new Blob(chunks, { type: r.mimeType })
          if (blob.size > 8 * 1024 * 1024)
            throw new Error(
              t('Запись слишком длинная. Запишите короткое описание.'),
            )
          const audio_base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1])
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          await onText(
            (await api.transcribe({ audio_base64, mime: r.mimeType })).text,
          )
        } catch (e) {
          setError(message(e))
        } finally {
          setState('idle')
        }
      }
      r.start()
      setState('recording')
    } catch (e) {
      setError(message(e))
      setState('idle')
    }
  }
  return (
    <div>
      <button
        type="button"
        className={state === 'recording' ? 'danger' : 'secondary'}
        disabled={state === 'loading'}
        onClick={() =>
          state === 'recording' ? recorder.current?.stop() : void start()
        }
      >
        {state === 'recording'
          ? t('■ Закончить запись')
          : state === 'loading'
            ? t('Распознаём…')
            : t('🎙 Нажмите и продиктуйте')}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  )
}
