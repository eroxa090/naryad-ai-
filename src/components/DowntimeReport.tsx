import { useState } from 'react'
import type { Order } from '../../shared/types'
import type { AppData } from '../lib/data'
import { message } from '../lib/supabase'
import { exportExcel } from '../lib/export'
import { t } from '../lib/i18n'

const hours = (a: string, b: string) =>
  Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3600000)

interface Row {
  id: number
  name: string
  unplannedHours: number
  unplanned: number
  planned: number
  causes: Map<string, number>
}

// Простой считаем по закрытым внеплановым нарядам: от создания до закрытия мастером.
export function DowntimeReport({
  data,
  orders,
}: {
  data: AppData
  orders: Order[]
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const table = new Map<number, Row>()
  for (const o of orders) {
    if (o.status !== 'closed' || !o.closed_at) continue
    const row = table.get(o.equipment_id) || {
      id: o.equipment_id,
      name:
        data.equipment.find((e) => e.id === o.equipment_id)?.name ||
        `#${o.equipment_id}`,
      unplannedHours: 0,
      unplanned: 0,
      planned: 0,
      causes: new Map<string, number>(),
    }
    if (o.type === 'planned') row.planned++
    else {
      const h = hours(o.created_at, o.closed_at)
      const code = o.fault_code || ''
      row.unplanned++
      row.unplannedHours += h
      row.causes.set(code, (row.causes.get(code) || 0) + h)
    }
    table.set(o.equipment_id, row)
  }
  const list = Array.from(table.values()).sort(
    (a, b) => b.unplannedHours - a.unplannedHours,
  )
  const causeName = (code: string) =>
    code
      ? `${code} · ${data.faults.find((f) => f.code === code)?.name || ''}`
      : t('Без шифра')
  const causesOf = (r: Row) =>
    Array.from(r.causes.entries()).sort((a, b) => b[1] - a[1])
  const share = (r: Row) =>
    Math.round((r.unplanned / Math.max(1, r.unplanned + r.planned)) * 100)

  return (
    <section className="panel downtime-report">
      <h2>{t('Простои по причинам')}</h2>
      <p className="muted">
        {t(
          'Закрытые наряды выбранного периода. Часы внеплановых работ — от создания наряда до закрытия мастером; доля — по числу нарядов.',
        )}
      </p>
      {list.length ? (
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>{t('Оборудование')}</th>
                <th>{t('Внеплановые, ч')}</th>
                <th>{t('По причинам')}</th>
                <th>{t('Внеплановые / плановые')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td className="num" data-label={t('Внеплановые, ч')}>
                    {r.unplannedHours.toFixed(1)}
                  </td>
                  <td data-label={t('По причинам')}>
                    {r.causes.size ? (
                      <ul className="causes">
                        {causesOf(r).map(([code, h]) => (
                          <li key={code}>
                            {causeName(code)} — <b>{h.toFixed(1)} {t('ч')}</b>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label={t('Внеплановые / плановые')}>
                    <div className="share">
                      <div
                        className="split"
                        role="img"
                        aria-label={`${t('Внеплановые')} ${share(r)}%`}
                      >
                        <span style={{ width: `${share(r)}%` }} />
                      </div>
                      <small>
                        {t('Внеплановые')} {r.unplanned} ({share(r)}%) ·{' '}
                        {t('Плановые')} {r.planned} ({100 - share(r)}%)
                      </small>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('За период нет закрытых нарядов.')}</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="secondary"
        disabled={busy || !list.length}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await exportExcel(
              list.flatMap((r) =>
                (r.causes.size ? causesOf(r) : [['', 0] as const]).map(
                  ([code, h]) => ({
                    [t('Оборудование')]: r.name,
                    [t('Причина')]: r.causes.size ? causeName(code) : '—',
                    [t('Часы')]: Number(h.toFixed(1)),
                    [t('Внеплановые, ч')]: Number(r.unplannedHours.toFixed(1)),
                    [t('Внеплановые')]: r.unplanned,
                    [t('Плановые')]: r.planned,
                    [t('Доля внеплановых, %')]: share(r),
                  }),
                ),
              ),
              t('Простои'),
              'НарядAI-простои.xlsx',
            )
          } catch (e) {
            setError(message(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        📥 Excel
      </button>
    </section>
  )
}
