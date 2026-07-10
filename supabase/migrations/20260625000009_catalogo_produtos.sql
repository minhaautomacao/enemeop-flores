-- Tabela de produtos com fotos
CREATE TABLE IF NOT EXISTS catalogo_produtos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  preco       NUMERIC(10,2) NOT NULL,
  categoria   TEXT NOT NULL,
  foto_url    TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_codigo ON catalogo_produtos(codigo);
CREATE INDEX IF NOT EXISTS idx_catalogo_ativo  ON catalogo_produtos(ativo);

-- Bucket público para fotos dos produtos
INSERT INTO storage.buckets (id, name, public)
VALUES ('produtos', 'produtos', true)
ON CONFLICT (id) DO NOTHING;

-- Política de leitura pública
CREATE POLICY IF NOT EXISTS "fotos publicas" ON storage.objects
  FOR SELECT USING (bucket_id = 'produtos');
