// Генератор демо-данных НарядAI. Запуск: npm run seed  (нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env)
// ВНИМАНИЕ: полностью очищает таблицы и тестовых пользователей *@naryad.local.
//
// Заложенные закономерности (их должна найти аналитика):
//  1. Конвейер К-3 ломается в 3 раза чаще остальных, в основном М-02 (подшипник).
//  2. Иванов С.: ~40% его нарядов дают повторную поломку того же шифра в течение 7 дней.
//  3. Дробилка КМД-1750 ломается через 3–5 дней после каждого ППР.
//  4. Ночная смена на обогатительной фабрике: время реакции в 2 раза выше.
//  5. (бонус для антифрода) Петров А. систематически списывает материалов в 2–3 раза больше нормы.
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------- детерминированный рандом ----------
let seed = 20261008
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
const between = (a: number, b: number) => a + rnd() * (b - a)
const weighted = <T,>(items: readonly T[], w: (x: T) => number): T => {
  const total = items.reduce((s, x) => s + w(x), 0)
  let r = rnd() * total
  for (const x of items) if ((r -= w(x)) <= 0) return x
  return items[items.length - 1]
}
const H = 3600_000
const iso = (t: number) => new Date(t).toISOString()

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<NonNullable<T>> {
  const { data, error } = await p
  if (error) throw new Error(`${what}: ${JSON.stringify(error)}`)
  return (data ?? []) as NonNullable<T>
}

// ---------- справочники ----------
const SITES = ['Участок дробления', 'Обогатительная фабрика', 'Конвейерный транспорт', 'Ремонтно-механический цех']

const EQUIPMENT: { name: string; site: number; type: string; crit: 1 | 2 | 3 }[] = [
  { name: 'Дробилка КМД-1750', site: 0, type: 'дробилка', crit: 3 },
  { name: 'Дробилка ККД-1500', site: 0, type: 'дробилка', crit: 3 },
  { name: 'Дробилка КСД-2200', site: 0, type: 'дробилка', crit: 3 },
  { name: 'Питатель пластинчатый ПП-1', site: 0, type: 'питатель', crit: 2 },
  { name: 'Грохот ГИТ-51', site: 0, type: 'грохот', crit: 2 },
  { name: 'Грохот ГИЛ-52', site: 0, type: 'грохот', crit: 2 },
  { name: 'Мельница МШЦ-3600', site: 1, type: 'мельница', crit: 3 },
  { name: 'Мельница МШР-3200', site: 1, type: 'мельница', crit: 3 },
  { name: 'Насос Н-1', site: 1, type: 'насос', crit: 2 },
  { name: 'Насос Н-2', site: 1, type: 'насос', crit: 2 },
  { name: 'Насос Н-3', site: 1, type: 'насос', crit: 2 },
  { name: 'Сепаратор СВ-1', site: 1, type: 'сепаратор', crit: 2 },
  { name: 'Классификатор КСН-24', site: 1, type: 'классификатор', crit: 2 },
  { name: 'Компрессор К-250', site: 1, type: 'компрессор', crit: 2 },
  { name: 'Конвейер К-1', site: 2, type: 'конвейер', crit: 2 },
  { name: 'Конвейер К-2', site: 2, type: 'конвейер', crit: 2 },
  { name: 'Конвейер К-3', site: 2, type: 'конвейер', crit: 3 },
  { name: 'Конвейер К-4', site: 2, type: 'конвейер', crit: 2 },
  { name: 'Конвейер К-5', site: 2, type: 'конвейер', crit: 2 },
  { name: 'Электродвигатель привода К-3', site: 2, type: 'электродвигатель', crit: 2 },
  { name: 'Станок токарный 1М63', site: 3, type: 'станок', crit: 1 },
  { name: 'Кран мостовой КМ-10', site: 3, type: 'кран', crit: 2 },
  { name: 'Сварочный пост СП-2', site: 3, type: 'сварка', crit: 1 },
  { name: 'Компрессор К-100', site: 3, type: 'компрессор', crit: 1 },
  { name: 'Пресс гидравлический П-63', site: 3, type: 'пресс', crit: 1 },
]

