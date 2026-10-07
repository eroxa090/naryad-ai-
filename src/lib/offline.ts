import Dexie, { type EntityTable } from 'dexie'
import type { ChangeStatusArgs } from '../../shared/types'
import { supabase, queryClient, message } from './supabase'
import { uploadPhotos } from './photos'
import { api } from './api'
export interface PendingAction {
  id?: number
  userId: string
  args: ChangeStatusArgs
  created: number
  error?: string
  photos?: File[]
  authorId?: number
  uploaded?: number
  applied?: boolean
}
interface Snapshot {
  key: string
  value: unknown
}
export const offline = new Dexie('naryad-actions') as Dexie & {
  actions: EntityTable<PendingAction, 'id'>
  snapshots: EntityTable<Snapshot, 'key'>
}
offline.version(1).stores({ actions: '++id, userId, created' })
offline
  .version(2)
  .stores({ actions: '++id, userId, created', snapshots: '&key' })
export async function cached<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Войдите в приложение')
  const scoped = `${session.user.id}:${key}`
  if (!navigator.onLine) {
    const snapshot = await offline.snapshots.get(scoped)
    if (snapshot) return snapshot.value as T
    throw new Error('Нет сети. Эти данные ещё не загружались на устройство.')
  }
  const value = await load()
  await offline.snapshots.put({ key: scoped, value })
  return value
}
let flushing = false
export async function flushActions() {
  if (flushing || !navigator.onLine) return
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return
  flushing = true
  try {
    const pending = await offline.actions
      .where('userId')
      .equals(session.user.id)
      .sortBy('created')
    for (const item of pending) {
      if (item.error) break
      // A different user may sign in while the queue is being sent.
      const current = await supabase.auth.getSession()
      if (current.data.session?.user.id !== item.userId) break
      try {
        if (!item.applied) {
          for (
            let i = item.uploaded || 0;
            i < (item.photos?.length || 0);
            i++
          ) {
            await uploadPhotos(
              [item.photos![i]],
              item.args.p_order_id,
              'after',
              item.authorId!,
            )
            await offline.actions.update(item.id!, { uploaded: i + 1 })
          }
          const { error } = await supabase.rpc('change_order_status', item.args)
          if (error) throw error
          await offline.actions.update(item.id!, { applied: true })
        }
        // Отчёт уже принят сервером: сбой ИИ-проверки не должен блокировать очередь.
        // Мастер может повторить проверку кнопкой «Проверить ИИ».
        if (item.args.p_action === 'submit')
          await api.checkOrder({ order_id: item.args.p_order_id }).catch(() => null)
        await offline.actions.delete(item.id!)
      } catch (error) {
        if (navigator.onLine)
          await offline.actions.update(item.id!, { error: message(error) })
        break
      }
    }
    await queryClient.invalidateQueries()
  } finally {
    flushing = false
    window.dispatchEvent(new Event('queue-change'))
  }
}
export async function queueAction(
  args: ChangeStatusArgs,
  photos?: File[],
  authorId?: number,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Войдите в приложение')
  const pending = await offline.actions
    .where('userId')
    .equals(session.user.id)
    .toArray()
  if (
    pending.some(
      (item) =>
        item.args.p_order_id === args.p_order_id &&
        item.args.p_action === args.p_action,
    )
  ) {
    return 'Это действие уже ожидает отправки. Проверьте очередь синхронизации.'
  }
  await offline.actions.add({
    userId: session.user.id,
    args,
    created: Date.now(),
    photos,
    authorId,
  })
  window.dispatchEvent(new Event('queue-change'))
  return 'Действие сохранено в очередь. Статус изменится после синхронизации.'
}
export async function changeStatus(args: ChangeStatusArgs) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Войдите в приложение')
  if (
    !navigator.onLine ||
    (await offline.actions.where('userId').equals(session.user.id).count())
  ) {
    const notice = await queueAction(args)
    if (navigator.onLine) void flushActions()
    return notice
  }
  const { error } = await supabase.rpc('change_order_status', args)
  if (error) throw error
  await queryClient.invalidateQueries()
  return 'Готово'
}
