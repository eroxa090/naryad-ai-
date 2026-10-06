import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Employee } from '../../shared/types.js'
import { admin } from './supabase.js'

// Проверяет Bearer-токен Supabase и возвращает сотрудника. При ошибке сам отвечает 401 и возвращает null.
export async function requireEmployee(req: VercelRequest, res: VercelResponse): Promise<Employee | null> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) {
    res.status(401).json({ error: 'Нет токена' })
    return null
  }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) {
    res.status(401).json({ error: 'Недействительный токен' })
    return null
  }
  const { data: emp } = await admin.from('employees').select('*').eq('auth_user_id', data.user.id).single()
  if (!emp) {
    res.status(403).json({ error: 'Сотрудник не найден' })
    return null
  }
  return emp as Employee
}

export function requireCronSecret(req: VercelRequest, res: VercelResponse): boolean {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Bad cron secret' })
    return false
  }
  return true
}

export function onlyPost(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' })
    return false
  }
  return true
}
