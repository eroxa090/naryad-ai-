import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { Employee, Notification } from '../../shared/types'
import { type AppData, dateLabel } from '../lib/data'
import { cached } from '../lib/offline'
import { message, supabase } from '../lib/supabase'
import { markRead } from '../lib/notifications'
import { t } from '../lib/i18n'

const KIND: Record<Notification['kind'], [string, string]> = {
  new_order: ['📩', 'Новый наряд'],
  reminder: ['⏰', 'Напоминание'],
  overdue: ['⏱', 'Просрочка'],
  escalation: ['🚨', 'Эскалация'],
  rework: ['🔁', 'Доработка'],
  review: ['✅', 'Проверка'],
  info: ['ℹ️', 'Сообщение'],
}

export function NotificationsPage({
  data,
  me,
}: {
  data: AppData
  me: Employee
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useQuery({
    queryKey: ['notifications', 'list', me.id],
    networkMode: 'always',
    queryFn: () =>
      cached('notifications', async () => {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('employee_id', me.id)
          .order('created_at', { ascending: false })
          .limit(200)
        if (error) throw error
        return data as Notification[]
      }),
  })
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  if (list.isPending) return <p aria-busy="true">{t('Загрузка…')}</p>
  if (!list.data)
    return (
      <p role="alert" className="error">
        {message(list.error)}{' '}
        <button onClick={() => void list.refetch()}>{t('Повторить')}</button>
      </p>
    )
  const unread = list.data.filter((n) => !n.read_at).length
  return (
    <>
      <h1>🔔 {t('Уведомления')}</h1>
      {unread > 0 && (
        <p className="unread-total">
          {t('непрочитанных')}: <b>{unread}</b>
        </p>
      )}
      {unread > 0 && (
        <button
          className="secondary big"
          disabled={busy}
          onClick={() => void run(() => markRead(me))}
        >
          ✔ {t('Отметить все прочитанными')}
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {list.data.length ? (
        <ul className="notifications">
          {list.data.map((n) => {
            const [icon, label] = KIND[n.kind] || KIND.info
            const order = data.orders.find((o) => o.id === n.order_id)
            return (
              <li key={n.id} className={n.read_at ? 'read' : 'unread'}>
                <div className="row">
                  <b>
                    <span aria-hidden>{icon}</span> {t(label)}
                    {!n.read_at && (
                      <span className="badge new">{t('Новое')}</span>
                    )}
                  </b>
                  <small>{dateLabel(n.created_at)}</small>
                </div>
                <p>{n.text}</p>
                {(n.order_id || !n.read_at) && (
                  <div className="actions">
                    {n.order_id && (
                      <Link
                        className="button"
                        to={`/orders/${n.order_id}`}
                        onClick={() => {
                          if (!n.read_at) void markRead(me, n.id).catch(() => {})
                        }}
                      >
                        {t('Открыть наряд')}
                        {order ? ` №${order.number}` : ''}
                      </Link>
                    )}
                    {!n.read_at && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void run(() => markRead(me, n.id))}
                      >
                        ✔ {t('Прочитано')}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty">
          <span className="big-ico" aria-hidden>
            🔕
          </span>
          <p>{t('Уведомлений пока нет.')}</p>
        </div>
      )}
    </>
  )
}
