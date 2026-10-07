import { useState } from 'react'
import type { AppData } from '../lib/data'
import { message, queryClient, supabase } from '../lib/supabase'
import { t } from '../lib/i18n'

// Справочники правит только admin (RLS admin_write). Наряды здесь не трогаем.
type Value = string | boolean
interface Field {
  key: string
  label: string
  kind?: 'text' | 'number' | 'select' | 'checkbox'
  options?: [string, string][]
  required?: boolean
  optional?: boolean // пустое значение сохраняем как null
  step?: string
  min?: number
  max?: number
  createOnly?: boolean // первичный ключ, который задаёт человек
  numeric?: boolean // select с числовыми значениями (id, критичность)
}
interface Entity {
  table: string
  title: string
  pk: string
  fields: Field[]
  rows: Record<string, unknown>[]
  note?: string
}

const ROLE_LABEL: [string, string][] = [
  ['worker', 'Исполнитель'],
  ['master', 'Мастер'],
  ['manager', 'Руководитель'],
  ['admin', 'Администратор'],
]

function entities(data: AppData): Entity[] {
  return [
    {
      table: 'equipment',
      title: 'Оборудование',
      pk: 'id',
      rows: data.equipment as unknown as Record<string, unknown>[],
      note: 'QR-код создаётся автоматически при добавлении.',
      fields: [
        { key: 'name', label: 'Название', required: true },
        { key: 'inv_number', label: 'Инв. номер', required: true },
        {
          key: 'site_id',
          label: 'Участок',
          kind: 'select',
          numeric: true,
          required: true,
          options: data.sites.map((s) => [String(s.id), s.name]),
        },
        { key: 'type', label: 'Тип', required: true },
        {
          key: 'criticality',
          label: 'Критичность',
          kind: 'select',
          numeric: true,
          required: true,
          options: [
            ['1', '1 · низкая'],
            ['2', '2 · средняя'],
            ['3', '3 · высокая'],
          ],
        },
      ],
    },
    {
      table: 'employees',
      title: 'Сотрудники',
      pk: 'id',
      rows: data.employees as unknown as Record<string, unknown>[],
      note: 'Вход по ПИН (учётная запись Supabase Auth) создаёт бэкенд отдельно; здесь — карточка сотрудника.',
      fields: [
        { key: 'full_name', label: 'ФИО', required: true },
        { key: 'login', label: 'Логин', required: true },
        { key: 'specialty', label: 'Специальность', required: true },
        {
          key: 'grade',
          label: 'Разряд',
          kind: 'number',
          required: true,
          min: 1,
          max: 8,
        },
        { key: 'brigade', label: 'Бригада', optional: true },
        {
          key: 'role',
          label: 'Роль',
          kind: 'select',
          required: true,
          options: ROLE_LABEL,
        },
        {
          key: 'shift',
          label: 'Смена',
          kind: 'select',
          required: true,
          options: [
            ['day', 'Дневная'],
            ['night', 'Ночная'],
          ],
        },
        { key: 'on_shift', label: 'На смене', kind: 'checkbox' },
      ],
    },
    {
      table: 'materials',
      title: 'Материалы',
      pk: 'id',
      rows: data.materials as unknown as Record<string, unknown>[],
      fields: [
        { key: 'name', label: 'Название', required: true },
        { key: 'unit', label: 'Ед. изм.', required: true },
        {
          key: 'typical_qty',
          label: 'Типичное количество',
          kind: 'number',
          required: true,
          step: '0.01',
          min: 0,
        },
      ],
    },
    {
      table: 'fault_codes',
      title: 'Шифры неисправностей',
      pk: 'code',
      rows: data.faults as unknown as Record<string, unknown>[],
      fields: [
        { key: 'code', label: 'Шифр', required: true, createOnly: true },
        {
          key: 'category',
          label: 'Категория',
          kind: 'select',
          required: true,
          options: [
            ['М', 'М · механика'],
            ['Э', 'Э · электрика'],
            ['Г', 'Г · гидравлика'],
            ['П', 'П · пневматика'],
            ['С', 'С · прочее'],
          ],
        },
        { key: 'name', label: 'Название', required: true },
        {
          key: 'norm_hours',
          label: 'Норма, ч',
          kind: 'number',
          required: true,
          step: '0.25',
          min: 0,
        },
      ],
    },
  ]
}

const show = (field: Field, value: unknown) => {
  if (field.kind === 'checkbox') return value ? t('Да') : t('Нет')
  if (value === null || value === undefined || value === '') return '—'
  const option = field.options?.find(([v]) => v === String(value))
  return option ? t(option[1]) : String(value)
}

