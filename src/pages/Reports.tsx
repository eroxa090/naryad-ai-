import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import type { AiInsight, ShiftReportRes } from '../../shared/types'
import { ORDER_STATUS_LABEL } from '../../shared/types'
import { type AppData, dateLabel, loadOrders } from '../lib/data'
import { cached } from '../lib/offline'
import { api } from '../lib/api'
import { rows, message } from '../lib/supabase'
import { exportExcel, exportPdf } from '../lib/export'
import { MaterialsReport } from '../components/MaterialsReport'
const hours = (a: string, b: string) =>
  Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3600000)
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
export function Reports({ data }: { data: AppData }) {
  const history = useQuery({ queryKey: ['orders-history'], networkMode: 'always', queryFn: () => cached('orders-history', () => loadOrders(true)) })
  if (history.isPending) return <p aria-busy="true">Загружаем историю нарядов…</p>
  if (history.error) return <p role="alert">{message(history.error)} <button onClick={() => void history.refetch()}>Повторить</button></p>
  return <ReportContent data={{...data, orders: history.data}} />
}
function ReportContent({ data }: { data: AppData }) {
  const [from, setFrom] = useState(() => {
      const now = new Date(),
        start = new Date(now)
      if (now.getHours() < 8) start.setDate(start.getDate() - 1)
      start.setHours(
        now.getHours() >= 8 && now.getHours() < 20 ? 8 : 20,
        0,
        0,
        0,
      )
      return localInput(start)
    }),
    [to, setTo] = useState(() => localInput(new Date())),
    [site, setSite] = useState(''),
    [report, setReport] = useState<ShiftReportRes | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [selected, setSelected] = useState<AiInsight | null>(null)
  const [now] = useState(() => new Date().toISOString())
  const insights = useQuery({
    queryKey: ['insights'],
    queryFn: () => rows<AiInsight>('ai_insights'),
  })
  const filtered = data.orders.filter(
    (o) =>
      (!site || o.site_id === Number(site)) &&
      new Date(o.created_at) >= new Date(from) &&
      new Date(o.created_at) <= new Date(to),
  )
  const reactions = filtered
      .filter((o) => o.accepted_at)
      .map((o) => hours(o.created_at, o.accepted_at!)),
    durations = filtered
      .filter((o) => o.started_at && o.submitted_at)
      .map((o) => hours(o.started_at!, o.submitted_at!))
  const average = (values: number[]) =>
    values.length
      ? `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} ч`
      : 'Нет данных'
  const ratings = data.ratings.map((r) => ({
    ...r,
    name:
      data.employees.find((e) => e.id === r.employee_id)?.full_name ||
      String(r.employee_id),
    rating: Number(r.rating),
  }))
  const brigades = Array.from(
    new Set(
      data.employees
        .filter((e) => e.role === 'worker')
        .map((e) => e.brigade || 'Без бригады'),
    ),
  ).map((name) => {
    const ids = data.employees
      .filter((e) => (e.brigade || 'Без бригады') === name)
      .map((e) => e.id)
    const group = ratings.filter((r) => ids.includes(r.employee_id))
    return {
      name,
      rating: group.length
        ? Math.round(group.reduce((s, r) => s + r.rating, 0) / group.length)
        : 0,
    }
  })
  const top = data.equipment
    .map((e) => ({
      ...e,
      count: filtered.filter(
        (o) => o.equipment_id === e.id && o.type === 'emergency',
      ).length,
    }))
    .filter((e) => e.count)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  async function run(fn: () => Promise<unknown>) {
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
  const exportRows = filtered.map((o) => ({
    Номер: o.number,
    Задача: o.description,
    Статус: ORDER_STATUS_LABEL[o.status],
    Оборудование: data.equipment.find((e) => e.id === o.equipment_id)?.name,
    Исполнитель: data.employees.find((e) => e.id === o.assignee_id)?.full_name,
    Срок: dateLabel(o.deadline),
    Просрочен: o.is_overdue ? 'Да' : 'Нет',
  }))
  return (
    <>
      <p className="eyebrow">ПРОИЗВОДСТВО В ЦИФРАХ</p>
      <h1>Отчёты и аналитика</h1>
      <section className="panel filters">
        <label>
          С
          <input
            type="datetime-local"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value)
              setReport(null)
            }}
          />
        </label>
        <label>
          По
          <input
            type="datetime-local"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value)
              setReport(null)
            }}
          />
        </label>
        <label>
          Участок
          <select
            aria-label="Участок"
            value={site}
            onChange={(e) => {
              setSite(e.target.value)
              setReport(null)
            }}
          >
            <option value="">Все участки</option>
            {data.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !from || !to || from > to}
          onClick={() =>
            void run(async () =>
              setReport(
                await api.shiftReport({
                  from: new Date(from).toISOString(),
                  to: new Date(to).toISOString(),
                  ...(site ? { site_id: Number(site) } : {}),
                }),
              ),
            )
          }
        >
          Отчёт за смену
        </button>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        Показатели по нарядам, созданным в выбранный период. Время реакции — до
        принятия, выполнения — от начала до отправки отчёта.
      </p>
      <div className="stats">
        {[
          [
            'В работе',
            filtered.filter((o) => o.status === 'in_progress').length,
          ],
          [
            'Просрочено',
            filtered.filter(
              (o) =>
                o.is_overdue && !['closed', 'cancelled'].includes(o.status),
            ).length,
          ],
          ['Средняя реакция', average(reactions)],
          ['Среднее выполнение', average(durations)],
        ].map(([label, value]) => (
          <div className="panel" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>Оценка простоя</h2>
        <strong>
          {filtered
            .filter((o) => o.type === 'emergency' && o.started_at)
            .reduce(
              (sum, o) => sum + hours(o.started_at!, o.submitted_at || now),
              0,
            )
            .toFixed(1)}{' '}
          ч
        </strong>
        <p>
          Сумма времени аварийных работ от начала до исполнения (для открытых —
          до текущего момента). Это оценка по нарядам: параллельные работы могут
          пересекаться.
        </p>
      </section>
      {report && (
        <section className="panel">
          <h2>Сводка смены</h2>
          <p>{report.summary}</p>
          <p>
            Выдано: {report.stats.issued} · Закрыто: {report.stats.closed} ·
            Просрочено: {report.stats.overdue} · Отклонено:{' '}
            {report.stats.rejected}
          </p>
        </section>
      )}
      <div className="actions">
        <button
          disabled={busy}
          className="secondary"
          onClick={() => void run(() => exportExcel(exportRows))}
        >
          Экспорт Excel
        </button>
        <button
          disabled={busy}
          className="secondary"
          onClick={() =>
            void run(() =>
              exportPdf([
                `НарядAI · ${from} — ${to}`,
                report?.summary || 'Реестр нарядов',
                ...exportRows.map(
                  (r) =>
                    `№${r.Номер}: ${r.Задача}. ${r.Статус}. ${r.Оборудование}. Срок: ${r.Срок}`,
                ),
              ]),
            )
          }
        >
          Экспорт PDF
        </button>
      </div>
      <div className="grid2">
        <section className="panel">
          <h2>Рейтинг исполнителей · 30 дней</h2>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart
                data={ratings}
                layout="vertical"
                margin={{ left: 10, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={115}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip />
                <Bar dataKey="rating" name="Рейтинг" fill="#20846b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p>
            35% качество + 25% в срок + 20% без возвратов + 15% сложность − 5%
            штраф.
          </p>
        </section>
        <section className="panel">
          <h2>Бригады · средний рейтинг</h2>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={brigades}>
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="rating" name="Рейтинг" fill="#3e7bc3" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>Топ-5 проблемного оборудования</h2>
        {top.length ? (
          top.map((e) => (
            <p key={e.id}>
              <b>{e.name}</b> · аварийных нарядов: {e.count}
            </p>
          ))
        ) : (
          <p>Нет аварийных нарядов за период.</p>
        )}
      </section>
      <MaterialsReport data={data} orders={filtered} />
      <section className="panel">
        <h2>Выводы ИИ по истории нарядов</h2>
        {insights.data?.some((i) => i.kind !== 'equipment_risk') ? (
          <div className="insights">
            {insights.data
              .filter((i) => i.kind !== 'equipment_risk' && i.kind !== 'weekly_summary')
              .map((i) => (
                <article key={i.id} className="notice">
                  <h3>{i.title}</h3>
                  <p>{i.text}</p>
                  {i.recommendation && <p><b>Рекомендация:</b> {i.recommendation}</p>}
                </article>
              ))}
          </div>
        ) : (
          <p>Аналитика ещё не рассчитана.</p>
        )}
        <button
          disabled={busy}
          className="secondary"
          onClick={() =>
            void run(async () => {
              await api.runInsights()
              await insights.refetch()
            })
          }
        >
          Пересчитать аналитику
        </button>
      </section>
      <section className="panel">
        <h2>Карта здоровья оборудования</h2>
        <p>
          Зелёный: риск &lt; 35%, жёлтый: 35–69%, красный: ≥70%. Серый: нет
          оценки аналитики.
        </p>
        {insights.error && <p className="error">{message(insights.error)}</p>}
        {data.sites.map((s) => (
          <section key={s.id}>
            <h3>{s.name}</h3>
            <div className="risk-grid">
              {data.equipment
                .filter((e) => e.site_id === s.id)
                .map((e) => {
                  const insight = insights.data
                    ?.filter(
                      (i) =>
                        i.kind === 'equipment_risk' &&
                        Number(i.data.equipment_id) === e.id,
                    )
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
                  const risk =
                    typeof insight?.data.risk === 'number'
                      ? insight.data.risk
                      : null
                  return (
                    <button
                      className={
                        risk === null
                          ? 'risk-unknown'
                          : risk >= 0.7
                            ? 'risk-high'
                            : risk >= 0.35
                              ? 'risk-medium'
                              : 'risk-low'
                      }
                      key={e.id}
                      onClick={() => setSelected(insight || null)}
                    >
                      {e.name}
                      <small>
                        {risk === null
                          ? 'Нет оценки'
                          : `Риск ${Math.round(risk * 100)}%`}
                      </small>
                    </button>
                  )
                })}
            </div>
          </section>
        ))}
        {selected && (
          <div className="notice">
            <h3>{selected.title}</h3>
            <p>{selected.text}</p>
            <p>{selected.recommendation}</p>
            <small>Обновлено: {dateLabel(selected.created_at)}</small>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>ИИ-ассистент</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              setAnswer((await api.assistant({ question })).answer)
              setQuestion('')
            })
          }}
        >
          <label>
            Вопрос
            <textarea
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Кто свободен? Что просрочено?"
            />
          </label>
          <button disabled={busy || !question.trim()}>Спросить</button>
        </form>
        {answer && (
          <p className="chat-answer" role="status">
            {answer}
          </p>
        )}
      </section>
    </>
  )
}