const FAULTS: { code: string; cat: 'М' | 'Э' | 'Г' | 'П' | 'С'; name: string; norm: number; spec: string; mats: string[] }[] = [
  { code: 'М-01', cat: 'М', name: 'Износ футеровки/брони', norm: 6, spec: 'слесарь', mats: ['Плита футеровочная', 'Болт М24', 'Гайка М24'] },
  { code: 'М-02', cat: 'М', name: 'Отказ подшипника', norm: 3, spec: 'слесарь', mats: ['Подшипник 22320', 'Смазка Литол-24', 'Уплотнение манжетное'] },
  { code: 'М-03', cat: 'М', name: 'Порыв/износ конвейерной ленты', norm: 5, spec: 'слесарь', mats: ['Лента конвейерная (м)', 'Клей для ленты', 'Скоба соединительная'] },
  { code: 'М-04', cat: 'М', name: 'Заклинивание/износ роликов', norm: 1.5, spec: 'слесарь', mats: ['Ролик конвейерный', 'Подшипник 6305'] },
  { code: 'М-05', cat: 'М', name: 'Разрушение муфты/зубьев', norm: 4, spec: 'сварщик', mats: ['Муфта упругая МУВП', 'Электроды УОНИ-13/55', 'Палец муфты'] },
  { code: 'М-06', cat: 'М', name: 'Вибрация, несоосность привода', norm: 2.5, spec: 'слесарь', mats: ['Прокладка регулировочная', 'Болт М16'] },
  { code: 'М-07', cat: 'М', name: 'Трещина металлоконструкции', norm: 4, spec: 'сварщик', mats: ['Электроды УОНИ-13/55', 'Лист стальной 10 мм (кг)'] },
  { code: 'М-10', cat: 'М', name: 'Плановый ремонт (ППР)', norm: 8, spec: 'слесарь', mats: ['Смазка Литол-24', 'Масло И-40 (л)', 'Фильтр масляный'] },
  { code: 'Э-01', cat: 'Э', name: 'Отказ электродвигателя', norm: 4, spec: 'электрик', mats: ['Подшипник 6312', 'Щётка угольная', 'Лак изоляционный (л)'] },
  { code: 'Э-02', cat: 'Э', name: 'Повреждение кабеля', norm: 2, spec: 'электрик', mats: ['Кабель КГ 3х16 (м)', 'Муфта кабельная', 'Изолента'] },
  { code: 'Э-03', cat: 'Э', name: 'Срабатывание защиты/автомата', norm: 1, spec: 'электрик', mats: ['Автомат ВА 47-29', 'Предохранитель'] },
  { code: 'Э-04', cat: 'Э', name: 'Неисправность датчика', norm: 1, spec: 'электрик', mats: ['Датчик индуктивный', 'Кабель КГ 3х1,5 (м)'] },
  { code: 'Э-05', cat: 'Э', name: 'Отказ пускателя/контактора', norm: 1.5, spec: 'электрик', mats: ['Контактор КМИ-25', 'Катушка контактора'] },
  { code: 'Э-06', cat: 'Э', name: 'Перегрев двигателя', norm: 2, spec: 'электрик', mats: ['Вентилятор охлаждения', 'Подшипник 6312'] },
  { code: 'Г-01', cat: 'Г', name: 'Утечка гидравлики', norm: 2, spec: 'слесарь', mats: ['РВД 1/2"', 'Масло гидравлическое ВМГЗ (л)', 'Кольцо уплотнительное'] },
  { code: 'Г-02', cat: 'Г', name: 'Отказ гидроцилиндра', norm: 4, spec: 'слесарь', mats: ['Ремкомплект гидроцилиндра', 'Масло гидравлическое ВМГЗ (л)'] },
  { code: 'Г-03', cat: 'Г', name: 'Течь масла через уплотнения', norm: 1.5, spec: 'слесарь', mats: ['Уплотнение манжетное', 'Масло И-40 (л)', 'Герметик'] },
  { code: 'П-01', cat: 'П', name: 'Утечка сжатого воздуха', norm: 1, spec: 'слесарь', mats: ['Шланг пневматический (м)', 'Хомут'] },
  { code: 'П-02', cat: 'П', name: 'Отказ пневмоклапана', norm: 1.5, spec: 'слесарь', mats: ['Пневмоклапан', 'Фитинг'] },
  { code: 'С-01', cat: 'С', name: 'Недостаток/загрязнение смазки', norm: 1, spec: 'слесарь', mats: ['Смазка Литол-24', 'Масло И-40 (л)', 'Ветошь (кг)'] },
]

