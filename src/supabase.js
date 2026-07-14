import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zpirnmzenrgsfqlbqets.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwaXJubXplbnJnc2ZxbGJxZXRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODE2ODcsImV4cCI6MjA5OTU1NzY4N30._9SrzWVr_mqGcVHfb5Mu_uC-1wKoMZl9WzTYeKZ66Io'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
