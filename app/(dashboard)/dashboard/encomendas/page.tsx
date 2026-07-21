'use client';

import { useState } from 'react';
import { CalendarPlus, X, Bell, Clock, MapPin, Phone, User, Flower2, ChevronLeft, ChevronRight } from 'lucide-react';

type Encomenda = {
  id: string;
  dataEntrega: string;
  horaEntrega: string;
  tipoArranjo: string;
  tipoFlor: string;
  cor: string;
  remetente: string;
  mensagemCard: string;
  clienteNome: string;
  clienteTelefone: string;
  enderecoEntrega: string;
  bairro: string;
  observacoes: string;
};

const TIPOS_ARRANJO = ['Buquê', 'Vaso', 'Arranjo Corporativo', 'Kit Maternidade', 'Coroa', 'Centro de Mesa', 'Avulso'];
const TIPOS_FLOR = ['Rosas', 'Girassóis', 'Orquídeas', 'Lírios', 'Gérberas', 'Tulipas', 'Flores do Campo', 'Misto'];
const CORES = ['Vermelho', 'Rosa', 'Branco', 'Amarelo', 'Roxo', 'Laranja', 'Misto', 'Outra'];

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const ENCOMENDAS_MOCK: Encomenda[] = [
  {
    id: 'enc-001',
    dataEntrega: '2026-06-15',
    horaEntrega: '14:00',
    tipoArranjo: 'Buquê',
    tipoFlor: 'Rosas',
    cor: 'Vermelho',
    remetente: 'Carlos Silva',
    mensagemCard: 'Com muito amor!',
    clienteNome: 'Maria Souza',
    clienteTelefone: '11987654321',
    enderecoEntrega: 'Rua das Flores, 123',
    bairro: 'Ipiranga',
    observacoes: 'Tocar o interfone 2',
  },
  {
    id: 'enc-002',
    dataEntrega: '2026-06-15',
    horaEntrega: '16:30',
    tipoArranjo: 'Vaso',
    tipoFlor: 'Orquídeas',
    cor: 'Branco',
    remetente: 'Empresa ABC',
    mensagemCard: 'Parabéns pela conquista!',
    clienteNome: 'João Lima',
    clienteTelefone: '11912345678',
    enderecoEntrega: 'Av. Paulista, 900',
    bairro: 'Bela Vista',
    observacoes: '',
  },
  {
    id: 'enc-003',
    dataEntrega: '2026-06-20',
    horaEntrega: '10:00',
    tipoArranjo: 'Kit Maternidade',
    tipoFlor: 'Girassóis',
    cor: 'Amarelo',
    remetente: 'Ana Torres',
    mensagemCard: 'Bem-vindo ao mundo!',
    clienteNome: 'Família Mendes',
    clienteTelefone: '11998765432',
    enderecoEntrega: 'Rua Vergueiro, 500',
    bairro: 'Liberdade',
    observacoes: 'Entregar na recepção',
  },
];

const VAZIO: Omit<Encomenda, 'id'> = {
  dataEntrega: '',
  horaEntrega: '',
  tipoArranjo: '',
  tipoFlor: '',
  cor: '',
  remetente: '',
  mensagemCard: '',
  clienteNome: '',
  clienteTelefone: '',
  enderecoEntrega: '',
  bairro: '',
  observacoes: '',
};

