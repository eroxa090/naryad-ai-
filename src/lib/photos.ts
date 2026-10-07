import exifr from 'exifr'
import imageCompression from 'browser-image-compression'
import type { PhotoKind } from '../../shared/types'
import { supabase } from './supabase'
export async function uploadPhotos(files: File[], orderId: number, kind: PhotoKind, authorId: number) {
  if (files.length > 5) throw new Error('Можно добавить не больше 5 фото')
  for (const file of files) {
    const exif = await exifr.parse(file, ['DateTimeOriginal']).catch(() => null)
    const date = exif?.DateTimeOriginal
    const taken_at = date instanceof Date && !isNaN(date.getTime()) ? date.toISOString() : null
    const photo = await imageCompression(file, { maxWidthOrHeight: 1000, maxSizeMB: 0.7, fileType: 'image/jpeg', useWebWorker: true })
    const storage_path = `orders/${orderId}/${kind}-${crypto.randomUUID()}.jpg`
    const uploaded = await supabase.storage.from('photos').upload(storage_path, photo, { contentType: 'image/jpeg' })
    if (uploaded.error) throw uploaded.error
    const { error } = await supabase.from('order_photos').insert({ order_id: orderId, kind, storage_path, taken_at, author_id: authorId })
    if (error) { await supabase.storage.from('photos').remove([storage_path]); throw error }
  }
}
