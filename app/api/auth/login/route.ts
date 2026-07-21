import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email    = formData.get('email') as string;
  const password = formData.get('password') as string;

  const successResponse = NextResponse.redirect(new URL('/dashboard', request.url));
  const errorResponse   = NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent('E-mail ou senha incorretos')}`, request.url)
  );

  if (!email || !password) return errorResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            successResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return errorResponse;

  return successResponse;
}
