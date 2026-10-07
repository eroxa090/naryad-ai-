import i18n from '../lib/i18n'
import { t } from '../lib/i18n'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABEL,
  PRIORITY_LABEL,
} from '../../shared/types'
import type { Employee, Order, OrderStatus } from '../../shared/types'
import { type AppData, dateLabel, liveLabels } from '../lib/data'
import { changeStatus } from '../lib/offline'
import { message } from '../lib/supabase'
function Card({
  order,
  data,
  draggable,
}: {
  order: Order
  data: AppData
  draggable: boolean
}) {
  const { setNodeRef, isDragging, listeners, attributes } = useDraggable({
    id: order.id,
    disabled: !draggable,
  })
  return (
    <article
      ref={setNodeRef}
      className={`order ${order.priority === 'emergency' ? 'emergency' : ''}`}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="row">
        <span className="eyebrow">№ {order.number}</span>
        <span className={`badge ${order.status}`}>
          {t(ORDER_STATUS_LABEL[order.status])}
        </span>
      </div>
      <Link to={`/orders/${order.id}`}>
        <h3>{order.description}</h3>
      </Link>
      <p>{data.equipment.find((e) => e.id === order.equipment_id)?.name}</p>
      <p>
        {data.employees.find((e) => e.id === order.assignee_id)?.full_name ||
          t('Не назначен')}
      </p>
      <small className={order.is_overdue ? 'error' : ''}>
        {order.is_overdue ? t('Просрочен · ') : ''}
        {t('Срок:')} {dateLabel(order.deadline)}
      </small>
      {draggable && (
        <button
          className="drag secondary"
          aria-label={`Переместить наряд ${order.number}`}
          {...listeners}
          {...attributes}
        >
          {t('↔ Переместить')}
        </button>
      )}
    </article>
  )
}
function Column({
  status,
  orders,
  data,
  draggable,
}: {
  status: OrderStatus
  orders: Order[]
  data: AppData
  draggable: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section ref={setNodeRef} className={`column ${isOver ? 'over' : ''}`}>
      <h2>
        {t(ORDER_STATUS_LABEL[status])} <small>{orders.length}</small>
      </h2>
      {orders.map((o) => (
        <Card key={o.id} order={o} data={data} draggable={draggable} />
      ))}
      {!orders.length && <p className="muted">{t('Нет нарядов')}</p>}
    </section>
  )
}
export function Board({ data, me }: { data: AppData; me: Employee }) {
  const [site, setSite] = useState(''),
    [equipment, setEquipment] = useState(''),
    [worker, setWorker] = useState(''),
    [priority, setPriority] = useState(''),
    [archive, setArchive] = useState(false),
    [overdue, setOverdue] = useState(false),
    [notice, setNotice] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor),
  )
  const isWorker = me.role === 'worker',
    canEdit = ['master', 'admin'].includes(me.role)
  const orders = data.orders.filter(
    (o) =>
      (!isWorker || o.assignee_id === me.id) &&
      (!site || o.site_id === Number(site)) &&
      (!equipment || o.equipment_id === Number(equipment)) &&
      (!worker || o.assignee_id === Number(worker)) &&
      (!priority || o.priority === priority) &&
      (archive || !['closed', 'cancelled'].includes(o.status)) &&
      (!overdue || o.is_overdue),
  )
  const onShift = data.statuses.filter((s) =>
    data.employees.some((e) => e.id === s.employee_id && e.on_shift),
  )
  const rating = data.ratings.find((r) => r.employee_id === me.id)
  const [now] = useState(() => new Date())
  const start = new Date(now)
  if (start.getHours() < 8) start.setDate(start.getDate() - 1)
  start.setHours(now.getHours() >= 8 && now.getHours() < 20 ? 8 : 20, 0, 0, 0)
  const shiftOrders = data.orders.filter((o) => new Date(o.created_at) >= start)
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {now.toLocaleDateString(i18n.language === 'kk' ? 'kk-KZ' : 'ru-RU', {
              day: 'numeric',
              month: 'long',
            })}{' '}
            {t('· смена').trim()}{' '}
            {start.getHours() === 8 ? '08:00–20:00' : '20:00–08:00'}
          </p>
          <h1>{isWorker ? t('Мои наряды') : t('Панель смены')}</h1>
        </div>
        {canEdit && (
          <Link className="button" to="/new">
            {t('＋ Создать наряд')}
          </Link>
        )}
      </div>
      {!isWorker && (
        <>
          <div className="stats">
            {[
              [t('Выдано за смену'), shiftOrders.length],
              [
                t('Выполнено за смену'),
                data.orders.filter(
                  (o) => o.submitted_at && new Date(o.submitted_at) >= start,
                ).length,
              ],
              [
                t('Просрочено'),
                data.orders.filter(
                  (o) =>
                    o.is_overdue && !['closed', 'cancelled'].includes(o.status),
                ).length,
              ],
              [
                t('Свободных людей'),
                onShift.filter((s) => s.status === 'free').length,
              ],
            ].map(([label, value]) => (
              <div className="panel" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <details className="panel">
            <summary>
              {t('Люди на смене ·')}
              {onShift.length}
            </summary>
            <div className="people">
              {onShift.map((s) => (
                <div key={s.employee_id} className="person">
                  <span className={`dot ${s.status}`} />
                  <div>
                    <b>
                      {
                        data.employees.find((e) => e.id === s.employee_id)
                          ?.full_name
                      }
                    </b>
                    <small>
                      {t(liveLabels[s.status])}
                      {t('· в очереди')}
                      {s.queue_count}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      {isWorker && (
        <details className="panel">
          <summary>
            {t('Мой рейтинг:')}{' '}
            {rating
              ? `${Number(rating.rating).toFixed(1)} / 100`
              : t('пока нет закрытых нарядов')}
          </summary>
          <p>
            {t(
              'За последние 30 дней: 35% качество + 25% в срок + 20% без возвратов + 15% сложность − 5% штраф за необоснованные отказы.',
            )}
          </p>
          {rating && (
            <p>
              {t('Закрыто:')}
              {rating.closed_count}
              {t('; качество:')}
              {rating.quality}
              {t('%; в срок:')}
              {rating.on_time_rate}
              {t('%; возвраты:')}
              {rating.rework_rate}%.
            </p>
          )}
        </details>
      )}
      <section className="filters panel">
        <label>
          {t('Участок')}
          <select
            aria-label={t('Участок')}
            value={site}
            onChange={(e) => {
              setSite(e.target.value)
              setEquipment('')
            }}
          >
            <option value="">{t('Все участки')}</option>
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
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          >
            <option value="">{t('Всё оборудование')}</option>
            {data.equipment
              .filter((e) => !site || e.site_id === Number(site))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        {!isWorker && (
          <label>
            {t('Исполнитель')}
            <select
              aria-label={t('Исполнитель')}
              value={worker}
              onChange={(e) => setWorker(e.target.value)}
            >
              <option value="">{t('Все исполнители')}</option>
              {data.employees
                .filter((e) => e.role === 'worker')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          {t('Приоритет')}
          <select
            aria-label={t('Приоритет')}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">{t('Все приоритеты')}</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => setArchive(e.target.checked)}
          />
          {t('Архив')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
          />
          {t('Просроченные')}
        </label>
      </section>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <DndContext
        sensors={sensors}
        onDragEnd={async (e) => {
          if (!e.over) return
          const o = orders.find((o) => o.id === e.active.id)
          if (!o || o.status === e.over.id) return
          const target = e.over.id
          if (!canEdit) return
          try {
            if (target === 'closed' && o.status === 'submitted') {
              if (window.confirm(`Закрыть наряд №${o.number}?`))
                setNotice(
                  await changeStatus({ p_order_id: o.id, p_action: 'close' }),
                )
            } else if (target === 'cancelled') {
              if (window.confirm(`Отменить наряд №${o.number}?`))
                setNotice(
                  await changeStatus({ p_order_id: o.id, p_action: 'cancel' }),
                )
            } else if (target === 'needs_rework' && o.status === 'submitted') {
              const reason = window.prompt(t('Причина доработки'))
              if (reason?.trim())
                setNotice(
                  await changeStatus({
                    p_order_id: o.id,
                    p_action: 'rework',
                    p_payload: { reason, comment: reason },
                  }),
                )
            } else
              setNotice(
                t(
                  'Этот переход выполняет исполнитель. Откройте карточку для доступных действий.',
                ),
              )
          } catch (error) {
            setNotice(message(error))
          }
        }}
      >
        <div className={isWorker ? 'worker-board' : 'board'}>
          {ORDER_STATUSES.filter(
            (s) => archive || !['closed', 'cancelled'].includes(s),
          ).map((s) => (
            <Column
              key={s}
              status={s}
              orders={orders.filter((o) => o.status === s)}
              data={data}
              draggable={canEdit}
            />
          ))}
        </div>
      </DndContext>
    </>
  )
}
