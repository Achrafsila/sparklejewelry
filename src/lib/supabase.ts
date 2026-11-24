import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies (voir docs/mise-en-service.md).');
}

/** The single Supabase client: reads go through RLS-protected views, writes through RPC functions. */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sparkle-auth',
  },
});

export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;
