import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { cleanEnv } from '@/lib/env';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const loginUrl = new URL('/login', request.url);

  const supabase = createServerClient(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try { cookieStore.set(name, value, options); } catch { /* ignorado */ }
          });
        },
      },
    }
  );

  await supabase.auth.signOut();

  return NextResponse.redirect(loginUrl, { status: 302 });
}