export function AdminPage({ data }: { data: AppData }) {
  const all = entities(data)
  const [table, setTable] = useState(all[0].table)
  const [editing, setEditing] = useState<string | null>(null) // pk или 'new'
  const [draft, setDraft] = useState<Record<string, Value>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const entity = all.find((e) => e.table === table)!

  function open(row: Record<string, unknown> | null) {
    setError('')
    setSaved('')
    setEditing(row ? String(row[entity.pk]) : 'new')
    setDraft(
      Object.fromEntries(
        entity.fields.map((f) => {
          const v = row?.[f.key]
          if (f.kind === 'checkbox') return [f.key, row ? Boolean(v) : true]
          if (v === null || v === undefined)
            return [f.key, f.kind === 'select' && !f.optional ? f.options?.[0]?.[0] ?? '' : '']
          return [f.key, String(v)]
        }),
      ),
    )
  }

  async function save() {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const values: Record<string, unknown> = {}
      for (const f of entity.fields) {
        if (f.createOnly && editing !== 'new') continue
        const raw = draft[f.key]
        if (f.kind === 'checkbox') values[f.key] = Boolean(raw)
        else {
          const text = String(raw ?? '').trim()
          if (!text) {
            if (f.required) throw new Error(`${t('Заполните поле')} «${t(f.label)}»`)
            values[f.key] = null
          } else if (f.kind === 'number' || f.numeric) {
            const n = Number(text.replace(',', '.'))
            if (!Number.isFinite(n))
              throw new Error(`${t('Введите число в поле')} «${t(f.label)}»`)
            values[f.key] = n
          } else values[f.key] = text
        }
      }
      const query =
        editing === 'new'
          ? supabase.from(entity.table).insert(values)
          : supabase
              .from(entity.table)
              .update(values)
              .eq(
                entity.pk,
                entity.pk === 'id' ? Number(editing) : (editing as string),
              )
      const { error } = await query
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['data'] })
      setSaved(editing === 'new' ? t('Запись добавлена') : t('Изменения сохранены'))
      setEditing(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const needle = search.trim().toLowerCase()
  const visible = entity.rows.filter(
    (r) =>
      !needle ||
      entity.fields.some((f) =>
        show(f, r[f.key]).toLowerCase().includes(needle),
      ),
  )

  return (
    <>
      <p className="eyebrow">{t('АДМИНИСТРИРОВАНИЕ')}</p>
      <h1>{t('Справочники')}</h1>
      <div className="segmented" role="group" aria-label={t('Справочник')}>
        {all.map((e) => (
          <button
            key={e.table}
            type="button"
            className="secondary"
            aria-pressed={table === e.table}
            onClick={() => {
              setTable(e.table)
              setEditing(null)
              setSearch('')
              setError('')
              setSaved('')
            }}
          >
            {t(e.title)} · {e.rows.length}
          </button>
        ))}
      </div>
      {entity.note && <p className="muted">{t(entity.note)}</p>}
      {saved && (
        <p className="notice" role="status">
          ✔ {saved}
        </p>
      )}

      {editing ? (
        <form
          className="panel form admin-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <h2>
            {editing === 'new' ? t('Новая запись') : t('Изменить запись')} ·{' '}
            {t(entity.title)}
          </h2>
          <div className="grid2">
            {entity.fields.map((f) =>
              f.kind === 'checkbox' ? (
                <label key={f.key} className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[f.key])}
                    onChange={(e) =>
                      setDraft({ ...draft, [f.key]: e.target.checked })
                    }
                  />
                  {t(f.label)}
                </label>
              ) : f.kind === 'select' ? (
                <label key={f.key}>
                  {t(f.label)}
                  <select
                    required={f.required}
                    value={String(draft[f.key] ?? '')}
                    onChange={(e) =>
                      setDraft({ ...draft, [f.key]: e.target.value })
                    }
                  >
                    {f.options?.map(([v, label]) => (
                      <option key={v} value={v}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label key={f.key}>
                  {t(f.label)}
                  <input
                    required={f.required}
                    disabled={f.createOnly && editing !== 'new'}
                    type={f.kind === 'number' ? 'number' : 'text'}
                    inputMode={f.kind === 'number' ? 'decimal' : undefined}
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    value={String(draft[f.key] ?? '')}
                    onChange={(e) =>
                      setDraft({ ...draft, [f.key]: e.target.value })
                    }
                  />
                </label>
              ),
            )}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions admin-actions">
            <button disabled={busy}>
              {busy ? t('Сохраняем…') : t('Сохранить')}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(null)
                setError('')
              }}
            >
              {t('Отмена')}
            </button>
          </div>
        </form>
      ) : (
        <div className="filters admin-toolbar">
          <label>
            {t('Поиск')}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button type="button" onClick={() => open(null)}>
            ＋ {t('Добавить')}
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              {entity.fields.map((f) => (
                <th key={f.key}>{t(f.label)}</th>
              ))}
              <th aria-label={t('Действия')} />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={String(r[entity.pk])}
                className={
                  editing === String(r[entity.pk]) ? 'editing' : undefined
                }
              >
                {entity.fields.map((f) => (
                  <td key={f.key}>{show(f, r[f.key])}</td>
                ))}
                <td>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      open(r)
                      window.scrollTo({ top: 0 })
                    }}
                  >
                    ✏️ {t('Изменить')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>{t('Ничего не найдено.')}</p>}
    </>
  )
}
