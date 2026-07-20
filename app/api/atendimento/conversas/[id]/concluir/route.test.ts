// Confirma a correção do bug P0: concluir uma conversa precisa devolver
// modo_atendimento='flora' e limpar atendente_id/assumido_em, senão a
// conversa fica presa em modo humano para sempre (Flora nunca mais
// responde). route.ts importa 'next/headers' (cookies()), que só funciona
// dentro do runtime de requisição do Next.js — por isso a verificação aqui
// é sobre o código-fonte real do arquivo, mesmo padrão usado em
// app/(dashboard)/dashboard/crm-auth.test.ts.
// Rodar: npx tsx --test "app/api/atendimento/conversas/[id]/concluir/route.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(join(DIR, 'route.ts'), 'utf-8');

test('exige autenticação: retorna 401 sem usuário', () => {
  assert.match(fonte, /if\s*\(!user\)\s*return NextResponse\.json\(\{[^}]*\},\s*\{\s*status:\s*401\s*\}\)/);
});

test('exige atendente responsável: filtro atômico .eq(\'atendente_id\', user.id) na mesma query do update', () => {
  assert.match(fonte, /\.update\(\{[^}]*\}[^)]*\)\s*\n?\s*\.eq\('id', params\.id\)\.eq\('atendente_id', user\.id\)/);
});

test('libera modo_atendimento para \'flora\' ao concluir', () => {
  assert.match(fonte, /modo_atendimento:\s*'flora'/);
});

test('limpa atendente_id e assumido_em ao concluir', () => {
  assert.match(fonte, /atendente_id:\s*null/);
  assert.match(fonte, /assumido_em:\s*null/);
});

test('marca status_atendimento como concluida na conversa', () => {
  assert.match(fonte, /status_atendimento:\s*'concluida'/);
});

test('conclui o ticket correspondente em atendimentos_humanos (status + concluido_em)', () => {
  assert.match(fonte, /from\('atendimentos_humanos'\)/);
  assert.match(fonte, /status:\s*'concluido'/);
  assert.match(fonte, /concluido_em:/);
});

test('erro/ausência de linha no update de conversas retorna 403 sem revelar detalhes internos', () => {
  assert.match(fonte, /if\s*\(error \|\| !data\)\s*return NextResponse\.json\(\{[^}]*\},\s*\{\s*status:\s*403\s*\}\)/);
});
