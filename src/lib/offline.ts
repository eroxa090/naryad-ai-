import Dexie, { type EntityTable } from 'dexie'
import type { ChangeStatusArgs } from '../../shared/types'
import { supabase, queryClient, message } from './supabase'
export interface PendingAction { id?: number; userId: string; args: ChangeStatusArgs; created: number; error?: string }
export const offline = new Dexie('naryad-actions') as Dexie & { actions: EntityTable<PendingAction, 'id'> }
offline.version(1).stores({ actions: '++id, userId, created' })
let flushing = false
export async function flushActions() {
  if (flushing || !navigator.onLine) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  flushing = true
  try {
    const pending = await offline.actions.where('userId').equals(session.user.id).sortBy('created')
    for (const item of pending) {
      if (item.error) break
      const { error } = await supabase.rpc('change_order_status', item.args)
      if (error) { if (navigator.onLine) await offline.actions.update(item.id!, { error: message(error) }); break }
      await offline.actions.delete(item.id!)
    }
    await queryClient.invalidateQueries()
  } finally { flushing = false; window.dispatchEvent(new Event('queue-change')) }
}
export async function changeStatus(args: ChangeStatusArgs) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Войдите в приложение')
  if (!navigator.onLine) {
    await offline.actions.add({ userId: session.user.id, args, created: Date.now() })
    window.dispatchEvent(new Event('queue-change'))
    return 'Действие сохранено в очередь. Статус изменится после синхронизации.'
  }
  const { error } = await supabase.rpc('change_order_status', args)
  if (error) throw error
  await queryClient.invalidateQueries()
  return 'Готово'
}

