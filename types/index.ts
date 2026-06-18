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
          valor: number;
          status: 'novo' | 'confirmado' | 'preparando' | 'saiu' | 'entregue' | 'cancelado';
          horario_entrega: string | null;
          bairro: string | null;
          canal: string;
          obs: string | null;
          criado_em: string;
          atualizado_em: string;
        };
        Insert: {
          cliente_nome: string;
          cliente_telefone: string;
          produto: string;
          valor?: number;
          status?: 'novo' | 'confirmado' | 'preparando' | 'saiu' | 'entregue' | 'cancelado';
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
          status?: 'novo' | 'confirmado' | 'preparando' | 'saiu' | 'entregue' | 'cancelado';
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
