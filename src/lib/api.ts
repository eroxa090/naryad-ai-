import type { TranscribeReq, TranscribeRes, ParseOrderReq, ParseOrderRes, SuggestWorkerReq, SuggestWorkerRes, CheckOrderReq, CheckOrderRes, ShiftReportReq, ShiftReportRes, AssistantReq, AssistantRes, Employee, EmployeeStatusRow, Order } from '../../shared/types'
import { rows, supabase } from './supabase'

declare const __AI_MOCK__: boolean
export const aiMock = typeof __AI_MOCK__ !== 'undefined' && __AI_MOCK__
async function post<T>(path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Войдите в приложение')
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Сервис недоступен (${response.status}). Повторите позже.`)
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('ИИ-сервис ещё не развёрнут')
  return response.json()
}
export const api = {
  transcribe: (body: TranscribeReq): Promise<TranscribeRes> => aiMock ? Promise.resolve({ text: 'Проверить подшипник конвейера, устранить вибрацию.' }) : post('/api/ai/transcribe', body),
  parseOrder: (body: ParseOrderReq): Promise<ParseOrderRes> => aiMock ? Promise.resolve({ description: body.text, type: 'planned', priority: 'normal', site_id: null, equipment_id: null, fault_code: null, norm_hours: 2, confidence: 0 }) : post('/api/ai/parse-order', body),
  suggestWorker: async (body: SuggestWorkerReq): Promise<SuggestWorkerRes> => {
    if (!aiMock) return post('/api/ai/suggest-worker', body)
    const [employees, statuses] = await Promise.all([rows<Employee>('employees'), rows<EmployeeStatusRow>('v_employee_status')])
    return { candidates: employees.filter(e => e.role === 'worker' && e.on_shift).map(e => ({ employee_id: e.id, score: statuses.find(s => s.employee_id === e.id)?.status === 'free' ? 95 : 60, reason: 'Демо-подсказка по доступности. Специальность и допуск проверьте вручную.' })).sort((a,b) => b.score-a.score) }
  },
  checkOrder: async (body: CheckOrderReq): Promise<CheckOrderRes> => {
    if (!aiMock) return post('/api/ai/check-order', body)
    return { id: -body.order_id, order_id: body.order_id, verdict: 'accepted_with_notes', score: 4, photo_score: null, explanation: 'Демонстрационная оценка: реальный анализ работ и фото не выполнялся. Требуется проверка мастером.', worker_feedback: 'Демо: опишите результат и приложите чёткие фотографии. Фактическая оценка появится после подключения ИИ.', checks: [], needs_master_review: true, master_score: null, master_comment: null, model: 'frontend-mock', created_at: new Date().toISOString() }
  },
  shiftReport: async (body: ShiftReportReq): Promise<ShiftReportRes> => {
    if (!aiMock) return post('/api/ai/shift-report', body)
    const orders = (await rows<Order>('orders')).filter(o => (!body.site_id || o.site_id === body.site_id) && o.created_at >= body.from && o.created_at <= body.to)
    return { stats: { issued: orders.length, closed: orders.filter(o=>o.status==='closed').length, overdue: orders.filter(o=>o.is_overdue).length, rejected: orders.filter(o=>o.status==='rejected').length, downtime_hours: 0 }, summary: 'Демо-сводка: счётчики по нарядам, созданным в выбранный период. Простой и текстовый анализ требуют серверного ИИ.' }
  },
  assistant: (body: AssistantReq): Promise<AssistantRes> => aiMock ? Promise.resolve({ answer: 'Демо-режим. Для проверки текущей ситуации откройте панель смены и фильтр просроченных нарядов. Ответы на произвольные вопросы появятся после подключения ИИ.' }) : post('/api/ai/assistant', body),
  notifyNew: (order_id: number) => post('/api/orders/notify-new', { order_id }),
}
