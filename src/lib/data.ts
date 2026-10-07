import { useQuery } from '@tanstack/react-query'
import type { Employee, EmployeeStatusRow, Equipment, FaultCode, Material, Order, Site, WorkerRatingRow } from '../../shared/types'
import { rows } from './supabase'
export function useData() {
  return useQuery({ queryKey: ['data'], queryFn: async () => {
    const [employees, statuses, equipment, faults, materials, orders, sites, ratings] = await Promise.all([
      rows<Employee>('employees'), rows<EmployeeStatusRow>('v_employee_status'), rows<Equipment>('equipment'), rows<FaultCode>('fault_codes'), rows<Material>('materials'), rows<Order>('orders'), rows<Site>('sites'), rows<WorkerRatingRow>('v_worker_rating'),
    ])
    return { employees, statuses, equipment, faults, materials, orders: orders.sort((a,b)=>b.id-a.id), sites, ratings }
  } })
}
export type AppData = NonNullable<ReturnType<typeof useData>['data']>
export const liveLabels = { free: 'Свободен', busy: 'В работе', has_queue: 'Очередь', off_shift: 'Не на смене' }
export const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'
