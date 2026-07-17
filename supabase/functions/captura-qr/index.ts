// Origem: recuperado da versão implantada no projeto Supabase da Enemeop
// (gftnjvdvzgjkhwxnxnwl, slug captura-qr, v16) em 2026-07-10.
// Nunca esteve versionado em nenhum repositório Git antes desta migração.
// Sem alteração de lógica — já usava exclusivamente service_role, sem
// nenhum valor hardcoded.

import { createClient } from 'jsr:@supabase/supabase-js@2';
Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const event = body.event || body.type || '';
    const base64 = body.data?.qrcode?.base64 || body.qrcode?.base64 || body.base64 || '';
    console.log('evento:', event, '| base64 len:', base64.length, '| keys:', Object.keys(body).join(','));
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    await supabase.from('qr_temp').insert({ nome: event || 'sem-evento', base64: base64 || JSON.stringify(body).substring(0, 500) });
    if (event === 'QRCODE_UPDATED' || event === 'qrcode.updated' || base64.length > 100) {
      console.log('QR CAPTURADO! tamanho:', base64.length);
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
