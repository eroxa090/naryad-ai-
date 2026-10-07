import { t } from '../lib/i18n'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type {
  AiReview,
  Employee,
  OrderAction,
  Order,
  OrderEvent,
  OrderMaterial,
  OrderPhoto,
} from '../../shared/types'
import { ORDER_STATUS_LABEL } from '../../shared/types'
import { type AppData, dateLabel } from '../lib/data'
import { message, queryClient, supabase } from '../lib/supabase'
import {
  changeStatus,
  queueAction,
  cached,
  offline,
  flushActions,
} from '../lib/offline'
import { uploadPhotos } from '../lib/photos'
import { api } from '../lib/api'
import { Voice } from '../components/Voice'
// Совпадают с уважительными причинами в worker_rating (supabase/migrations/001_init.sql):
// остальные отказы снижают рейтинг исполнителя.
const REJECT_REASONS = [
  'Нет материалов',
  'Нет допуска',
  'Занят аварийным',
  'Не на смене',
  'Нет инструмента',
]
export function OrderDetail({ data, me }: { data: AppData; me: Employee }) {
  const { id } = useParams()
  const current = data.orders.find((o) => o.id === Number(id))
  const archived = useQuery({
    queryKey: ['archived-order', id],
    enabled: !current,
    networkMode: 'always',
    queryFn: () =>
      cached(`archived-order:${id}`, async () => {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('id', id)
          .single()
        if (error) throw error
        return data as Order
      }),
  })
  const order = current || archived.data
  const [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [work, setWork] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [materials, setMaterials] = useState<
      { material_id: number; qty: number }[]
    >([]),
    [mockReview, setMockReview] = useState<AiReview | null>(null),
    [rejecting, setRejecting] = useState(false)
  const detail = useQuery({
    queryKey: ['order', id],
    networkMode: 'always',
    queryFn: () =>
      cached(`order:${id}`, async () => {
        const [events, photos, reviews, materials] = await Promise.all([
          supabase
            .from('order_events')
            .select('*')
            .eq('order_id', id)
            .order('created_at'),
          supabase.from('order_photos').select('*').eq('order_id', id),
          supabase
            .from('ai_reviews')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: false }),
          supabase.from('order_materials').select('*').eq('order_id', id),
        ])
        for (const r of [events, photos, reviews, materials])
          if (r.error) throw r.error
        const signed = await Promise.all(
          (photos.data as OrderPhoto[]).map(async (p) => {
            const { data, error } = await supabase.storage
              .from('photos')
              .createSignedUrl(p.storage_path, 3600)
            if (error) throw error
            return { ...p, url: data.signedUrl }
          }),
        )
        return {
          events: events.data as OrderEvent[],
          photos: signed,
          reviews: reviews.data as AiReview[],
          materials: materials.data as OrderMaterial[],
        }
      }),
  })
  if (!order)
    return (
      <p>
        {t('Наряд не найден.')}
        <Link to="/orders">{t('Вернуться к списку')}</Link>
      </p>
    )
  if (me.role === 'worker' && order.assignee_id !== me.id)
    return <p>{t('Этот наряд назначен другому исполнителю.')}</p>
  const master = ['master', 'admin'].includes(me.role),
    worker = me.role === 'worker' && order.assignee_id === me.id,
    review = detail.data?.reviews[0] || mockReview
  async function run(fn: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await fn()
      setNotice(typeof result === 'string' ? result : t('Готово'))
      await queryClient.invalidateQueries()
    } catch (e) {
      setNotice(message(e))
    } finally {
      setBusy(false)
    }
  }
  function reject(reason: string) {
    setRejecting(false)
    void run(() =>
      changeStatus({
        p_order_id: order!.id,
        p_action: 'reject',
        p_payload: { reason, comment: reason },
      }),
    )
  }
  function action(action: OrderAction) {
    if (action === 'reject') {
      setRejecting(true)
      return
    }
    const reason = ['pause', 'rework'].includes(action)
      ? window.prompt(t('Укажите причину'))
      : null
    if (['pause', 'rework'].includes(action) && !reason?.trim()) return
    if (
      ['close', 'cancel'].includes(action) &&
      !window.confirm(
        `${action === 'close' ? t('Закрыть') : t('Отменить')} наряд №${order!.number}?`,
      )
    )
      return
    void run(() =>
      changeStatus({
        p_order_id: order!.id,
        p_action: action,
        p_payload: reason
          ? { reason: reason.trim(), comment: reason.trim() }
          : {},
      }),
    )
  }
  const actions: [OrderAction, string][] = []
  if (worker) {
    if (order.status === 'issued') actions.push(['accept', t('Принять')])
    if (['issued', 'accepted'].includes(order.status))
      actions.push(['queue', t('В очередь')])
    if (['issued', 'accepted', 'queued'].includes(order.status))
      actions.push(['reject', t('Отклонить')])
    if (['accepted', 'queued', 'needs_rework'].includes(order.status))
      actions.push(['start', t('Начать')])
    if (order.status === 'in_progress')
      actions.push(['pause', t('Приостановить')])
    if (order.status === 'paused') actions.push(['resume', t('Продолжить')])
  }
  return (
    <>
      <Link className="back" to="/orders">
        {t('← Все наряды')}
      </Link>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {t('НАРЯД №')}
            {order.number}
          </p>
          <h1>{order.description}</h1>
        </div>
        <span
          className={`badge ${order.priority === 'emergency' ? 'emergency' : order.status}`}
        >
          {order.priority === 'emergency'
            ? t('Аварийный · ')
            : order.type === 'emergency'
              ? t('Внеплановый · ')
              : t('Плановый · ')}
          {t(ORDER_STATUS_LABEL[order.status])}
        </span>
      </div>
      <div className="grid2">
        <section className="panel">
          <h2>{t('Задание')}</h2>
          <p>
            {data.sites.find((s) => s.id === order.site_id)?.name} /{' '}
            {data.equipment.find((e) => e.id === order.equipment_id)?.name}
          </p>
          <p>
            {t('Исполнитель:')}{' '}
            {data.employees.find((e) => e.id === order.assignee_id)
              ?.full_name || t('Не назначен')}
          </p>
          <p className={order.is_overdue ? 'error' : ''}>
            {t('Срок:')}
            {dateLabel(order.deadline)}
          </p>
          <div className="actions">
            {!worker &&
              actions.map(([a, label]) => (
                <button disabled={busy} key={a} onClick={() => action(a)}>
                  {label}
                </button>
              ))}
            {master && order.status === 'submitted' && (
              <>
                <button disabled={busy} onClick={() => action('close')}>
                  {t('Закрыть наряд')}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => action('rework')}
                >
                  {t('На доработку')}
                </button>
              </>
            )}
            {master && !['closed', 'cancelled'].includes(order.status) && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => action('cancel')}
              >
                {t('Отменить наряд')}
              </button>
            )}
          </div>
          {master &&
            ['issued', 'accepted', 'queued', 'rejected'].includes(
              order.status,
            ) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  void run(() =>
                    changeStatus({
                      p_order_id: order.id,
                      p_action: 'reassign',
                      p_payload: { assignee_id: Number(f.get('assignee')) },
                    }),
                  )
                }}
              >
                <label>
                  {t('Переназначить')}
                  <select
                    aria-label={t('Переназначить')}
                    name="assignee"
                    defaultValue={order.assignee_id || ''}
                    required
                  >
                    {data.employees
                      .filter((e) => e.role === 'worker')
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="secondary" disabled={busy}>
                  {t('Назначить')}
                </button>
              </form>
            )}
        </section>
        <section className="panel">
          <h2>{t('Проверка качества')}</h2>
          {review ? (
            <>
              <strong className="score">
                {review.master_score ?? review.score} / 5
              </strong>
              <p>
                {review.verdict === 'needs_rework'
                  ? t('Нужна доработка')
                  : review.verdict === 'accepted'
                    ? t('Принято')
                    : t('Принято с замечаниями')}
              </p>
              <p>{review.explanation}</p>
              <h3>{t('Обратная связь исполнителю')}</h3>
              <p>{review.worker_feedback}</p>
              {review.checks.map((c, i) => (
                <p key={i}>
                  {c.ok ? '✓' : '!'} {c.note}
                </p>
              ))}
              {review.master_comment && (
                <p>
                  {t('Мастер:')}
                  {review.master_comment}
                </p>
              )}
              {master && review.id > 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const f = new FormData(e.currentTarget)
                    void run(async () => {
                      const { error } = await supabase.rpc(
                        'master_override_review',
                        {
                          p_review_id: review.id,
                          p_score: Number(f.get('score')),
                          p_comment: String(f.get('comment')),
                        },
                      )
                      if (error) throw error
                    })
                  }}
                >
                  <label>
                    {t('Оценка мастера')}
                    <select
                      aria-label={t('Оценка мастера')}
                      name="score"
                      defaultValue={review.master_score ?? review.score}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Объяснение')}
                    <input name="comment" required />
                  </label>
                  <button disabled={busy}>{t('Изменить оценку')}</button>
                </form>
              )}
            </>
          ) : (
            <p>{t('Оценка появится после исполнения и проверки.')}</p>
          )}
          {['submitted', 'needs_rework'].includes(order.status) &&
            (worker || master) && (
              <button
                disabled={busy}
                className="secondary"
                onClick={() =>
                  void run(async () => {
                    setMockReview(await api.checkOrder({ order_id: order.id }))
                    return t('Проверка выполнена')
                  })
                }
              >
                {t('Проверить ИИ')}
              </button>
            )}
        </section>
      </div>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {detail.error && (
        <p role="alert" className="error">
          {message(detail.error)}{' '}
          <button onClick={() => void detail.refetch()}>
            {t('Повторить загрузку')}
          </button>
        </p>
      )}
      {worker && order.status === 'in_progress' && (
        <form
          id="submit-form"
          className="panel form"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            void run(async () => {
              if (!work.trim()) throw new Error(t('Опишите выполненные работы'))
              if (
                order.type === 'emergency' &&
                !files.length &&
                !detail.data?.photos.some((p) => p.kind === 'after')
              )
                throw new Error(
                  t('Для внепланового наряда обязательно фото после работ'),
                )
              if (
                materials.some(
                  (m) =>
                    !m.material_id || !Number.isFinite(m.qty) || m.qty <= 0,
                )
              )
                throw new Error(
                  t('Укажите материалы и положительное количество'),
                )
              if (files.length > 5) throw new Error(t('Не больше 5 фотографий'))
              if (
                !navigator.onLine ||
                (me.auth_user_id &&
                  (await offline.actions
                    .where('userId')
                    .equals(me.auth_user_id)
                    .count()))
              ) {
                const notice = await queueAction(
                  {
                    p_order_id: order.id,
                    p_action: 'submit',
                    p_payload: {
                      work_done: work.trim(),
                      fault_code: String(f.get('fault')),
                      comment: String(f.get('comment')),
                      materials,
                    },
                  },
                  files,
                  me.id,
                )
                if (navigator.onLine) void flushActions()
                return notice
              }
              await uploadPhotos(files, order.id, 'after', me.id)
              setFiles([])
              await changeStatus({
                p_order_id: order.id,
                p_action: 'submit',
                p_payload: {
                  work_done: work.trim(),
                  fault_code: String(f.get('fault')),
                  comment: String(f.get('comment')),
                  materials,
                },
              })
              try {
                setMockReview(await api.checkOrder({ order_id: order.id }))
                return t('Отчёт отправлен на проверку мастеру')
              } catch (e) {
                return `Отчёт сохранён. ИИ недоступен: ${message(e)}. Повторите проверку кнопкой «Проверить ИИ».`
              }
            })
          }}
        >
          <h2>{t('Исполнено · отчёт о работах')}</h2>
          <Voice onText={(text) => setWork(text)} />
          <label>
            {t('Выполненные работы')}
            <textarea
              required
              value={work}
              onChange={(e) => setWork(e.target.value)}
            />
          </label>
          <label>
            {t('Шифр')}
            <select
              aria-label={t('Шифр')}
              name="fault"
              required
              defaultValue={order.fault_code || ''}
            >
              <option value="">{t('Выберите шифр')}</option>
              {data.faults.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.code} · {f.name}
                </option>
              ))}
            </select>
          </label>
          <h3>{t('Материалы')}</h3>
          {materials.map((m, i) => (
            <div className="material-row" key={i}>
              <select
                aria-label={t('Материал')}
                required
                value={m.material_id || ''}
                onChange={(e) =>
                  setMaterials(
                    materials.map((m, j) =>
                      i === j
                        ? { ...m, material_id: Number(e.target.value) }
                        : m,
                    ),
                  )
                }
              >
                <option value="">{t('Материал')}</option>
                {data.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
              <input
                aria-label={t('Количество')}
                type="number"
                min="0.001"
                step="any"
                required
                value={m.qty}
                onChange={(e) =>
                  setMaterials(
                    materials.map((m, j) =>
                      i === j ? { ...m, qty: Number(e.target.value) } : m,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setMaterials(materials.filter((_, j) => j !== i))
                }
              >
                {t('Убрать')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setMaterials([...materials, { material_id: 0, qty: 1 }])
            }
          >
            {t('＋ Материал')}
          </button>
          <label>
            📷 {t('Фото после работ')}
            {order.type === 'emergency' ? t('(обязательно)') : ''}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <label>
            {t('Комментарий')}
            <textarea name="comment" />
          </label>
          <button className="big" disabled={busy}>
            {busy ? t('Отправляем…') : `📤 ${t('Исполнено — отправить отчёт')}`}
          </button>
        </form>
      )}
      {order.work_done && (
        <section className="panel">
          <h2>{t('Выполненные работы')}</h2>
          <p>{order.work_done}</p>
          <p>
            {t('Шифр:')}
            {order.fault_code}
          </p>
          <p>{order.comment}</p>
          {detail.data?.materials.map((m) => (
            <p key={m.id}>
              {data.materials.find((v) => v.id === m.material_id)?.name} —{' '}
              {m.qty} {data.materials.find((v) => v.id === m.material_id)?.unit}
            </p>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>{t('Фотографии')}</h2>
        <div className="photos">
          {detail.data?.photos.map((p) => (
            <figure key={p.id}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt={p.kind === 'before' ? t('До работ') : t('После работ')}
                />
              </a>
              <figcaption>
                {p.kind === 'before' ? t('До') : t('После')} · EXIF:{' '}
                {dateLabel(p.taken_at)}
              </figcaption>
            </figure>
          ))}
        </div>
        {master && !['closed', 'cancelled'].includes(order.status) && (
          <label>
            {t('Добавить фото до работ')}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                void run(() => uploadPhotos(files, order.id, 'before', me.id))
                e.target.value = ''
              }}
            />
          </label>
        )}
      </section>
      <section className="panel">
        <h2>{t('Хронология')}</h2>
        <ol className="timeline">
          {detail.data?.events.map((e) => (
            <li key={e.id}>
              <small>
                {dateLabel(e.created_at)} ·{' '}
                {data.employees.find((p) => p.id === e.actor_id)?.full_name ||
                  t('Система')}
              </small>
              <p>
                {e.to_status
                  ? t(ORDER_STATUS_LABEL[e.to_status])
                  : e.action === 'create'
                    ? t('Создан')
                    : e.action === 'ai_review'
                      ? t('Проверка ИИ')
                      : t('Обновление наряда')}
                {e.reason
                  ? ` · ${e.reason}`
                  : e.comment
                    ? ` · ${e.comment}`
                    : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
      {worker && (actions.length > 0 || order.status === 'in_progress') && (
        <>
          <div aria-hidden style={{ height: 190 }} />
          <div className="action-bar worker-bar" role="toolbar" aria-label={t('Действия по наряду')}>
            {(() => {
              const icon: Record<string, string> = { accept: '✅', start: '▶️', resume: '▶️', queue: '⏳', reject: '✋', pause: '⏸' }
              const primary = actions.find(([a]) => ['accept', 'start', 'resume'].includes(a))
              const rest = actions.filter((x) => x !== primary)
              if (rejecting) return (
              <div className="panel">
                <p>{t('Причина отказа:')}</p>
                <div className="actions">
                  {REJECT_REASONS.map((r) => (
                    <button
                      key={r}
                      className="secondary"
                      disabled={busy}
                      onClick={() => reject(r)}
                    >
                      {t(r)}
                    </button>
                  ))}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      const other = window
                        .prompt(t('Опишите причину отказа'))
                        ?.trim()
                      if (other) reject(`Другое: ${other}`)
                    }}
                  >
                    {t('Другое')}
                  </button>
                  <button
                    className="danger"
                    onClick={() => setRejecting(false)}
                  >
                    {t('Отмена')}
                  </button>
                </div>
              </div>
              )
              return (
                <>
                  {order.status === 'in_progress' ? (
                    <button
                      className="big"
                      disabled={busy}
                      onClick={() => document.getElementById('submit-form')?.scrollIntoView({ block: 'start' })}
                    >
                      📤 {t('Сдать работу')}
                    </button>
                  ) : (
                    primary && (
                      <button className="big" disabled={busy} onClick={() => action(primary[0])}>
                        {icon[primary[0]]} {primary[1]}
                      </button>
                    )
                  )}
                  {rest.length > 0 && (
                    <div className="more">
                      {rest.map(([a, label]) => (
                        <button key={a} className={a === 'reject' ? 'danger' : 'secondary'} disabled={busy} onClick={() => action(a)}>
                          {icon[a]} {a === 'pause' ? t('Пауза') : label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </>
      )}
    </>
  )
}
