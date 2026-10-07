import { Bell, ChartColumn, ClipboardList, Download, Factory, Plus, Send, Settings, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitch } from './components/LanguageSwitch'
import { t } from './lib/i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from 'react-router-dom'
import type { Employee } from '../shared/types'
import { configured, message, queryClient, supabase } from './lib/supabase'
import { aiMock } from './lib/api'
import {
  flushActions,
  offline,
  cached,
  type PendingAction,
} from './lib/offline'
import { useData } from './lib/data'
import { useUnreadCount } from './lib/notifications'
import { Board } from './pages/Board'
import { CreateOrder } from './pages/CreateOrder'
import { OrderDetail } from './pages/OrderDetail'
const EquipmentPage = lazy(() =>
  import('./pages/Equipment').then((m) => ({ default: m.EquipmentPage })),
)
const PrintQR = lazy(() =>
  import('./pages/PrintQR').then((m) => ({ default: m.PrintQR })),
)
const Reports = lazy(() =>
  import('./pages/Reports').then((m) => ({ default: m.Reports })),
)
const AdminPage = lazy(() =>
  import('./pages/Admin').then((m) => ({ default: m.AdminPage })),
)
const NotificationsPage = lazy(() =>
  import('./pages/Notifications').then((m) => ({
    default: m.NotificationsPage,
  })),
)
function Login() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <main className="login">
      <section className="panel">
        <LanguageSwitch />
        <div className="brand">
          {t('Наряд')}
          <span>AI</span>
        </div>
        <p className="eyebrow">{t('СМЕНА ПОД КОНТРОЛЕМ')}</p>
        <h1>{t('Начнём работу')}</h1>
        <p>{t('Войдите по логину и шестизначному ПИН.')}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            const f = new FormData(e.currentTarget)
            try {
              const { error } = await supabase.auth.signInWithPassword({
                email: `${String(f.get('login')).trim().toLowerCase()}@naryad.local`,
                password: String(f.get('pin')),
              })
              if (error) throw error
            } catch (e) {
              setError(message(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            {t('Логин')}
            <input
              name="login"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="master1"
              pattern="[A-Za-z0-9_.-]+"
            />
          </label>
          <label>
            {t('ПИН')}
            <input
              name="pin"
              required
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy || !configured}>
            {busy ? t('Входим…') : t('Войти')}
          </button>
          {!configured && (
            <p className="error">
              {t('Настройте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.')}
            </p>
          )}
        </form>
      </section>
    </main>
  )
}
function Workspace({ session }: { session: Session }) {
  const employee = useQuery({
    queryKey: ['employee', session.user.id],
    networkMode: 'always',
    queryFn: () =>
      cached('employee', async () => {
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .single()
        if (error) throw error
        return data as Employee
      }),
  })
  const data = useData()
  const [banner, setBanner] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [queue, setQueue] = useState<PendingAction[]>([])
  const [install, setInstall] = useState<
    (Event & { prompt: () => Promise<void> }) | null
  >(null)
  useEffect(() => {
    const fn = (e: Event) => {
      e.preventDefault()
      setInstall(e as Event & { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', fn)
    return () => window.removeEventListener('beforeinstallprompt', fn)
  }, [])
  useEffect(() => {
    const refresh = () => {
      void offline.actions
        .where('userId')
        .equals(session.user.id)
        .toArray()
        .then(setQueue)
    }
    const net = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine) void flushActions()
    }
    refresh()
    void flushActions()
    window.addEventListener('online', net)
    window.addEventListener('offline', net)
    window.addEventListener('queue-change', refresh)
    return () => {
      window.removeEventListener('online', net)
      window.removeEventListener('offline', net)
      window.removeEventListener('queue-change', refresh)
    }
  }, [session.user.id])
  useEffect(() => {
    if (!employee.data) return
    const id = employee.data.id
    const channel = supabase
      .channel(`shift-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          void queryClient.invalidateQueries()
          if (
            payload.eventType === 'INSERT' &&
            payload.new.assignee_id === id
          ) {
            setBanner(`${t('Новый наряд')} №${payload.new.number}`)
            try {
              const ctx = new AudioContext()
              const osc = ctx.createOscillator()
              osc.connect(ctx.destination)
              osc.frequency.value = 660
              osc.start()
              osc.stop(ctx.currentTime + 0.25)
              osc.onended = () => void ctx.close()
            } catch {
              /* banner remains available */
            }
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_events' },
        () => void queryClient.invalidateQueries(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_reviews' },
        () => void queryClient.invalidateQueries(),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `employee_id=eq.${id}`,
        },
        (p) => {
          setBanner(String(p.new.text))
          void queryClient.invalidateQueries()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [employee.data])
  const signOut = async () => {
    await supabase.auth.signOut()
    queryClient.clear()
  }
  if (employee.error || data.error)
    return (
      <main>
        <p role="alert" className="error">
          {message(employee.error || data.error)}
        </p>
        <button
          onClick={() => {
            void employee.refetch()
            void data.refetch()
          }}
        >
          {t('Повторить')}
        </button>
        <button onClick={signOut}>{t('Выйти')}</button>
      </main>
    )
  if (!employee.data || !data.data)
    return <main aria-busy="true">{t('Загружаем смену…')}</main>
  const me = employee.data,
    master = ['master', 'admin'].includes(me.role),
    reports = me.role !== 'worker',
    roleLabel = master ? t('Мастер') : me.role === 'worker' ? t('Исполнитель') : t('Руководитель')
  return (
    <>
      <header>
        <NavLink className="brand" to="/">
          {t('Наряд')}
          <span>AI</span>
        </NavLink>
        <LanguageSwitch />
        <details className="telegram-connect">
          <summary>{t('Подключить Telegram')}</summary>
          <TelegramHelp login={me.login} />
        </details>
        <span className="user">
          {me.full_name}
          <small>{roleLabel}</small>
        </span>
        <button className="secondary" onClick={signOut}>
          {t('Выйти')}
        </button>
        <NotificationsLink me={me} header />
        <details className="profile">
          <summary aria-label={t('Профиль')}>
            <UserRound aria-hidden size={22} /> {t('Профиль')}
          </summary>
          <div>
            <p className="who">
              <b>{me.full_name}</b>
              <br />
              <small>{roleLabel}</small>
            </p>
            <LanguageSwitch />
            {me.role === 'admin' && (
              <NavLink className="button secondary" to="/admin">
                <Settings aria-hidden size={20} /> {t('Справочники')}
              </NavLink>
            )}
            <TelegramHelp login={me.login} />
            <button className="secondary" onClick={signOut}>
              {t('Выйти')}
            </button>
          </div>
        </details>
      </header>
      <nav>
        <NavLink to="/orders">
          <ClipboardList className="ico" aria-hidden />
          {me.role === 'worker' ? t('Мои наряды') : t('Смена')}
        </NavLink>
        {master && (
          <NavLink to="/new">
            <Plus className="ico" aria-hidden />
            {t('Новый наряд')}
          </NavLink>
        )}
        <NavLink to="/equipment">
          <Factory className="ico" aria-hidden />
          {t('Оборудование')}
        </NavLink>
        {reports && (
          <NavLink to="/reports">
            <ChartColumn className="ico" aria-hidden />
            {t('Отчёты')}
          </NavLink>
        )}
        {me.role === 'admin' && (
          <NavLink to="/admin" className="nav-admin">
            <Settings className="ico" aria-hidden />
            {t('Справочники')}
          </NavLink>
        )}
        <NotificationsLink me={me} />
        {install && (
          <button
            onClick={async () => {
              await install.prompt()
              setInstall(null)
            }}
          >
            <Download className="ico" aria-hidden />
            {t('Установить')}
          </button>
        )}
      </nav>
      <main>
        {aiMock && (
          <div className="notice">
            {t(
              'ИИ: демонстрационные ответы. Наряды и статусы сохраняются в рабочей базе.',
            )}
          </div>
        )}
        {!online && (
          <div className="notice">
            {t('Нет сети. Действия со статусами будут сохранены в очередь.')}
          </div>
        )}
        {queue.length > 0 && (
          <section className="notice">
            {t('Ожидают отправки:')}
            {queue.length}
            {queue.map((q) => (
              <div key={q.id}>
                {t('Наряд')}
                {q.args.p_order_id}: {q.args.p_action}
                {q.error && (
                  <>
                    <p className="error">{q.error}</p>
                    <button
                      onClick={async () => {
                        await offline.actions.update(q.id!, {
                          error: undefined,
                        })
                        await flushActions()
                      }}
                    >
                      {t('Повторить')}
                    </button>
                    <button
                      onClick={async () => {
                        await offline.actions.delete(q.id!)
                        window.dispatchEvent(new Event('queue-change'))
                        await flushActions()
                      }}
                    >
                      {t('Удалить действие')}
                    </button>
                  </>
                )}
              </div>
            ))}
          </section>
        )}
        {banner && (
          <div className="notice" role="status">
            {banner}
            <button className="secondary" onClick={() => setBanner('')}>
              {t('Понятно')}
            </button>
          </div>
        )}
        <Suspense fallback={<p>{t('Загрузка экрана…')}</p>}>
          <Routes>
            <Route
              path="/equipment/print"
              element={<PrintQR data={data.data} />}
            />
            <Route
              path="/orders"
              element={<Board data={data.data} me={me} />}
            />
            <Route
              path="/orders/:id"
              element={<OrderDetail data={data.data} me={me} />}
            />
            <Route
              path="/new"
              element={
                master ? (
                  <CreateOrder data={data.data} me={me} />
                ) : (
                  <Navigate to="/orders" replace />
                )
              }
            />
            <Route
              path="/admin"
              element={
                me.role === 'admin' ? (
                  <AdminPage data={data.data} />
                ) : (
                  <Navigate to="/orders" replace />
                )
              }
            />
            <Route
              path="/notifications"
              element={<NotificationsPage data={data.data} me={me} />}
            />
            <Route
              path="/equipment"
              element={<EquipmentPage data={data.data} canCreate={master} />}
            />
            <Route
              path="/reports"
              element={
                reports ? (
                  <Reports data={data.data} />
                ) : (
                  <Navigate to="/orders" replace />
                )
              }
            />
            <Route
              path="*"
              element={
                <Navigate
                  to={me.role === 'manager' ? '/reports' : '/orders'}
                  replace
                />
              }
            />
          </Routes>
        </Suspense>
      </main>
      <footer>{t('Решение всегда принимает человек')}</footer>
    </>
  )
}
function AuthApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  return ready ? (
    session ? (
      <Workspace key={session.user.id} session={session} />
    ) : (
      <Login />
    )
  ) : (
    <main>{t('Загрузка…')}</main>
  )
}
export default function App() {
  useTranslation()
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthApp />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

// В нижнем меню на телефоне места нет — там колокольчик показывается в шапке (header).
function NotificationsLink({ me, header }: { me: Employee; header?: boolean }) {
  const unread = useUnreadCount(me).data ?? 0
  return (
    <NavLink
      to="/notifications"
      className={header ? 'header-bell' : 'nav-bell'}
      aria-label={
        unread
          ? `${t('Уведомления')}: ${t('непрочитанных')} ${unread}`
          : t('Уведомления')
      }
    >
      <span className="bell" aria-hidden>
        <Bell className="ico" />
        {unread > 0 && (
          <b className="count">{unread > 99 ? '99+' : unread}</b>
        )}
      </span>
      <span className="nav-label">{t('Уведомления')}</span>
    </NavLink>
  )
}

function TelegramHelp({ login }: { login: string }) {
  return (
    <div className="telegram-help">
      <a className="button" href="https://t.me/naryad_ai_kz_bot" target="_blank" rel="noreferrer">
        <Send aria-hidden size={20} /> {t('Открыть бота в Telegram')}
      </a>
      <p>
        {t('Отправьте боту команду:')} <code>/start {login} ПИН</code>
      </p>
    </div>
  )
}