const MATERIALS: { name: string; unit: string; typical: number }[] = [
  ['Плита футеровочная', 'шт', 4], ['Болт М24', 'шт', 16], ['Гайка М24', 'шт', 16], ['Подшипник 22320', 'шт', 1],
  ['Смазка Литол-24', 'кг', 1], ['Уплотнение манжетное', 'шт', 2], ['Лента конвейерная (м)', 'м', 6], ['Клей для ленты', 'кг', 2],
  ['Скоба соединительная', 'шт', 10], ['Ролик конвейерный', 'шт', 2], ['Подшипник 6305', 'шт', 2], ['Муфта упругая МУВП', 'шт', 1],
  ['Электроды УОНИ-13/55', 'кг', 2], ['Палец муфты', 'шт', 6], ['Прокладка регулировочная', 'шт', 4], ['Болт М16', 'шт', 8],
  ['Лист стальной 10 мм (кг)', 'кг', 15], ['Масло И-40 (л)', 'л', 10], ['Фильтр масляный', 'шт', 1], ['Подшипник 6312', 'шт', 2],
  ['Щётка угольная', 'шт', 4], ['Лак изоляционный (л)', 'л', 1], ['Кабель КГ 3х16 (м)', 'м', 15], ['Муфта кабельная', 'шт', 1],
  ['Изолента', 'шт', 2], ['Автомат ВА 47-29', 'шт', 1], ['Предохранитель', 'шт', 2], ['Датчик индуктивный', 'шт', 1],
  ['Кабель КГ 3х1,5 (м)', 'м', 5], ['Контактор КМИ-25', 'шт', 1], ['Катушка контактора', 'шт', 1], ['Вентилятор охлаждения', 'шт', 1],
  ['РВД 1/2"', 'шт', 1], ['Масло гидравлическое ВМГЗ (л)', 'л', 8], ['Кольцо уплотнительное', 'шт', 4], ['Ремкомплект гидроцилиндра', 'компл', 1],
  ['Герметик', 'шт', 1], ['Шланг пневматический (м)', 'м', 3], ['Хомут', 'шт', 4], ['Пневмоклапан', 'шт', 1],
].map(([name, unit, typical]) => ({ name: name as string, unit: unit as string, typical: typical as number }))
// ещё 2 позиции до 42, чтобы покрыть все mats
MATERIALS.push({ name: 'Фитинг', unit: 'шт', typical: 2 }, { name: 'Ветошь (кг)', unit: 'кг', typical: 1 })

const FAULT_BY_TYPE: Record<string, string[]> = {
  дробилка: ['М-01', 'М-02', 'М-05', 'М-06', 'Г-01', 'Г-03', 'Э-01', 'С-01'],
  питатель: ['М-04', 'М-05', 'М-07', 'Э-01'],
  грохот: ['М-02', 'М-06', 'М-07', 'Э-01'],
  мельница: ['М-01', 'М-02', 'М-05', 'Г-03', 'Э-01', 'Э-06', 'С-01'],
  насос: ['М-02', 'Г-03', 'Э-01', 'Э-03', 'С-01'],
  сепаратор: ['М-02', 'Э-04', 'Э-05'],
  классификатор: ['М-02', 'М-07', 'Э-01'],
  компрессор: ['П-01', 'П-02', 'Э-03', 'С-01', 'М-02'],
  конвейер: ['М-02', 'М-03', 'М-04', 'М-06', 'Э-02', 'Э-04'],
  электродвигатель: ['Э-01', 'Э-03', 'Э-05', 'Э-06'],
  станок: ['Э-03', 'Э-05', 'С-01'],
  кран: ['Э-02', 'Э-05', 'М-02'],
  сварка: ['Э-02', 'Э-03'],
  пресс: ['Г-01', 'Г-02', 'Э-05'],
}

const DESCRIPTIONS: Record<string, string[]> = {
  'М-01': ['Износ брони, стук при работе', 'Отвалилась плита футеровки'],
  'М-02': ['Гул и нагрев подшипникового узла', 'Подшипник греется до 90°, посторонний шум', 'Заклинил подшипник приводного барабана'],
  'М-03': ['Порыв ленты на стыке', 'Боковой износ ленты, сход ленты'],
  'М-04': ['Заклинили роликоопоры', 'Ролики не крутятся, лента трётся'],
  'М-05': ['Разрушена упругая муфта', 'Сколы зубьев венца'],
  'М-06': ['Сильная вибрация привода', 'Несоосность редуктора и двигателя'],
  'М-07': ['Трещина на раме', 'Трещина сварного шва опоры'],
  'М-10': ['Плановый ремонт по графику ППР'],
  'Э-01': ['Двигатель не запускается', 'Пробой обмотки двигателя'],
  'Э-02': ['Повреждён питающий кабель', 'Кабель перебит, искрит'],
  'Э-03': ['Выбивает автомат при пуске', 'Срабатывает тепловая защита'],
  'Э-04': ['Датчик схода ленты даёт ложный сигнал', 'Нет сигнала с датчика скорости'],
  'Э-05': ['Не включается пускатель', 'Залипание контактора'],
  'Э-06': ['Перегрев двигателя, запах гари', 'Температура корпуса двигателя выше нормы'],
  'Г-01': ['Течь гидравлики из РВД', 'Падение давления в гидросистеме'],
  'Г-02': ['Гидроцилиндр не держит давление'],
  'Г-03': ['Течь масла из-под уплотнения', 'Масляное пятно под редуктором'],
  'П-01': ['Утечка воздуха, шипит магистраль'],
  'П-02': ['Не срабатывает пневмоклапан'],
  'С-01': ['Нет смазки в узле, сухой ход', 'Загрязнённое масло в редукторе'],
}

