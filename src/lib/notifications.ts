import { useQuery } from '@tanstack/react-query'
import type { Employee } from '../../shared/types'
import { queryClient, supabase } from './supabase'

// RLS (read_own) отдаёт только уведомления текущего сотрудника.
export function useUnreadCount(me: Employee) {
  return useQuery({
    queryKey: ['notifications', 'unread', me.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('employee_id', me.id)
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

export async function markRead(me: Employee, id?: number) {
  let query = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('employee_id', me.id)
    .is('read_at', null)
  if (id) query = query.eq('id', id)
  const { error } = await query
  if (error) throw error
  await queryClient.invalidateQueries({ queryKey: ['notifications'] })
}
