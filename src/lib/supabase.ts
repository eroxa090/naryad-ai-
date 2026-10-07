import { createClient } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'

export const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://unconfigured.supabase.co', import.meta.env.VITE_SUPABASE_ANON_KEY || 'unconfigured')
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } })
export async function rows<T>(table: string): Promise<T[]> {
  const result: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + 999)
    if (error) throw error
    result.push(...data as T[])
    if (data.length < 1000) return result
  }
}
export function message(error: unknown) { return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Не удалось выполнить действие' }