const WORKERS = [
  // бригада 1 (дневная)
  { login: 'worker1', name: 'Ахметов Ерлан', spec: 'слесарь', grade: 5, brigade: 'Бригада 1', shift: 'day' },
  { login: 'worker2', name: 'Нурланов Данияр', spec: 'электрик', grade: 5, brigade: 'Бригада 1', shift: 'day' },
  { login: 'worker3', name: 'Сейтжанов Асхат', spec: 'слесарь', grade: 4, brigade: 'Бригада 1', shift: 'day' },
  { login: 'worker4', name: 'Ким Виктор', spec: 'сварщик', grade: 5, brigade: 'Бригада 1', shift: 'day' },
  { login: 'worker5', name: 'Иванов Сергей', spec: 'слесарь', grade: 3, brigade: 'Бригада 1', shift: 'day' },
  // бригада 2 (дневная)
  { login: 'worker6', name: 'Жумабеков Арман', spec: 'слесарь', grade: 5, brigade: 'Бригада 2', shift: 'day' },
  { login: 'worker7', name: 'Петров Алексей', spec: 'слесарь', grade: 4, brigade: 'Бригада 2', shift: 'day' },
  { login: 'worker8', name: 'Оспанов Марат', spec: 'электрик', grade: 4, brigade: 'Бригада 2', shift: 'day' },
  { login: 'worker9', name: 'Ли Денис', spec: 'электрик', grade: 3, brigade: 'Бригада 2', shift: 'day' },
  { login: 'worker10', name: 'Тулегенов Бауыржан', spec: 'сварщик', grade: 4, brigade: 'Бригада 2', shift: 'day' },
  // бригада 3 (ночная)
  { login: 'worker11', name: 'Абдрахманов Ринат', spec: 'слесарь', grade: 4, brigade: 'Бригада 3', shift: 'night' },
  { login: 'worker12', name: 'Смагулов Ержан', spec: 'слесарь', grade: 3, brigade: 'Бригада 3', shift: 'night' },
  { login: 'worker13', name: 'Кузнецов Павел', spec: 'электрик', grade: 4, brigade: 'Бригада 3', shift: 'night' },
  { login: 'worker14', name: 'Байжанов Нуржан', spec: 'электрик', grade: 3, brigade: 'Бригада 3', shift: 'night' },
  { login: 'worker15', name: 'Омаров Тимур', spec: 'сварщик', grade: 4, brigade: 'Бригада 3', shift: 'night' },
] as const

const STAFF = [
  { login: 'master1', name: 'Сейткали Бахытжан', spec: 'мастер', role: 'master', shift: 'day' },
  { login: 'master2', name: 'Григорьев Олег', spec: 'мастер', role: 'master', shift: 'night' },
  { login: 'manager1', name: 'Мусин Канат', spec: 'начальник участка', role: 'manager', shift: 'day' },
  { login: 'admin1', name: 'Администратор', spec: 'администратор', role: 'admin', shift: 'day' },
] as const

const PIN = '111111'
const REJECT_REASONS = ['Нет материалов', 'Нет допуска', 'Занят аварийным', 'Не успеваю', 'Нет инструмента']
const PAUSE_REASONS = ['Ждём запчасти со склада', 'Ждём остановки оборудования', 'Ждём допуск']

