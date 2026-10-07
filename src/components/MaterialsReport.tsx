import { useState } from 'react'
import { FileSpreadsheet, TriangleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Order, OrderMaterial } from '../../shared/types'
import type { AppData } from '../lib/data'
import { cached } from '../lib/offline'
import { message, rows } from '../lib/supabase'
import { exportExcel } from '../lib/export'
import { t } from '../lib/i18n'

type Group = 'material' | 'site' | 'equipment' | 'worker'
// [группировка, кнопка, заголовок первого столбца]
const GROUPS: [Group, string, string][] = [
  ['material', 'По материалу', 'Материал'],
  ['site', 'По участку', 'Участок'],
  ['equipment', 'По оборудованию', 'Оборудование'],
  ['worker', 'По исполнителю', 'Исполнитель'],
]
// Порог перерасхода: списано в 1,5 раза больше типичного количества.
const OVER = 1.5

interface Row {
  key: string
  name: string
  orders: Set<number>
  lines: number
  qty: number
  norm: number
  unit: string
  ratios: number[]
  over: number
}

export function MaterialsReport({
  data,
  orders,
}: {
  data: AppData
  orders: Order[]
}) {
  const [group, setGroup] = useState<Group>('material')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const usage = useQuery({
    queryKey: ['order-materials'],
    networkMode: 'always',
    queryFn: () =>
      cached('order-materials', () => rows<OrderMaterial>('order_materials')),
  })
  if (usage.isPending)
    return (
      <section className="panel" aria-busy="true">
        <h2>{t('Списанные материалы')}</h2>
        <p>{t('Загружаем списания…')}</p>
      </section>
    )
  if (usage.error && !usage.data)
    return (
      <section className="panel">
        <h2>{t('Списанные материалы')}</h2>
        <p role="alert" className="error">
          {message(usage.error)}
        </p>
        <button onClick={() => void usage.refetch()}>{t('Повторить')}</button>
      </section>
    )

  if (!usage.data) return null
  const byOrder = new Map(orders.map((o) => [o.id, o]))
  const table = new Map<string, Row>()
  for (const line of usage.data) {
    const order = byOrder.get(line.order_id)
    const material = data.materials.find((m) => m.id === line.material_id)
    if (!order || !material) continue
    const [key, name] =
      group === 'material'
        ? [`m${material.id}`, material.name]
        : group === 'site'
          ? [
              `s${order.site_id}`,
              data.sites.find((s) => s.id === order.site_id)?.name ||
                `#${order.site_id}`,
            ]
          : group === 'equipment'
            ? [
                `e${order.equipment_id}`,
                data.equipment.find((e) => e.id === order.equipment_id)
                  ?.name || `#${order.equipment_id}`,
              ]
            : [
                `w${order.assignee_id ?? 0}`,
                data.employees.find((e) => e.id === order.assignee_id)
                  ?.full_name || t('Не назначен'),
              ]
    const row =
      table.get(key) ||
      ({
        key,
        name,
        orders: new Set(),
        lines: 0,
        qty: 0,
        norm: 0,
        unit: material.unit,
        ratios: [],
        over: 0,
      } as Row)
    const qty = Number(line.qty),
      norm = Number(material.typical_qty)
    row.orders.add(order.id)
    row.lines++
    row.qty += qty
    row.norm += norm
    if (norm > 0) {
      const ratio = qty / norm
      row.ratios.push(ratio)
      if (ratio >= OVER) row.over++
    }
    table.set(key, row)
  }
  // Кратность нормы — среднее по позициям «списано / типичное количество»,
  // чтобы не смешивать штуки, литры и килограммы в одной сумме.
  const ratioOf = (r: Row) =>
    r.ratios.length
      ? r.ratios.reduce((a, b) => a + b, 0) / r.ratios.length
      : null
  const list = Array.from(table.values()).sort(
    (a, b) => (ratioOf(b) ?? 0) - (ratioOf(a) ?? 0),
  )
  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  const isMaterial = group === 'material'
  const groupLabel = t(GROUPS.find(([g]) => g === group)![2])

  const exportRows = list.map((r) => {
    const ratio = ratioOf(r)
    return {
      [groupLabel]: r.name,
      [t('Нарядов')]: r.orders.size,
      [t('Позиций')]: r.lines,
      ...(isMaterial
        ? {
            [t('Списано')]: Number(r.qty.toFixed(2)),
            [t('Норма')]: Number(r.norm.toFixed(2)),
            [t('Ед.')]: r.unit,
          }
        : {}),
      [t('Кратность нормы')]: ratio === null ? '' : Number(ratio.toFixed(2)),
      [t('Позиций с перерасходом')]: r.over,
    }
  })

  return (
    <section className="panel materials-report">
      <h2>{t('Списанные материалы')}</h2>
      <p className="muted">
        {t(
          'По нарядам выбранного периода. Кратность нормы — во сколько раз списано больше типичного количества. Строки с кратностью ≥ 1,5 подсвечены.',
        )}
      </p>
      <div className="segmented" role="group" aria-label={t('Группировка')}>
        {GROUPS.map(([g, label]) => (
          <button
            key={g}
            type="button"
            className="secondary"
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>{groupLabel}</th>
                <th>{t('Нарядов')}</th>
                {isMaterial ? (
                  <>
                    <th>{t('Списано')}</th>
                    <th>{t('Норма')}</th>
                  </>
                ) : (
                  <th>{t('Позиций')}</th>
                )}
                <th>{t('Кратность нормы')}</th>
                <th>{t('Перерасход')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const ratio = ratioOf(r)
                const over = ratio !== null && ratio >= OVER
                return (
                  <tr key={r.key} className={over ? 'over' : undefined}>
                    <td>
                      {over && (
                        <TriangleAlert
                          className="warn-ico"
                          aria-hidden
                          size={20}
                        />
                      )}
                      <b>{r.name}</b>
                    </td>
                    <td data-label={t('Нарядов')}>{r.orders.size}</td>
                    {isMaterial ? (
                      <>
                        <td data-label={t('Списано')}>
                          {fmt(r.qty)} {r.unit}
                        </td>
                        <td data-label={t('Норма')}>
                          {fmt(r.norm)} {r.unit}
                        </td>
                      </>
                    ) : (
                      <td data-label={t('Позиций')}>{r.lines}</td>
                    )}
                    <td className="num" data-label={t('Кратность нормы')}>
                      {ratio === null ? '—' : `×${ratio.toFixed(2)}`}
                    </td>
                    <td data-label={t('Перерасход')}>
                      {r.over
                        ? `${r.over} ${t('из')} ${r.lines}`
                        : t('нет')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('За период материалы не списывались.')}</p>
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
              exportRows,
              t('Материалы'),
              'НарядAI-материалы.xlsx',
            )
          } catch (e) {
            setError(message(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <FileSpreadsheet aria-hidden size={20} /> Excel
      </button>
    </section>
  )
}
