import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zpirnmzenrgsfqlbqets.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_T6xgx2PUecdStGCanJtQHQ_Rn0_O7S7'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