// ---------- main ----------
async function wipe() {
  console.log('Очистка...')
  for (const t of ['notifications', 'ai_insights', 'ai_reviews', 'order_materials', 'order_photos', 'order_events', 'orders']) {
    await must(db.from(t).delete().gte('id', 0), `wipe ${t}`)
  }
  await must(db.from('employees').delete().gte('id', 0), 'wipe employees')
  await must(db.from('equipment').delete().gte('id', 0), 'wipe equipment')
  await must(db.from('sites').delete().gte('id', 0), 'wipe sites')
  await must(db.from('materials').delete().gte('id', 0), 'wipe materials')
  await must(db.from('fault_codes').delete().neq('code', ''), 'wipe fault_codes')
  for (let page = 1; ; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 })
    const ours = (data?.users ?? []).filter((u) => u.email?.endsWith('@naryad.local'))
    for (const u of ours) await db.auth.admin.deleteUser(u.id)
    if (!data || data.users.length < 200) break
  }
}

async function insertChunked<T extends object>(table: string, rows: T[], select = false): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const q = db.from(table).insert(rows.slice(i, i + 500))
    out.push(...((await must(select ? q.select() : q, `insert ${table}`)) ?? []))
  }
  return out
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Заполните SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env')
  }
  await wipe()

  console.log('Справочники...')
  const sites = await must(db.from('sites').insert(SITES.map((name) => ({ name }))).select(), 'sites')
  const siteId = (i: number) => sites.find((s: any) => s.name === SITES[i])!.id as number
  const equipment = await must(
    db.from('equipment').insert(EQUIPMENT.map((e, i) => ({
      name: e.name, inv_number: `ИНВ-${String(1001 + i)}`, site_id: siteId(e.site), type: e.type, criticality: e.crit,
      qr_code: `EQ-${1001 + i}`,
    }))).select(),
    'equipment',
  )
  await must(db.from('fault_codes').insert(FAULTS.map((f) => ({ code: f.code, category: f.cat, name: f.name, norm_hours: f.norm }))), 'fault_codes')
  const materials = await must(db.from('materials').insert(MATERIALS.map((m) => ({ name: m.name, unit: m.unit, typical_qty: m.typical }))).select(), 'materials')
  const matByName = new Map(materials.map((m: any) => [m.name, m]))

  console.log('Сотрудники и аккаунты...')
  const people = [
    ...STAFF.map((s) => ({ ...s, grade: 6, brigade: null as string | null })),
    ...WORKERS.map((w) => ({ ...w, role: 'worker' as const })),
  ]
  const empRows = []
  for (const p of people) {
    const { data, error } = await db.auth.admin.createUser({ email: `${p.login}@naryad.local`, password: PIN, email_confirm: true })
    if (error) throw new Error(`createUser ${p.login}: ${error.message}`)
    empRows.push({
      auth_user_id: data.user.id, full_name: p.name, login: p.login, specialty: p.spec, grade: p.grade,
      brigade: p.brigade, role: p.role, shift: p.shift, on_shift: p.shift === 'day',
    })
  }
  const employees = await must(db.from('employees').insert(empRows).select(), 'employees')
  const emp = (login: string) => employees.find((e: any) => e.login === login)!
  const workers = employees.filter((e: any) => e.role === 'worker')
  const ivanov = emp('worker5'), petrov = emp('worker7')
  const eq = (name: string) => equipment.find((e: any) => e.name === name)!
  const K3 = eq('Конвейер К-3'), KMD = eq('Дробилка КМД-1750')
  const faultByCode = new Map(FAULTS.map((f) => [f.code, f]))

  // ---------- генерация истории ----------
  console.log('Наряды за 3 месяца...')
  type Plan = {
    created: number; equipment: any; fault: string; type: 'planned' | 'emergency'; priority: string
    assignee?: any; forceBad?: boolean
  }
  const now = Date.now()
  const start = now - 90 * 24 * H
  const plans: Plan[] = []

  // (3) ППР дробилки КМД-1750 каждые ~14 дней + поломка через 3–5 дней
  for (let t = start + 2 * 24 * H; t < now - 6 * 24 * H; t += between(13, 15) * 24 * H) {
    const d = new Date(t); d.setHours(9, 0, 0, 0)
    plans.push({ created: d.getTime(), equipment: KMD, fault: 'М-10', type: 'planned', priority: 'planned' })
    plans.push({ created: d.getTime() + between(3, 5) * 24 * H, equipment: KMD, fault: pick(['М-02', 'М-06', 'Г-03']), type: 'emergency', priority: 'emergency' })
  }
  // плановые ППР остального оборудования
  for (const e of equipment) {
    if (e.id === KMD.id) continue
    for (let t = start + between(0, 20) * 24 * H; t < now - 2 * 24 * H; t += 30 * 24 * H) {
      const d = new Date(t); d.setHours(9, 0, 0, 0)
      plans.push({ created: d.getTime(), equipment: e, fault: 'М-10', type: 'planned', priority: 'planned' })
    }
  }
  // внеплановые: (1) К-3 весит в 3 раза больше, в основном М-02
  const base = 500
  for (let i = 0; i < base; i++) {
    const e = weighted(equipment, (x: any) => (x.id === K3.id ? 3 * 2.2 : x.criticality === 3 ? 1.2 : 1))
    const fault = e.id === K3.id && rnd() < 0.7 ? 'М-02' : pick(FAULT_BY_TYPE[e.type])
    const emergency = rnd() < 0.45
    plans.push({
      created: start + rnd() * (now - start - 3 * H), equipment: e, fault, type: 'emergency',
      priority: emergency ? 'emergency' : rnd() < 0.5 ? 'high' : 'normal',
    })
  }
  plans.sort((a, b) => a.created - b.created)

  const isNight = (t: number) => { const h = new Date(t).getHours(); return h >= 20 || h < 8 }
  const busyUntil = new Map<number, number>()
  const chooseWorker = (fault: string, t: number) => {
    const spec = faultByCode.get(fault)!.spec
    const shift = isNight(t) ? 'night' : 'day'
    let pool = workers.filter((w: any) => w.specialty === spec && w.shift === shift)
    if (!pool.length) pool = workers.filter((w: any) => w.shift === shift)
    // Иванову чаще дают типовые механические наряды
    return weighted(pool, (w: any) => ((busyUntil.get(w.id) ?? 0) > t ? 0.3 : 1) * (w.id === ivanov.id ? 1.5 : 1))
  }

  const orders: any[] = []
  const meta: { events: any[]; mats: { material: any; qty: number }[]; review: any; bad: boolean; plan: Plan }[] = []
  const extra: Plan[] = []

  const build = (p: Plan) => {
    const night = isNight(p.created)
    const master = night ? emp('master2') : emp('master1')
    const assignee = p.assignee ?? chooseWorker(p.fault, p.created)
    const f = faultByCode.get(p.fault)!
    const norm = f.norm
    const deadlineH = p.priority === 'emergency' ? norm * 1.3 + 0.5 : p.priority === 'planned' ? norm + 16 : norm * 1.6 + 2
    const deadline = p.created + deadlineH * H
    const siteName = SITES[EQUIPMENT.findIndex((x) => x.name === p.equipment.name) >= 0 ? EQUIPMENT.find((x) => x.name === p.equipment.name)!.site : 0]
    // (4) реакция: ночью на обогатительной фабрике в 2 раза дольше
    let reactMin = p.priority === 'emergency' ? between(2, 8) : between(5, 30)
    if (night && siteName === 'Обогатительная фабрика') reactMin *= 2.2
    const accepted = p.created + reactMin * 60_000
    const started = accepted + between(5, 40) * 60_000
    const isIvanov = assignee.id === ivanov.id
    const durH = norm * between(0.7, 1.35) * (isIvanov ? 0.8 : 1) // Иванов делает быстро и некачественно
    const submitted = started + durH * H
    const bad = isIvanov && p.type === 'emergency' && rnd() < 0.42
    const rework = !bad && rnd() < 0.05
    const closed = submitted + between(10, 90) * 60_000 + (rework ? 2 * H : 0)
    busyUntil.set(assignee.id, submitted)

    const events: any[] = [
      { action: 'accept', from_status: 'issued', to_status: 'accepted', created_at: iso(accepted) },
      { action: 'start', from_status: 'accepted', to_status: 'in_progress', created_at: iso(started) },
    ]
    if (rnd() < 0.08) {
      const pt = started + durH * 0.4 * H
      events.push({ action: 'pause', from_status: 'in_progress', to_status: 'paused', reason: pick(PAUSE_REASONS), created_at: iso(pt) })
      events.push({ action: 'resume', from_status: 'paused', to_status: 'in_progress', created_at: iso(pt + 0.5 * H) })
    }
    events.push({ action: 'submit', from_status: 'in_progress', to_status: 'submitted', created_at: iso(submitted) })
    if (rework) {
      events.push({ action: 'rework', from_status: 'submitted', to_status: 'needs_rework', comment: 'Нет фото «после»', created_at: iso(submitted + 20 * 60_000) })
      events.push({ action: 'start', from_status: 'needs_rework', to_status: 'in_progress', created_at: iso(submitted + 40 * 60_000) })
      events.push({ action: 'submit', from_status: 'in_progress', to_status: 'submitted', created_at: iso(submitted + 100 * 60_000) })
    }
    events.push({ action: 'close', from_status: 'submitted', to_status: 'closed', created_at: iso(closed), actor: master })

    // материалы: (5) Петров списывает в 2–3 раза больше
    const mats = f.mats.slice(0, 1 + Math.floor(rnd() * f.mats.length)).map((name) => {
      const m = matByName.get(name)!
      const k = assignee.id === petrov.id ? between(2, 3) : between(0.6, 1.3)
      return { material: m, qty: Math.max(1, Math.round(Number(m.typical_qty) * k)) }
    })

    const q = isIvanov ? pick([2, 3, 3, 4]) : pick([3, 4, 4, 4, 5, 5])
    const overuse = assignee.id === petrov.id
    const review = {
      verdict: q >= 4 && !overuse ? 'accepted' : q >= 3 ? 'accepted_with_notes' : 'needs_rework',
      score: overuse ? Math.min(q, 3) : q,
      photo_score: pick([3, 4, 4, 5]),
      explanation: overuse ? 'Расход материалов в 2–3 раза выше нормы.' : q >= 4 ? 'Работы соответствуют проблеме, наряд заполнен полностью.' : 'Описание работ поверхностное.',
      worker_feedback: q >= 4 ? 'Хорошая работа, уложились в норматив.' : 'Подробнее описывайте выполненные работы.',
      checks: [], needs_master_review: false, model: 'seed', created_at: iso(submitted + 60_000),
    }

    orders.push({
      type: p.type, description: pick(DESCRIPTIONS[p.fault]), site_id: p.equipment.site_id, equipment_id: p.equipment.id,
      assignee_id: assignee.id, master_id: master.id, priority: p.priority, deadline: iso(deadline), status: 'closed',
      is_overdue: false, fault_code: p.fault,
      work_done: p.fault === 'М-10' ? 'Выполнен ППР по регламенту: осмотр, замена смазки и фильтров, подтяжка соединений' : `Устранено: ${f.name.toLowerCase()}. Проверена работа под нагрузкой.`,
      created_at: iso(p.created), accepted_at: iso(accepted), started_at: iso(started),
      submitted_at: iso(rework ? submitted + 100 * 60_000 : submitted), closed_at: iso(closed),
    })
    meta.push({ events, mats, review, bad, plan: p })

    // (2) повторная поломка после Иванова
    if (bad) {
      extra.push({
        created: closed + between(1, 6) * 24 * H, equipment: p.equipment, fault: p.fault, type: 'emergency', priority: 'emergency',
      })
    }
  }

  for (const p of plans) build(p)
  for (let i = 0; i < extra.length; i++) if (extra[i].created < now - 4 * H) build(extra[i])

  // немного отказов (часть необоснованных)
  const rejects: { idx: number; worker: any; reason: string }[] = []
  for (let i = 0; i < orders.length; i++) {
    if (rnd() < 0.04) {
      const w = pick(workers)
      if (w.id !== orders[i].assignee_id) rejects.push({ idx: i, worker: w, reason: pick(REJECT_REASONS) })
    }
  }

  const inserted = await insertChunked('orders', orders, true)
  console.log(`  нарядов: ${inserted.length}`)

  const evRows: any[] = [], matRows: any[] = [], revRows: any[] = []
  inserted.forEach((o: any, i: number) => {
    const m = meta[i]
    for (const ev of m.events) {
      const { actor, ...rest } = ev
      evRows.push({ order_id: o.id, actor_id: (actor ?? null)?.id ?? o.assignee_id, ...rest })
    }
    for (const x of m.mats) matRows.push({ order_id: o.id, material_id: x.material.id, qty: x.qty })
    revRows.push({ order_id: o.id, ...m.review })
  })
  for (const r of rejects) {
    const o = inserted[r.idx]
    evRows.push({
      order_id: o.id, actor_id: r.worker.id, action: 'reject', from_status: 'issued', to_status: 'rejected',
      reason: r.reason, created_at: iso(new Date(o.created_at).getTime() + 3 * 60_000),
    })
  }
  await insertChunked('order_events', evRows)
  await insertChunked('order_materials', matRows)
  await insertChunked('ai_reviews', revRows)

  // ---------- активные наряды на «сегодня» для демо ----------
  console.log('Активные наряды текущей смены...')
  const t0 = now
  const active = [
    { eq: 'Конвейер К-3', fault: 'М-02', st: 'in_progress', who: 'worker6', pr: 'emergency', ago: 1.2, dl: 2 },
    { eq: 'Мельница МШЦ-3600', fault: 'Э-06', st: 'in_progress', who: 'worker8', pr: 'high', ago: 2, dl: 2 },
    { eq: 'Грохот ГИТ-51', fault: 'М-06', st: 'queued', who: 'worker3', pr: 'normal', ago: 1, dl: 5 },
    { eq: 'Насос Н-1', fault: 'С-01', st: 'accepted', who: 'worker7', pr: 'normal', ago: 0.5, dl: 3 },
    { eq: 'Кран мостовой КМ-10', fault: 'Э-05', st: 'issued', who: 'worker9', pr: 'high', ago: 0.1, dl: 2 },
    { eq: 'Конвейер К-1', fault: 'М-04', st: 'paused', who: 'worker5', pr: 'normal', ago: 3, dl: 0.5 },
    { eq: 'Сварочный пост СП-2', fault: 'Э-02', st: 'submitted', who: 'worker4', pr: 'normal', ago: 4, dl: 1 },
  ]
  for (const a of active) {
    const e = eq(a.eq), w = emp(a.who)
    const created = t0 - a.ago * H
    const row: any = {
      type: a.pr === 'emergency' || a.pr === 'high' ? 'emergency' : 'planned', description: pick(DESCRIPTIONS[a.fault]),
      site_id: e.site_id, equipment_id: e.id, assignee_id: w.id, master_id: emp('master1').id, priority: a.pr,
      deadline: iso(created + a.dl * H), status: a.st, is_overdue: created + a.dl * H < t0, created_at: iso(created),
    }
    if (a.st !== 'issued') row.accepted_at = iso(created + 5 * 60_000)
    if (['in_progress', 'paused', 'submitted'].includes(a.st)) row.started_at = iso(created + 15 * 60_000)
    if (a.st === 'submitted') {
      row.submitted_at = iso(t0 - 20 * 60_000); row.fault_code = a.fault; row.work_done = 'Заменён участок кабеля, проверена изоляция'
    }
    const [o] = await must(db.from('orders').insert(row).select(), 'active order')
    const evs: any[] = []
    if (row.accepted_at) evs.push({ action: a.st === 'queued' ? 'queue' : 'accept', from_status: 'issued', to_status: a.st === 'queued' ? 'queued' : 'accepted', created_at: row.accepted_at })
    if (row.started_at) evs.push({ action: 'start', from_status: 'accepted', to_status: 'in_progress', created_at: row.started_at })
    if (a.st === 'paused') evs.push({ action: 'pause', from_status: 'in_progress', to_status: 'paused', reason: 'Ждём запчасти со склада', comment: 'ждём подшипник со склада', created_at: iso(t0 - 1 * H) })
    if (a.st === 'submitted') evs.push({ action: 'submit', from_status: 'in_progress', to_status: 'submitted', created_at: row.submitted_at })
    if (evs.length) await must(db.from('order_events').insert(evs.map((x) => ({ ...x, order_id: o.id, actor_id: w.id }))), 'active events')
  }

  // ---------- проверка закономерностей ----------
  const cnt = (f: (o: any, i: number) => boolean) => orders.filter(f).length
  const unplanned = (o: any) => o.type === 'emergency'
  const k3 = cnt((o) => unplanned(o) && o.equipment_id === K3.id)
  const avgOther = cnt((o) => unplanned(o) && o.equipment_id !== K3.id) / (equipment.length - 1)
  console.log('\nГотово. Проверка закономерностей:')
  console.log(`  1) К-3: ${k3} внеплановых против ~${avgOther.toFixed(1)} в среднем у остальных (x${(k3 / avgOther).toFixed(1)})`)
  const ivTotal = meta.filter((m, i) => orders[i].assignee_id === ivanov.id && m.plan.type === 'emergency').length
  console.log(`  2) Иванов: ${meta.filter((m) => m.bad).length} повторных поломок из ${ivTotal} аварийных нарядов`)
  console.log(`  3) КМД-1750: ППР каждые ~14 дней, поломка через 3–5 дней после каждого`)
  console.log(`  4) Ночь + обогатительная фабрика: реакция x2.2`)
  console.log(`  5) Петров: расход материалов x2–3`)
  console.log(`\nВсего нарядов: ${orders.length + active.length}. Аккаунты: master1, master2, manager1, admin1, worker1..worker15, ПИН ${PIN}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
