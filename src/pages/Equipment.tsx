import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Link } from 'react-router-dom'
import { ORDER_STATUS_LABEL } from '../../shared/types'
import { type AppData, dateLabel } from '../lib/data'
import { message } from '../lib/supabase'
export function EquipmentPage({
  data,
  canCreate,
}: {
  data: AppData
  canCreate: boolean
}) {
  const [selected, setSelected] = useState(0),
    [search, setSearch] = useState(''),
    [scanning, setScanning] = useState(false),
    [error, setError] = useState('')
  const scanner = useRef<Html5Qrcode | null>(null)
  useEffect(() => {
    if (!scanning) return
    let cancelled = false
    const q = new Html5Qrcode('qr-reader')
    scanner.current = q
    void q
      .start(
        { facingMode: 'environment' },
        { fps: 8, qrbox: 220 },
        (text) => {
          const e = data.equipment.find(
            (e) =>
              e.qr_code === text ||
              String(e.id) === text ||
              e.inv_number === text,
          )
          if (e) {
            setSelected(e.id)
            setScanning(false)
            setError('')
          } else
            setError(
              'QR не найден в справочнике. Выберите оборудование вручную.',
            )
        },
        () => {},
      )
      .then(() => {
        if (cancelled && q.isScanning) void q.stop()
      })
      .catch((e) => {
        setError(message(e))
        setScanning(false)
      })
    return () => {
      cancelled = true
      if (q.isScanning) void q.stop().catch(() => {})
    }
  }, [scanning, data.equipment])
  const equipment = data.equipment.find((e) => e.id === selected)
  return (
    <>
      <h1>Оборудование</h1>
      <div className="actions">
        <button onClick={() => setScanning(!scanning)}>
          {scanning ? 'Остановить камеру' : 'Сканировать QR'}
        </button>
      </div>
      {scanning && <div id="qr-reader" />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label>
        Поиск по названию или инвентарному номеру
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Например, конвейер"
        />
      </label>
      <div className="grid2">
        <section className="equipment-list">
          {data.equipment
            .filter((e) =>
              `${e.name} ${e.inv_number}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((e) => (
              <button
                className={selected === e.id ? '' : 'secondary'}
                key={e.id}
                onClick={() => setSelected(e.id)}
              >
                {e.name}
                <small>
                  {data.sites.find((s) => s.id === e.site_id)?.name} ·{' '}
                  {e.inv_number}
                </small>
              </button>
            ))}
        </section>
        <section className="panel">
          {equipment ? (
            <>
              <h2>{equipment.name}</h2>
              <p>
                {equipment.type} · критичность {equipment.criticality}/3
              </p>
              {canCreate && (
                <Link className="button" to={`/new?equipment=${equipment.id}`}>
                  Создать наряд
                </Link>
              )}
              <h3>История обслуживания</h3>
              {data.orders
                .filter((o) => o.equipment_id === equipment.id)
                .map((o) => (
                  <Link
                    className="history-link"
                    key={o.id}
                    to={`/orders/${o.id}`}
                  >
                    <b>
                      №{o.number} · {o.description}
                    </b>
                    <small>
                      {dateLabel(o.created_at)} · {ORDER_STATUS_LABEL[o.status]}
                    </small>
                  </Link>
                ))}
            </>
          ) : (
            <p>Отсканируйте QR или выберите оборудование.</p>
          )}
        </section>
      </div>
    </>
  )
}