export default function EncomendasPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [encomendas, setEncomendas] = useState<Encomenda[]>(ENCOMENDAS_MOCK);
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState<Omit<Encomenda, 'id'>>(VAZIO);
  const [detalhe, setDetalhe] = useState<Encomenda | null>(null);

  function diasDoMes() {
    const primeiro = new Date(ano, mes, 1).getDay();
    const total = new Date(ano, mes + 1, 0).getDate();
    return { primeiro, total };
  }

  function encomendasDoDia(dia: number) {
    const key = `${ano}-${String(mes + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
    return encomendas.filter(e => e.dataEntrega === key);
  }

  function mesAnterior() {
    if (mes === 0) { setMes(11); setAno(a => a - 1); } else setMes(m => m - 1);
    setDiaSelecionado(null);
  }

  function proximoMes() {
    if (mes === 11) { setMes(0); setAno(a => a + 1); } else setMes(m => m + 1);
    setDiaSelecionado(null);
  }

  function selecionarDia(dia: number) {
    const key = `${ano}-${String(mes + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
    setDiaSelecionado(key);
  }

  function abrirNovaEncomenda() {
    setForm({ ...VAZIO, dataEntrega: diaSelecionado ?? '' });
    setModalAberto(true);
  }

  function salvarEncomenda() {
    if (!form.dataEntrega || !form.horaEntrega || !form.clienteNome) return;
    const nova: Encomenda = { ...form, id: `enc-${Date.now()}` };
    setEncomendas(prev => [...prev, nova]);
    setModalAberto(false);
    setForm(VAZIO);
    agendarLembretes(nova);
  }

  function agendarLembretes(enc: Encomenda) {
    const entrega = new Date(`${enc.dataEntrega}T${enc.horaEntrega}`);
    const lembretes = [120, 60, 30, 20, 10];
    lembretes.forEach(min => {
      const diff = entrega.getTime() - min * 60_000 - Date.now();
      if (diff > 0) {
        setTimeout(() => {
          if (Notification.permission === 'granted') {
            new Notification(`🌸 Encomenda em ${min} min`, {
              body: `${enc.tipoArranjo} para ${enc.clienteNome} — ${enc.bairro} às ${enc.horaEntrega}`,
            });
          }
        }, diff);
      }
    });
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  const { primeiro, total } = diasDoMes();
  const encomendsDiaSelecionado = diaSelecionado ? encomendas.filter(e => e.dataEntrega === diaSelecionado) : [];

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">Encomendas</h1>
          <p className="text-xs text-text-faint">Agende pedidos manuais e receba lembretes automáticos</p>
        </div>
        <button onClick={abrirNovaEncomenda} className="btn-gold flex items-center gap-2">
          <CalendarPlus className="w-4 h-4" />
          Nova Encomenda
        </button>
      </header>

      <div className="p-6 flex gap-6">

        {/* Calendário */}
        <div className="card w-[420px] shrink-0 self-start">
          {/* Cabeçalho do mês */}
          <div className="flex items-center justify-between mb-4">
            <button onClick={mesAnterior} className="btn-ghost p-1.5 rounded">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold text-text-primary text-sm">
              {MESES[mes]} {ano}
            </span>
            <button onClick={proximoMes} className="btn-ghost p-1.5 rounded">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Dias da semana */}
          <div className="grid grid-cols-7 mb-2">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-text-faint uppercase py-1">{d}</div>
            ))}
          </div>

          {/* Grade de dias */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: primeiro }).map((_, i) => <div key={`v${i}`} />)}
            {Array.from({ length: total }).map((_, i) => {
              const dia = i + 1;
              const key = `${ano}-${String(mes + 1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
              const qtd = encomendasDoDia(dia).length;
              const isHoje = key === `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
              const isSelecionado = key === diaSelecionado;
              return (
                <button
                  key={dia}
                  onClick={() => selecionarDia(dia)}
                  className={`relative flex flex-col items-center justify-center rounded-lg py-2 text-sm transition-all
                    ${isSelecionado ? 'bg-gold text-bg-base font-bold' :
                      isHoje ? 'border border-gold/50 text-gold font-semibold' :
                      'hover:bg-bg-raised text-text-muted'}
                  `}
                >
                  {dia}
                  {qtd > 0 && (
                    <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${isSelecionado ? 'bg-bg-base' : 'bg-gold'}`} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Legenda */}
          <div className="mt-4 pt-4 border-t border-border flex items-center gap-3 text-xs text-text-faint">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gold inline-block" /> Tem encomenda</span>
            <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded border border-gold/50 inline-block" /> Hoje</span>
          </div>
        </div>

        {/* Encomendas do dia selecionado */}
        <div className="flex-1 min-w-0">
          {!diaSelecionado ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-border text-text-faint text-sm gap-2">
              <CalendarPlus className="w-8 h-8 opacity-30" />
              <p>Selecione um dia no calendário</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-text-primary">
                  {new Date(diaSelecionado + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h2>
                <button onClick={abrirNovaEncomenda} className="btn-ghost text-xs flex items-center gap-1 text-gold">
                  <CalendarPlus className="w-3.5 h-3.5" /> Adicionar
                </button>
              </div>

              {encomendsDiaSelecionado.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 rounded-lg border border-dashed border-border text-text-faint text-sm gap-2">
                  <p>Nenhuma encomenda neste dia</p>
                  <button onClick={abrirNovaEncomenda} className="btn-gold text-xs mt-1">+ Agendar encomenda</button>
                </div>
              ) : (
                encomendsDiaSelecionado.map(enc => (
                  <div key={enc.id} className="card hover:border-gold/30 transition-all cursor-pointer" onClick={() => setDetalhe(enc)}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/10 border border-gold/20 text-gold">
                          <Flower2 className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-semibold text-text-primary text-sm">{enc.tipoArranjo} de {enc.tipoFlor} — {enc.cor}</p>
                          <p className="text-xs text-text-muted">Para: {enc.clienteNome}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-gold text-sm font-bold">
                        <Clock className="w-3.5 h-3.5" />
                        {enc.horaEntrega}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {enc.enderecoEntrega}, {enc.bairro}</span>
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {enc.clienteTelefone}</span>
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> De: {enc.remetente}</span>
                      <span className="flex items-center gap-1"><Bell className="w-3 h-3" /> Lembretes: 2h, 1h, 30, 20, 10 min</span>
                    </div>
                    {enc.mensagemCard && (
                      <p className="mt-2 text-xs text-text-faint italic border-l-2 border-gold/30 pl-2">&quot;{enc.mensagemCard}&quot;</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Nova Encomenda */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl bg-bg-surface border border-border rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-text-primary flex items-center gap-2">
                <CalendarPlus className="w-5 h-5 text-gold" /> Nova Encomenda
              </h2>
              <button onClick={() => setModalAberto(false)} className="btn-ghost p-1.5 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">

              {/* Data e hora */}
              <div>
                <p className="text-xs font-semibold text-text-faint uppercase tracking-wide mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Entrega</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Data da entrega</label>
                    <input type="date" className="input" value={form.dataEntrega} onChange={e => setForm(f => ({...f, dataEntrega: e.target.value}))} />
                  </div>
                  <div>
                    <label className="label">Hora da entrega</label>
                    <input type="time" className="input" value={form.horaEntrega} onChange={e => setForm(f => ({...f, horaEntrega: e.target.value}))} />
                  </div>
                </div>
              </div>

              {/* Produto */}
              <div>
                <p className="text-xs font-semibold text-text-faint uppercase tracking-wide mb-2 flex items-center gap-1.5"><Flower2 className="w-3.5 h-3.5" /> Produto</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Tipo de arranjo</label>
                    <select className="input" value={form.tipoArranjo} onChange={e => setForm(f => ({...f, tipoArranjo: e.target.value}))}>
                      <option value="">Selecione</option>
                      {TIPOS_ARRANJO.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Tipo de flor</label>
                    <select className="input" value={form.tipoFlor} onChange={e => setForm(f => ({...f, tipoFlor: e.target.value}))}>
                      <option value="">Selecione</option>
                      {TIPOS_FLOR.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Cor</label>
                    <select className="input" value={form.cor} onChange={e => setForm(f => ({...f, cor: e.target.value}))}>
                      <option value="">Selecione</option>
                      {CORES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Remetente */}
              <div>
                <p className="text-xs font-semibold text-text-faint uppercase tracking-wide mb-2 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Quem envia</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nome do remetente</label>
                    <input type="text" className="input" placeholder="Ex: Carlos Silva" value={form.remetente} onChange={e => setForm(f => ({...f, remetente: e.target.value}))} />
                  </div>
                  <div>
                    <label className="label">Mensagem do cartão</label>
                    <input type="text" className="input" placeholder="Ex: Com muito amor!" value={form.mensagemCard} onChange={e => setForm(f => ({...f, mensagemCard: e.target.value}))} />
                  </div>
                </div>
              </div>

              {/* Destinatário */}
              <div>
                <p className="text-xs font-semibold text-text-faint uppercase tracking-wide mb-2 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Quem recebe</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nome do cliente</label>
                    <input type="text" className="input" placeholder="Ex: Maria Souza" value={form.clienteNome} onChange={e => setForm(f => ({...f, clienteNome: e.target.value}))} />
                  </div>
                  <div>
                    <label className="label">Telefone</label>
                    <input type="tel" className="input" placeholder="Ex: 11987654321" value={form.clienteTelefone} onChange={e => setForm(f => ({...f, clienteTelefone: e.target.value}))} />
                  </div>
                </div>
              </div>

              {/* Endereço */}
              <div>
                <p className="text-xs font-semibold text-text-faint uppercase tracking-wide mb-2 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Endereço de entrega</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Endereço</label>
                    <input type="text" className="input" placeholder="Rua, número" value={form.enderecoEntrega} onChange={e => setForm(f => ({...f, enderecoEntrega: e.target.value}))} />
                  </div>
                  <div>
                    <label className="label">Bairro</label>
                    <input type="text" className="input" placeholder="Ex: Ipiranga" value={form.bairro} onChange={e => setForm(f => ({...f, bairro: e.target.value}))} />
                  </div>
                </div>
              </div>

              {/* Observações */}
              <div>
                <label className="label">Observações</label>
                <textarea className="input min-h-[72px] resize-none" placeholder="Informações extras para a entrega..." value={form.observacoes} onChange={e => setForm(f => ({...f, observacoes: e.target.value}))} />
              </div>

              {/* Lembretes */}
              <div className="rounded-lg border border-gold/20 bg-gold/5 px-4 py-3 flex items-center gap-3">
                <Bell className="w-4 h-4 text-gold shrink-0" />
                <p className="text-xs text-text-muted">
                  Lembretes automáticos serão enviados <span className="text-gold font-medium">2h, 1h, 30, 20 e 10 minutos</span> antes da entrega.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button onClick={() => setModalAberto(false)} className="btn-ghost">Cancelar</button>
              <button
                onClick={salvarEncomenda}
                disabled={!form.dataEntrega || !form.horaEntrega || !form.clienteNome}
                className="btn-gold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Salvar Encomenda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detalhe da encomenda */}
      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetalhe(null)}>
          <div className="w-full max-w-md bg-bg-surface border border-border rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-text-primary flex items-center gap-2">
                <Flower2 className="w-5 h-5 text-gold" /> Detalhe da Encomenda
              </h2>
              <button onClick={() => setDetalhe(null)} className="btn-ghost p-1.5 rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-6 py-5 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-text-faint">Data</p><p className="font-medium text-text-primary">{new Date(detalhe.dataEntrega+'T12:00').toLocaleDateString('pt-BR')}</p></div>
                <div><p className="text-xs text-text-faint">Hora</p><p className="font-medium text-gold">{detalhe.horaEntrega}</p></div>
                <div><p className="text-xs text-text-faint">Arranjo</p><p className="font-medium text-text-primary">{detalhe.tipoArranjo}</p></div>
                <div><p className="text-xs text-text-faint">Flor / Cor</p><p className="font-medium text-text-primary">{detalhe.tipoFlor} — {detalhe.cor}</p></div>
                <div><p className="text-xs text-text-faint">De</p><p className="font-medium text-text-primary">{detalhe.remetente}</p></div>
                <div><p className="text-xs text-text-faint">Para</p><p className="font-medium text-text-primary">{detalhe.clienteNome}</p></div>
                <div><p className="text-xs text-text-faint">Telefone</p><p className="font-medium text-text-primary">{detalhe.clienteTelefone}</p></div>
                <div><p className="text-xs text-text-faint">Bairro</p><p className="font-medium text-text-primary">{detalhe.bairro}</p></div>
              </div>
              <div><p className="text-xs text-text-faint">Endereço</p><p className="font-medium text-text-primary">{detalhe.enderecoEntrega}</p></div>
              {detalhe.mensagemCard && <div><p className="text-xs text-text-faint">Cartão</p><p className="italic text-text-muted">&quot;{detalhe.mensagemCard}&quot;</p></div>}
              {detalhe.observacoes && <div><p className="text-xs text-text-faint">Obs</p><p className="text-text-muted">{detalhe.observacoes}</p></div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
