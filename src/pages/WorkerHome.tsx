import { useState } from 'react'
import { CircleCheckBig, Send, Timer, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ORDER_STATUS_LABEL } from '../../shared/types'
import type { Employee, Order } from '../../shared/types'
import { type AppData, dateLabel } from '../lib/data'
import { t } from '../lib/i18n'

const ACTIVE = ['needs_rework', 'in_progress', 'paused', 'issued', 'accepted', 'queued']

// Самое срочное сверху: аварийные → просроченные → на доработке → по сроку.
const urgency = (o: Order) =>
  (o.priority === 'emergency' ? 0 : 4) + (o.is_overdue ? 0 : 2) + (o.status === 'needs_rework' ? 0 : 1)

function dueText(o: Order, now: number) {
  const min = Math.round((Date.parse(o.deadline) - now) / 60_000)
  const span = (m: number) => (m >= 120 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`)
  if (min < 0) return { text: `${t('Просрочен на')} ${span(-min)}`, late: true }
  if (min < 24 * 60) return { text: `${t('Осталось')} ${span(min)}`, late: min <= 30 }
  return { text: `${t('Срок:')} ${dateLabel(o.deadline)}`, late: false }
}

const NEXT_STEP: Record<string, string> = {
  issued: 'Открыть и принять',
  accepted: 'Открыть и начать',
  queued: 'Открыть и начать',
  in_progress: 'Открыть и сдать работу',
  paused: 'Открыть и продолжить',
  needs_rework: 'Открыть и исправить',
}

export function WorkerHome({ data, me }: { data: AppData; me: Employee }) {
  const [now] = useState(() => Date.now())
  const [showDone, setShowDone] = useState(false)
  const mine = data.orders.filter((o) => o.assignee_id === me.id)
  const active = mine.filter((o) => ACTIVE.includes(o.status)).sort((a, b) => urgency(a) - urgency(b) || a.deadline.localeCompare(b.deadline))
  const done = mine.filter((o) => !ACTIVE.includes(o.status)).slice(0, 10)
  const rating = data.ratings.find((r) => r.employee_id === me.id)
  const eq = (id: number) => data.equipment.find((e) => e.id === id)
  const site = (id: number) => data.sites.find((s) => s.id === id)?.name

  const card = (o: Order) => {
    const due = dueText(o, now)
    return (
      <Link key={o.id} to={`/orders/${o.id}`} className={`my-card ${o.priority === 'emergency' ? 'emergency' : ''}`}>
        <div className="row">
          <span className="eyebrow">№ {o.number}</span>
          {o.priority === 'emergency' ? (
            <span className="badge emergency">
              <TriangleAlert aria-hidden size={16} /> {t('Аварийный')}
            </span>
          ) : null}
          <span className={`badge ${o.status}`}>{t(ORDER_STATUS_LABEL[o.status])}</span>
        </div>
        <p className="eq plate">{eq(o.equipment_id)?.name}</p>
        <p className="desc">{o.description}</p>
        <p className="site">{site(o.site_id)}</p>
        {ACTIVE.includes(o.status) && (
          <p className={`due ${due.late ? 'late' : ''}`}>
            <Timer aria-hidden size={18} /> {due.text}
          </p>
        )}
        {ACTIVE.includes(o.status) && (
          <span className="button open" aria-hidden>
            {t(NEXT_STEP[o.status] ?? 'Открыть')}
          </span>
        )}
      </Link>
    )
  }

  return (
    <>
      <h1>{t('Мои наряды')}</h1>
      {!me.telegram_chat_id && (
        <div className="notice tg-banner">
          <span>
            <Send aria-hidden size={20} /> {t('Подключите Telegram, чтобы новые наряды приходили со звуком.')}
          </span>
          <a className="button secondary" href="https://t.me/naryad_ai_kz_bot" target="_blank" rel="noreferrer">
            {t('Подключить')}
          </a>
        </div>
      )}
      <section className="my-orders" aria-label={t('Активные наряды')}>
        {active.length ? (
          active.map(card)
        ) : (
          <div className="empty">
            <CircleCheckBig className="big-ico" aria-hidden size={48} />
            <h2>{t('Активных нарядов нет')}</h2>
            <p>{t('Новый наряд появится здесь и придёт уведомлением.')}</p>
          </div>
        )}
      </section>
      <details className="panel">
        <summary>
          {t('Мой рейтинг:')} {rating ? `${Math.round(Number(rating.rating))} / 100` : t('пока нет закрытых нарядов')}
        </summary>
        {rating && (
          <ul>
            <li>{t('Качество работ')}: {rating.quality}%</li>
            <li>{t('Сдано в срок')}: {rating.on_time_rate}%</li>
            <li>{t('Возвраты и повторные поломки')}: {rating.rework_rate}%</li>
            <li>{t('Закрыто нарядов за 30 дней')}: {rating.closed_count}</li>
          </ul>
        )}
        <p>
          <small>{t('35% качество + 25% в срок + 20% без возвратов + 15% сложность − 5% за необоснованные отказы.')}</small>
        </p>
      </details>
      {done.length > 0 && (
        <>
          <button className="secondary big" onClick={() => setShowDone(!showDone)}>
            {showDone ? t('Скрыть выполненные') : `${t('Показать выполненные')} (${done.length})`}
          </button>
          {showDone && <section className="my-orders">{done.map(card)}</section>}
        </>
      )}
    </>
  )
}
