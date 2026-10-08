import sharp from 'sharp'
import { admin } from '../../_lib/supabase.js'

export async function downloadPhoto(path: string): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from('photos').download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

// dHash 64 бита: устойчив к пересжатию и смене размера — ловит повторно загруженное старое фото.
export async function photoHash(img: Buffer): Promise<string> {
  const px = await sharp(img).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0'
  return BigInt('0b' + bits).toString(16).padStart(16, '0')
}

export function hashDistance(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

// Расстояние Хэмминга dHash: повторно загруженное (пересжатое) фото даёт 0–2, честные «до/после»
// одного узла с того же ракурса — около 10+. Порог 3 ловит подмену и не наказывает честных рабочих.
export const SAME_PHOTO = 3

// Уменьшенная копия для LLM: дешевле по токенам.
export const forLlm = (img: Buffer) =>
  sharp(img).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
