import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types';

const cleanEnv = (v: string | undefined) => v?.replace(/^﻿/, '').trim() ?? '';

export function createClient() {
  return createBrowserClient<Database>(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );
}
