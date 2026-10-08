// Общие типы НарядAI: используются фронтендом и API.
// Файл без импортов: его используют и фронт (src/), и сервер (api/).

export const ORDER_STATUSES = [
  'issued', 'accepted', 'queued', 'in_progress', 'paused',
  'rejected', 'submitted', 'needs_rework', 'closed', 'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  issued: 'Выдан',
  accepted: 'Принят',
  queued: 'В очереди',
  in_progress: 'В работе',
  paused: 'Приостановлен',
  rejected: 'Отклонён',
  submitted: 'Исполнен',
  needs_rework: 'На доработке',
  closed: 'Закрыт',
  cancelled: 'Отменён',
}

export type OrderType = 'planned' | 'emergency'
export type Priority = 'emergency' | 'high' | 'normal' | 'planned'
export const PRIORITY_LABEL: Record<Priority, string> = {
  emergency: 'Аварийный — срочно',
  high: 'Высокий',
  normal: 'Обычный',
  planned: 'Плановый',
}
export type Role = 'master' | 'worker' | 'manager' | 'admin'
export type PhotoKind = 'before' | 'after'
export type AiVerdict = 'accepted' | 'accepted_with_notes' | 'needs_rework'
export type FaultCategory = 'М' | 'Э' | 'Г' | 'П' | 'С'
export type EmployeeLiveStatus = 'free' | 'busy' | 'has_queue' | 'off_shift'

export type OrderAction =
  | 'accept' | 'queue' | 'reject' | 'start' | 'pause' | 'resume'
  | 'submit' | 'rework' | 'close' | 'cancel' | 'reassign' | 'set_priority'

// ---------- Таблицы ----------
export interface Site { id: number; name: string }

export interface Equipment {
  id: number
  name: string
  inv_number: string
  site_id: number
  type: string
  criticality: 1 | 2 | 3
  qr_code: string
}

export interface Employee {
  id: number
  auth_user_id: string | null
  full_name: string
  login: string
  specialty: string
  grade: number
  brigade: string | null
  role: Role
  shift: 'day' | 'night'
  on_shift: boolean
  telegram_chat_id: number | null
}

export interface FaultCode {
  code: string
  category: FaultCategory
  name: string
  norm_hours: number
}

export interface Material { id: number; name: string; unit: string; typical_qty: number }

export interface Order {
  id: number
  number: number
  type: OrderType
  description: string
  site_id: number
  equipment_id: number
  assignee_id: number | null
  master_id: number
  priority: Priority
  deadline: string
  status: OrderStatus
  is_overdue: boolean
  fault_code: string | null
  work_done: string | null
  comment: string | null
  created_at: string
  accepted_at: string | null
  started_at: string | null
  submitted_at: string | null
  closed_at: string | null
  assigned_at: string | null
}

export interface OrderEvent {
  id: number
  order_id: number
  actor_id: number | null
  action: OrderAction | 'create' | 'overdue' | 'escalate' | 'ai_review'
  from_status: OrderStatus | null
  to_status: OrderStatus | null
  comment: string | null
  reason: string | null
  created_at: string
}

export interface OrderPhoto {
  id: number
  order_id: number
  kind: PhotoKind
  storage_path: string
  taken_at: string | null
  phash: string | null
  author_id: number | null
  created_at: string
}

export interface OrderMaterial { id: number; order_id: number; material_id: number; qty: number }

export interface AiReview {
  id: number
  order_id: number
  verdict: AiVerdict
  score: number
  photo_score: number | null
  explanation: string
  worker_feedback: string
  checks: AiCheck[]
  needs_master_review: boolean
  master_score: number | null
  master_comment: string | null
  model: string
  created_at: string
}

export interface AiCheck {
  name: 'completeness' | 'work_matches_problem' | 'materials' | 'time' | 'photo' | 'photo_fraud'
  ok: boolean
  note: string
}

export interface AiInsight {
  id: number
  kind: 'top_equipment' | 'repeat_fault' | 'after_ppr' | 'shift_pattern' | 'worker_pattern' | 'materials_anomaly' | 'equipment_risk' | 'weekly_summary'
  title: string
  text: string
  recommendation: string | null
  data: Record<string, unknown>
  period_from: string | null
  period_to: string | null
  created_at: string
}

export interface Notification {
  id: number
  employee_id: number
  order_id: number | null
  kind: 'new_order' | 'reminder' | 'overdue' | 'escalation' | 'rework' | 'review' | 'info'
  text: string
  created_at: string
  read_at: string | null
}

// ---------- Views ----------
export interface EmployeeStatusRow {
  employee_id: number
  status: EmployeeLiveStatus
  current_order_id: number | null
  queue_count: number
}

export interface WorkerRatingRow {
  employee_id: number
  closed_count: number
  quality: number        // 0..100
  on_time_rate: number   // 0..100
  rework_rate: number    // 0..100 (чем меньше, тем лучше)
  complexity: number     // 0..100
  unjustified_rejects: number
  rating: number         // 0..100
}

// ---------- RPC ----------
export interface SubmitPayload {
  work_done: string
  fault_code: string
  comment?: string
  materials: { material_id: number; qty: number }[]
}
export interface ChangeStatusArgs {
  p_order_id: number
  p_action: OrderAction
  p_payload?: Record<string, unknown> // reason, comment, assignee_id, priority, SubmitPayload…
}

// ---------- API ИИ ----------
export interface TranscribeReq { audio_base64: string; mime: string }
export interface TranscribeRes { text: string }

export interface ParseOrderReq { text: string }
export interface ParseOrderRes {
  description: string
  type: OrderType
  priority: Priority
  site_id: number | null
  equipment_id: number | null
  fault_code: string | null
  norm_hours: number | null
  confidence: number // 0..1
}

export interface SuggestWorkerReq { equipment_id: number; fault_code?: string | null }
export interface SuggestWorkerRes { candidates: { employee_id: number; score: number; reason: string }[] }

export interface CheckOrderReq { order_id: number }
export type CheckOrderRes = AiReview

export interface ShiftReportReq { from: string; to: string; site_id?: number }
export interface ShiftReportRes {
  stats: { issued: number; closed: number; overdue: number; rejected: number; downtime_hours: number }
  summary: string
}

export interface AssistantReq { question: string }
export interface AssistantRes { answer: string }
