import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_client) {
    const url = Deno.env.get('SUPABASE_URL');
    // Tenta chave legada primeiro; fallback para o JSON do novo formato
    let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) {
      const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
      if (secretKeys) {
        try {
          const parsed = JSON.parse(secretKeys) as Record<string, string>;
          key = parsed['service_role'] ?? Object.values(parsed)[0];
        } catch { /* ignora */ }
      }
    }
    if (!url || !key) throw new Error('SUPABASE_URL ou service key não configuradas');
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}
