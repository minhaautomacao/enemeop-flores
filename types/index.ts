export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          nome: string | null;
          cargo: string | null;
          criado_em: string;
          atualizado_em: string;
        };
        Insert: {
          id: string;
          email: string;
          nome?: string | null;
          cargo?: string | null;
        };
        Update: {
          nome?: string | null;
          cargo?: string | null;
        };
        Relationships: never[];
      };
      pedidos: {
        Row: {
          id: string;
          cliente_nome: string;
          cliente_telefone: string;
          produto: string;
          produtos: Json | null;
          valor: number;
          // `status` = status de PAGAMENTO para pedidos reais criados pela Flora
          // (aguardando_pagamento/pago/pagamento_recusado/reembolsado, ver
          // supabase/migrations/202607180001_mercadopago_pagamento.sql) — os
          // demais valores (novo/confirmado/preparando/saiu/entregue/cancelado/
          // pendente/em_preparo/saiu_para_entrega) são do fluxo manual antigo
          // (criação via "+ Novo pedido", sem integração de pagamento real).
          // NUNCA alterar manualmente um status de pagamento pela tela — só o
          // webhook real do Mercado Pago confirma isso.
          status: 'novo' | 'pendente' | 'confirmado' | 'preparando' | 'em_preparo' | 'saiu' | 'saiu_para_entrega' | 'entregue' | 'cancelado' | 'aguardando_pagamento' | 'pago' | 'pagamento_recusado' | 'reembolsado';
          // Workflow de produção/cozinha — independente do status de pagamento.
          status_producao: 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu' | 'entregue';
          // Workflow de logística real (Lalamove) — null até o pedido ser pago.
          // 'cancelamento_solicitado'/'cancelada'/'cancelamento_negado' fazem
          // parte do cancelamento de logística (ver
          // supabase/migrations/202608060001_logistica_cancelamento.sql).
          status_logistica: 'pendente' | 'criada' | 'erro_logistica' | 'revisao_logistica' | 'agendada' | 'cancelamento_solicitado' | 'cancelada' | 'cancelamento_negado' | null;
          horario_entrega: string | null;
          bairro: string | null;
          canal: string;
          canal_origem: string | null;
          obs: string | null;
          pago_em: string | null;
          numero_pedido: number | null;
          // Identificador real do pagamento aprovado no Mercado Pago — usado
          // pra localizar o pagamento certo ao solicitar um estorno (ver
          // supabase/functions/pagamento-estornar).
          mp_payment_id: string | null;
          // Cache denormalizado do último evento de estorno — fonte de
          // verdade real é pedidos_estorno_eventos (ver
          // supabase/migrations/202608060002_cancelamento_pedido_estorno.sql).
          estorno_status: 'pendente_autorizacao' | 'processando' | 'concluido' | 'pendente_mp' | 'recusado' | 'erro' | null;
          cancelado_em: string | null;
          cancelado_motivo: string | null;
          cancelado_por: 'cliente_flora' | 'admin_painel' | 'sistema_mp' | null;
          criado_em: string;
          atualizado_em: string;
        };
        Insert: {
          cliente_nome: string;
          cliente_telefone: string;
          produto: string;
          valor?: number;
          status?: 'novo' | 'pendente' | 'confirmado' | 'preparando' | 'em_preparo' | 'saiu' | 'saiu_para_entrega' | 'entregue' | 'cancelado' | 'aguardando_pagamento' | 'pago' | 'pagamento_recusado' | 'reembolsado';
          horario_entrega?: string | null;
          bairro?: string | null;
          canal?: string;
          obs?: string | null;
        };
        Update: {
          cliente_nome?: string;
          cliente_telefone?: string;
          produto?: string;
          valor?: number;
          status?: 'novo' | 'pendente' | 'confirmado' | 'preparando' | 'em_preparo' | 'saiu' | 'saiu_para_entrega' | 'entregue' | 'cancelado' | 'aguardando_pagamento' | 'pago' | 'pagamento_recusado' | 'reembolsado';
          status_producao?: 'novo' | 'confirmado' | 'preparando' | 'pronto' | 'saiu' | 'entregue';
          horario_entrega?: string | null;
          bairro?: string | null;
          canal?: string;
          obs?: string | null;
        };
        Relationships: never[];
      };
      leads: {
        Row: {
          id: string;
          nome: string | null;
          telefone: string;
          canal: string;
          intencao: 'urgente' | 'pesquisando' | 'recorrente' | 'corporativo' | null;
          ultimo_contato: string;
          total_pedidos: number;
          ltv: number;
          criado_em: string;
        };
        Insert: {
          nome?: string | null;
          telefone: string;
          canal?: string;
          intencao?: 'urgente' | 'pesquisando' | 'recorrente' | 'corporativo' | null;
          ultimo_contato?: string;
          total_pedidos?: number;
          ltv?: number;
        };
        Update: {
          nome?: string | null;
          telefone?: string;
          canal?: string;
          intencao?: 'urgente' | 'pesquisando' | 'recorrente' | 'corporativo' | null;
          ultimo_contato?: string;
          total_pedidos?: number;
          ltv?: number;
        };
        Relationships: never[];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<string, never>;
  };
};

export type Profile      = Database['public']['Tables']['profiles']['Row'];
export type Pedido       = Database['public']['Tables']['pedidos']['Row'];
export type Lead         = Database['public']['Tables']['leads']['Row'];
export type StatusPedido = Pedido['status'];
export type Intencao     = NonNullable<Lead['intencao']>;
