import type { Order } from '../../shared/types.js'
import { admin } from './supabase.js'

export interface OrderFull extends Order {
  equipment: { name: string } | null
  site: { name: string } | null
  assignee: { id: number; full_name: string; specialty: string } | null
}

export async function getOrderFull(orderId: number): Promise<OrderFull | null> {
  const { data } = await admin
    .from('orders')
    .select('*, equipment:equipment_id(name), site:site_id(name), assignee:assignee_id(id, full_name, specialty)')
    .eq('id', orderId)
    .single()
  return (data as OrderFull) ?? null
}

export async function lastComment(orderId: number): Promise<string | null> {
  const { data } = await admin
    .from('order_events')
    .select('comment, reason')
    .eq('order_id', orderId)
    .not('action', 'in', '(overdue,escalate,master_override,ai_review,create)')
    .or('comment.not.is.null,reason.not.is.null')
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0]?.comment ?? data?.[0]?.reason ?? null
}

export function minutesText(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`
}

export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })

export const appLink = (orderId: number) => (process.env.APP_URL ? `${process.env.APP_URL}/orders/${orderId}` : null)
