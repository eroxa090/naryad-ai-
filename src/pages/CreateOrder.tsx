import { t } from '../lib/i18n'
import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Employee, OrderType, Priority, SuggestWorkerRes } from '../../shared/types'
import { PRIORITY_LABEL } from '../../shared/types'
import { type AppData, liveLabels } from '../lib/data'
import { api } from '../lib/api'
import { message, queryClient, supabase } from '../lib/supabase'
import { uploadPhotos } from '../lib/photos'
import { Voice } from '../components/Voice'
export function CreateOrder({ data, me }: { data: AppData; me: Employee }) {
  const [params] = useSearchParams()
  const initial = data.equipment.find(
    (e) => e.id === Number(params.get('equipment')),
  )
  const [site, setSite] = useState(initial?.site_id || data.sites[0]?.id || 0),
    [equipment, setEquipment] = useState(initial?.id || 0),
    [description, setDescription] = useState(''),
    [assignee, setAssignee] = useState(0),
    [priority, setPriority] = useState<Priority>('normal'),
    [type, setType] = useState<OrderType>('emergency'),
    [fault, setFault] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [candidates, setCandidates] = useState<SuggestWorkerRes['candidates']>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState<number | null>(null),
    [voiceHint, setVoiceHint] = useState('')
  const navigate = useNavigate()
  const suggestionRequest = useRef(0)
  const [deadline] = useState(() => {
    const d = new Date(Date.now() + 2 * 3600000)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16)
  })
  async function suggest(id: number) {
    const request = ++suggestionRequest.current
    setEquipment(id)
    setCandidates([])
    if (!id) return
    try {
      const result = await api.suggestWorker({
        equipment_id: id,
        fault_code: fault || null,
      })
      if (request !== suggestionRequest.current) return
      setCandidates(result.candidates)
      if (result.candidates[0]) setAssignee(result.candidates[0].employee_id)
    } catch (e) {
      setError(message(e))
    }
  }
  return (
    <>
      <h1>{t('Новый наряд')}</h1>
      <p>
        {t('Продиктуйте задачу, проверьте оборудование и исполнителя, выдайте наряд.')}
      </p>
      <form
        className="panel form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (busy || created) return
          setBusy(true)
          setError('')
          let id: number | null = null
          try {
            if (!equipment || !assignee || !description.trim())
              throw new Error(t('Укажите задачу, оборудование и исполнителя'))
            if (files.length > 5) throw new Error(t('Не больше 5 фотографий'))
            const f = new FormData(e.currentTarget)
            const { data: order, error } = await supabase
              .from('orders')
              .insert({
                description: description.trim(),
                site_id: site,
                equipment_id: equipment,
                assignee_id: assignee,
                master_id: me.id,
                priority,
                type,
                deadline: new Date(String(f.get('deadline'))).toISOString(),
                fault_code: fault || null,
              })
              .select('id')
              .single()
            if (error) throw error
            id = order.id
            setCreated(id)
            await uploadPhotos(files, id!, 'before', me.id)
            try {
              await api.notifyNew(id!)
            } catch (error) {
              setError(
                `${t('Наряд создан. Уведомление не отправлено:')} ${message(error)}`,
              )
              await queryClient.invalidateQueries()
              return
            }
            await queryClient.invalidateQueries()
            navigate(`/orders/${id}`)
          } catch (e) {
            setError(
              `${id ? `${t('Наряд уже создан, повторно не выдавайте. Фото можно добавить в карточке.')} ` : ''}${message(e)}`,
            )
            if (id) await queryClient.invalidateQueries()
          } finally {
            setBusy(false)
          }
        }}
      >
        <Voice
          onText={async (text) => {
            setVoiceHint('')
            const parsed = await api.parseOrder({ text })
            const misses = [
              !parsed.equipment_id && t('оборудование'),
              !parsed.fault_code && t('что случилось'),
            ].filter(Boolean)
            if (misses.length)
              setVoiceHint(
                `${t('Не понял')}: ${misses.join(', ')}. ${t('Скажите, например: «Насос Н-2, течёт масло, срочно» — или выберите вручную.')}`,
              )
            setDescription(parsed.description)
            setPriority(parsed.priority)
            setType(parsed.type)
            setFault(parsed.fault_code || '')
            if (parsed.site_id) setSite(parsed.site_id)
            const found = data.equipment.find(
              (e) => e.id === parsed.equipment_id,
            )
            if (found) {
              setSite(found.site_id)
              await suggest(found.id)
            }
          }}
        />
        {voiceHint && <p className="notice">⚠️ {voiceHint}</p>}
        <label>
          {t('Задача')}
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('Что нужно сделать?')}
          />
        </label>
        <div className="grid2">
          <label>
            {t('Участок')}
            <select
              aria-label={t('Участок')}
              value={site}
              onChange={(e) => {
                setSite(Number(e.target.value))
                suggestionRequest.current++
                setEquipment(0)
                setCandidates([])
              }}
            >
              {data.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Оборудование')}
            <select
              aria-label={t('Оборудование')}
              required
              value={equipment || ''}
              onChange={(e) => void suggest(Number(e.target.value))}
            >
              <option value="">{t('Выберите оборудование')}</option>
              {data.equipment
                .filter((e) => e.site_id === site)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.inv_number}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label>
          {t('Исполнитель')}
          <select
            aria-label={t('Исполнитель')}
            required
            value={assignee || ''}
            onChange={(e) => setAssignee(Number(e.target.value))}
          >
            <option value="">{t('Выберите исполнителя')}</option>
            {data.employees
              .filter((e) => e.role === 'worker')
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {workerLabel(data, e)}
                </option>
              ))}
          </select>
        </label>
        {candidates.find((c) => c.employee_id === assignee) && (
          <p className="notice">
            {t('ИИ-подсказка:')}{' '}
            {candidates.find((c) => c.employee_id === assignee)?.reason}
          </p>
        )}
        <div className="grid2">
          <label>
            {t('Тип работ')}
            <select
              aria-label={t('Тип работ')}
              value={type}
              onChange={(e) => setType(e.target.value as OrderType)}
            >
              <option value="emergency">{t('Внеплановый (поломка)')}</option>
              <option value="planned">{t('Плановый (ППР, ТО)')}</option>
            </select>
          </label>
          <label>
            {t('Приоритет')}
            <select
              aria-label={t('Приоритет')}
              value={priority}
              onChange={(e) => {
                const next = e.target.value as Priority
                setPriority(next)
                if (next === 'planned') setType('planned')
                if (next === 'emergency') setType('emergency')
              }}
            >
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid2">
          <label>
            {t('Срок')}
            <input
              required
              type="datetime-local"
              name="deadline"
              defaultValue={deadline}
            />
          </label>
        </div>
        <label>
          {t('Шифр неисправности')}
          <select
            aria-label={t('Шифр неисправности')}
            value={fault}
            onChange={(e) => setFault(e.target.value)}
          >
            <option value="">{t('Уточнит исполнитель')}</option>
            {data.faults.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code} · {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          📷 {t('Фото до работ · до 5')}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
        </label>
        <p>{t('Выбрано фото:')} {files.length}</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {created ? (
          <Link className="button" to={`/orders/${created}`}>
            {t('Открыть созданный наряд')}
          </Link>
        ) : (
          <button disabled={busy}>{busy ? t('Выдаём…') : t('Выдать наряд')}</button>
        )}
      </form>
    </>
  )
}
// «Иванов · В работе · выполняет наряд №N · в очереди 2 · Слесарь»
function workerLabel(data: AppData, e: Employee) {
  const live = data.statuses.find((s) => s.employee_id === e.id)
  const current = data.orders.find((o) => o.id === live?.current_order_id)
  return [
    e.full_name,
    t(liveLabels[live?.status || 'off_shift']),
    live?.current_order_id &&
      `${t('выполняет наряд №')}${current?.number ?? live.current_order_id}`,
    live?.queue_count ? `${t('в очереди')} ${live.queue_count}` : '',
    e.specialty,
  ]
    .filter(Boolean)
    .join(' · ')
}
