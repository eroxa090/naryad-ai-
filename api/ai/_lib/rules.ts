// Детерминированная часть ИИ: справочники, специальности, разбор фразы мастера без LLM.
import type { Equipment, FaultCode, Material, OrderType, Priority, Site } from '../../../shared/types.js'
import { admin } from '../../_lib/supabase.js'

export interface Refs {
  sites: Site[]
  equipment: Equipment[]
  faults: FaultCode[]
  materials: Material[]
}

export async function loadRefs(): Promise<Refs> {
  const [sites, equipment, faults, materials] = await Promise.all([
    admin.from('sites').select('*').order('id'),
    admin.from('equipment').select('*').order('id'),
    admin.from('fault_codes').select('*').order('code'),
    admin.from('materials').select('*').order('id'),
  ])
  return {
    sites: (sites.data ?? []) as Site[],
    equipment: (equipment.data ?? []) as Equipment[],
    faults: (faults.data ?? []) as FaultCode[],
    materials: (materials.data ?? []) as Material[],
  }
}

// Кто чинит: электрика — электрик, разрушения металла — сварщик, остальное — слесарь.
export function specialtyFor(faultCode: string | null | undefined, equipmentType?: string): string {
  if (faultCode?.startsWith('Э')) return 'электрик'
  if (faultCode === 'М-05' || faultCode === 'М-07') return 'сварщик'
  if (!faultCode && equipmentType === 'электродвигатель') return 'электрик'
  return 'слесарь'
}

// Whisper иногда пишет коды латиницей («N2», «KMD-1750») — приводим к кириллице.
const LAT: Record<string, string> = {
  a: 'а', b: 'б', c: 'с', d: 'д', e: 'е', g: 'г', i: 'и', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', z: 'з', h: 'н', y: 'у',
}
const normalize = (s: string) =>
  ` ${s.toLowerCase().replace(/ё/g, 'е').replace(/[a-z]/g, (c) => LAT[c] ?? c).replace(/[«»"“”.,!?;:()]/g, ' ').replace(/\s+/g, ' ')} `

const NUMBER_WORDS: Record<string, string> = {
  один: '1', первый: '1', первая: '1', два: '2', второй: '2', вторая: '2', три: '3', третий: '3', третья: '3',
  четыре: '4', четвертый: '4', пять: '5', пятый: '5', шесть: '6', семь: '7', восемь: '8', девять: '9', десять: '10',
}

// Ключевые слова → шифр неисправности (порядок важен: специфичные выше общих).
const FAULT_KEYWORDS: [RegExp, string][] = [
  [/ппр|плановый ремонт|по графику|техобслуж| то /, 'М-10'],
  [/гидроцилиндр/, 'Г-02'],
  [/рвд|гидравлик|давлени/, 'Г-01'],
  [/теч|подтек|масло|сальник|уплотнен/, 'Г-03'],
  [/пускател|контактор/, 'Э-05'],
  [/датчик/, 'Э-04'],
  [/автомат|выбива|защит/, 'Э-03'],
  [/кабел|провод|искрит/, 'Э-02'],
  [/перегрев|гарь|гари|горяч/, 'Э-06'],
  [/двигател.* не|не запуска|обмотк|не крутит/, 'Э-01'],
  [/подшипник|гул|шум|греется/, 'М-02'],
  [/футеров|брон/, 'М-01'],
  [/лент|порыв|сход/, 'М-03'],
  [/ролик/, 'М-04'],
  [/муфт|зуб/, 'М-05'],
  [/вибрац|несоосн|трясет|бьет/, 'М-06'],
  [/трещин|сварн|шов/, 'М-07'],
  [/пневмоклапан|клапан/, 'П-02'],
  [/воздух|шипит|пневм/, 'П-01'],
  [/смазк|сухой|без смазки/, 'С-01'],
]

function matchEquipment(text: string, refs: Refs): { equipment: Equipment | null; score: number } {
  let t = text
  for (const [w, d] of Object.entries(NUMBER_WORDS)) t = t.replace(new RegExp(` ${w} `, 'g'), ` ${d} `)
  // «н 2», «н2», «н-2» → «н-2»
  t = t.replace(/ ([а-я]{1,4}) ?-? ?(\d{1,4}) /g, ' $1-$2 ')
  let best: Equipment | null = null
  let bestScore = 0
  const stem = (e: Equipment) => normalize(e.name).trim().split(' ')[0].slice(0, 5)
  for (const e of refs.equipment) {
    const name = normalize(e.name)
    const typeStem = stem(e)
    const code = name.match(/([а-я]{1,4})-?(\d{1,4})/)
    let score = 0
    if (t.includes(` ${typeStem}`)) {
      score += 2
      // единственное оборудование такого типа («кран мостовой») — название однозначно
      if (refs.equipment.filter((x) => stem(x) === typeStem).length === 1) score += 2
    }
    if (code && t.includes(` ${code[1]}-${code[2]} `)) score += 4
    else if (code && t.includes(` ${code[2]} `)) score += 2
    if (code && code[1].length >= 2 && t.includes(` ${code[1]}`)) score += 2
    // «привод», «двигатель» отличают электродвигатель К-3 от самого конвейера К-3
    if (e.type === 'электродвигатель') score += /двигател|привод/.test(t) ? 2 : -2
    const site = refs.sites.find((s) => s.id === e.site_id)
    if (site && t.includes(normalize(site.name).trim().split(' ').slice(-1)[0].slice(0, 6))) score += 1
    if (score > bestScore) [best, bestScore] = [e, score]
  }
  return bestScore >= 4 ? { equipment: best, score: bestScore } : { equipment: null, score: 0 }
}

export interface ParsedOrder {
  description: string
  type: OrderType
  priority: Priority
  site_id: number | null
  equipment_id: number | null
  fault_code: string | null
  norm_hours: number | null
  confidence: number
}

export function parseOrderText(raw: string, refs: Refs): ParsedOrder {
  const t = normalize(raw)
  const { equipment, score } = matchEquipment(t, refs)
  const fault = FAULT_KEYWORDS.find(([re]) => re.test(t))?.[1] ?? null
  const planned = fault === 'М-10' || /планов|по графику|ппр/.test(t)
  const priority: Priority = planned
    ? 'planned'
    : /авари|срочн|немедленн|встал|останов|пожар|искрит|дым|опасн/.test(t)
      ? 'emergency'
      : /важн|высок|быстрее|сегодня/.test(t)
        ? 'high'
        : 'normal'
  const f = refs.faults.find((x) => x.code === fault)
  const description = raw.trim().replace(/^./, (c) => c.toUpperCase())
  return {
    description,
    type: planned ? 'planned' : 'emergency',
    priority,
    site_id: equipment?.site_id ?? null,
    equipment_id: equipment?.id ?? null,
    fault_code: fault,
    norm_hours: f ? Number(f.norm_hours) : null,
    confidence: Math.min(1, (equipment ? 0.4 + score * 0.06 : 0.1) + (fault ? 0.25 : 0)),
  }
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))

export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
