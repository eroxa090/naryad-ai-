import { createClient } from '@supabase/supabase-js'

// Серверный клиент с service_role: обходит RLS. Только для api/**, никогда во фронт.
export const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
