import { useQuery } from '@tanstack/react-query'
import type {
  Employee,
  EmployeeStatusRow,
  Equipment,
  FaultCode,
  Material,
  Order,
  Site,
  WorkerRatingRow,
} from '../../shared/types'
import { rows, supabase } from './supabase'
import { cached } from './offline'
export function useData() {
  return useQuery({
    queryKey: ['data'],
    networkMode: 'always',
    queryFn: () =>
      cached('data:active-30d', async () => {
        const [
          employees,
          statuses,
          equipment,
          faults,
          materials,
          orders,
          sites,
          ratings,
        ] = await Promise.all([
          rows<Employee>('employees'),
          rows<EmployeeStatusRow>('v_employee_status'),
          rows<Equipment>('equipment'),
          rows<FaultCode>('fault_codes'),
          rows<Material>('materials'),
          loadOrders(false),
          rows<Site>('sites'),
          rows<WorkerRatingRow>('v_worker_rating'),
        ])
        return {
          employees,
          statuses,
          equipment,
          faults,
          materials,
          orders: orders.sort((a, b) => b.id - a.id),
          sites,
          ratings,
        }
      }),
  })
}
export type AppData = NonNullable<ReturnType<typeof useData>['data']>
export const liveLabels = {
  free: 'Свободен',
  busy: 'В работе',
  has_queue: 'Очередь',
  off_shift: 'Не на смене',
}
export const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

// Filter on the server before pagination; old active orders remain visible.
export async function loadOrders(all: boolean): Promise<Order[]> {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const result: Order[] = []
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from('orders').select('*').order('id', { ascending: false })
    if (!all) query = query.or(`status.not.in.(closed,cancelled),and(status.eq.closed,closed_at.gte.${cutoff})`)
    const { data, error } = await query.range(offset, offset + 999)
    if (error) throw error
    result.push(...data as Order[])
    if (data.length < 1000) return result
  }
}
