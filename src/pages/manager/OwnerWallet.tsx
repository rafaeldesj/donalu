import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, setDoc, updateDoc, where, addDoc } from 'firebase/firestore';
import { Wallet, RefreshCw, CheckCircle2, Clock, Undo2, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { auth, db } from '../../config/firebase';
import { API_BASE_URL } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import type { OrderDocument } from '../../types/order';

type EntryStatus = 'confirmado' | 'a_liberar' | 'estornado' | 'nao_aprovado' | 'nao_encontrado';

interface WalletEntry {
  orderId: string;
  orderNumber?: number | null;
  clientName: string;
  orderCreatedAt: string;
  method: string;
  mpId: string;
  status: EntryStatus;
  gross: number;
  fee: number;
  net: number;
  refundedAmount: number;
  releaseDate: string | null;
  checkedAt: string;
}

interface Withdrawal {
  id: string;
  amount: number;
  pixKeyType: string;
  pixKey: string;
  status: 'solicitado' | 'pago' | 'cancelado';
  requestedAt: string;
  requestedBy: string;
  paidAt?: string;
}

interface VerifyResult {
  notFound?: boolean;
  error?: boolean;
  paymentId?: string;
  mpStatus?: string;
  gross?: number;
  fee?: number;
  net?: number;
  refunded?: boolean;
  refundedAmount?: number;
  releaseDate?: string | null;
  released?: boolean;
}

type OrderWithId = OrderDocument & { id: string };

const BATCH = 40;
const RECHECK_MS = 5 * 60 * 1000;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ID do Mercado Pago do pedido (pagamento, order ou intenção Point). Stone/PagBank/mocks ficam de fora.
const getMpId = (o: OrderDocument): string | null => {
  const id = o.mercadoPagoPaymentId || o.mercadoPagoOrderId || o.pointPaymentIntentId;
  if (!id) return null;
  const s = String(id);
  if (s.startsWith('or_') || s.includes('MOCK') || s.includes('PAGBANK')) return null;
  return s;
};

const toEntryStatus = (r: VerifyResult): EntryStatus => {
  if (r.notFound || r.error) return 'nao_encontrado';
  if (r.refunded) return 'estornado';
  if (r.mpStatus !== 'approved') return 'nao_aprovado';
  return r.released ? 'confirmado' : 'a_liberar';
};

const isFinal = (e?: WalletEntry) => !!e && (e.status === 'confirmado' || e.status === 'estornado');

const OwnerWallet = () => {
  const { user, userData } = useAuth();
  const canAccess = userData?.role === 'owner' || userData?.role === 'developer';

  const [startDate, setStartDate] = useState<string | null>(null);
  const [startDateInput, setStartDateInput] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [orders, setOrders] = useState<OrderWithId[]>([]);
  const [entries, setEntries] = useState<Record<string, WalletEntry>>({});
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const [wdAmount, setWdAmount] = useState('');
  const [wdKeyType, setWdKeyType] = useState('cpf');
  const [wdKey, setWdKey] = useState('');
  const [wdError, setWdError] = useState<string | null>(null);
  const [wdBusy, setWdBusy] = useState(false);

  const entriesRef = useRef(entries);
  const ordersRef = useRef(orders);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  const syncingRef = useRef(false);

  // Data de corte: só pedidos a partir dela entram na carteira (evita misturar vendas já sacadas antes do módulo)
  useEffect(() => {
    if (!canAccess) return;
    return onSnapshot(doc(db, 'wallet_config', 'main'), (snap) => {
      setStartDate(snap.exists() ? (snap.data().startDate as string) : null);
      setConfigLoaded(true);
    }, () => setConfigLoaded(true));
  }, [canAccess]);

  useEffect(() => {
    if (!canAccess || !startDate) return;
    const q = query(collection(db, 'orders'), where('createdAt', '>=', startDate));
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ ...(d.data() as OrderDocument), id: d.id })));
    });
  }, [canAccess, startDate]);

  useEffect(() => {
    if (!canAccess) return;
    const unsubEntries = onSnapshot(collection(db, 'wallet_entries'), (snap) => {
      const map: Record<string, WalletEntry> = {};
      snap.docs.forEach(d => { map[d.id] = d.data() as WalletEntry; });
      setEntries(map);
    });
    const unsubWd = onSnapshot(collection(db, 'wallet_withdrawals'), (snap) => {
      const list = snap.docs.map(d => ({ ...(d.data() as Omit<Withdrawal, 'id'>), id: d.id }));
      list.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
      setWithdrawals(list);
    });
    return () => { unsubEntries(); unsubWd(); };
  }, [canAccess]);

  const sync = useCallback(async (force = false) => {
    if (syncingRef.current) return;
    const now = Date.now();
    const pending = ordersRef.current.filter(o => {
      if (o.status === 'cancelled' || o.status === 'awaiting_payment' || o.status === 'building_cart' || o.status === 'abandoned' || o.status === 'merged') return false;
      if (!getMpId(o)) return false;
      const e = entriesRef.current[o.id];
      if (isFinal(e)) return false;
      if (!force && e && now - new Date(e.checkedAt).getTime() < RECHECK_MS) return false;
      return true;
    });
    if (pending.length === 0) { setLastSync(new Date()); return; }

    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Sessão expirada. Entre novamente.');

      for (let i = 0; i < pending.length; i += BATCH) {
        const chunk = pending.slice(i, i + BATCH);
        const ids = Array.from(new Set(chunk.map(o => getMpId(o)!)));
        const resp = await fetch(`${API_BASE_URL}/api/pagamentos/wallet-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, ids }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.message || 'Falha ao conferir com o Mercado Pago.');

        for (const o of chunk) {
          const mpId = getMpId(o)!;
          const r: VerifyResult = data.results[mpId] || { error: true };
          const entry: WalletEntry = {
            orderId: o.id,
            orderNumber: o.dailySeq ?? null,
            clientName: o.clientName || '—',
            orderCreatedAt: o.createdAt,
            method: o.paymentMethod || '—',
            mpId,
            status: toEntryStatus(r),
            gross: r.gross ?? 0,
            fee: r.fee ?? 0,
            net: r.net ?? 0,
            refundedAmount: r.refundedAmount ?? 0,
            releaseDate: r.releaseDate ?? null,
            checkedAt: new Date().toISOString(),
          };
          await setDoc(doc(db, 'wallet_entries', o.id), entry);
        }
      }
      setLastSync(new Date());
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Erro ao conferir pagamentos.');
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Confere ao abrir (quando os pedidos chegam) e a cada 5 min
  useEffect(() => {
    if (!canAccess || orders.length === 0) return;
    sync();
    const t = setInterval(() => sync(), RECHECK_MS);
    return () => clearInterval(t);
  }, [canAccess, orders.length, sync]);

  const list = useMemo(() => {
    const valid = new Set(orders.map(o => o.id));
    return Object.values(entries)
      .filter(e => valid.has(e.orderId))
      .sort((a, b) => b.orderCreatedAt.localeCompare(a.orderCreatedAt));
  }, [entries, orders]);

  const totals = useMemo(() => {
    let available = 0, toRelease = 0, refunded = 0;
    for (const e of list) {
      const netAfterPartial = e.net - (e.status === 'estornado' ? 0 : e.refundedAmount);
      if (e.status === 'confirmado') available += netAfterPartial;
      else if (e.status === 'a_liberar') toRelease += netAfterPartial;
      else if (e.status === 'estornado') refunded += e.gross;
    }
    const withdrawn = withdrawals.filter(w => w.status !== 'cancelado').reduce((s, w) => s + w.amount, 0);
    return { available, toRelease, refunded, withdrawn, withdrawable: Math.max(0, available - withdrawn) };
  }, [list, withdrawals]);

  const unverified = useMemo(
    () => orders.filter(o => getMpId(o) && !['cancelled', 'awaiting_payment', 'building_cart', 'abandoned', 'merged'].includes(o.status) && !entries[o.id]).length,
    [orders, entries]
  );

  const saveStartDate = async () => {
    if (!startDateInput) return;
    await setDoc(doc(db, 'wallet_config', 'main'), {
      startDate: new Date(`${startDateInput}T00:00:00`).toISOString(),
      setBy: user?.email || '',
      setAt: new Date().toISOString(),
    });
  };

  const requestWithdrawal = async () => {
    setWdError(null);
    const amount = Math.round(parseFloat(wdAmount.replace(',', '.')) * 100) / 100;
    if (!amount || amount <= 0) return setWdError('Informe um valor válido.');
    if (amount > Math.round(totals.withdrawable * 100) / 100) return setWdError('Valor maior que o saldo disponível para saque.');
    if (!wdKey.trim()) return setWdError('Informe a chave Pix de destino.');
    setWdBusy(true);
    try {
      await addDoc(collection(db, 'wallet_withdrawals'), {
        amount,
        pixKeyType: wdKeyType,
        pixKey: wdKey.trim(),
        status: 'solicitado',
        requestedAt: new Date().toISOString(),
        requestedBy: user?.email || '',
      });
      setWdAmount('');
    } catch {
      setWdError('Não foi possível registrar o saque.');
    } finally {
      setWdBusy(false);
    }
  };

  const setWithdrawalStatus = async (w: Withdrawal, status: 'pago' | 'cancelado') => {
    const msg = status === 'pago'
      ? `Confirmar que você já transferiu ${brl(w.amount)} para a chave ${w.pixKey}?`
      : `Cancelar o saque de ${brl(w.amount)}? O valor volta ao saldo.`;
    if (!window.confirm(msg)) return;
    await updateDoc(doc(db, 'wallet_withdrawals', w.id), {
      status,
      ...(status === 'pago' ? { paidAt: new Date().toISOString() } : {}),
    });
  };

  if (!canAccess) {
    return <div style={{ padding: '2rem', color: '#fff' }}>Acesso restrito ao proprietário.</div>;
  }

  const card = (label: string, value: string, color: string, hint?: string) => (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem', flex: '1 1 200px' }}>
      <div style={{ fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>{hint}</div>}
    </div>
  );

  const badge = (e: WalletEntry) => {
    const base = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 999 } as const;
    switch (e.status) {
      case 'confirmado':
        return <span style={{ ...base, background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}><CheckCircle2 size={13} /> Saldo na conta</span>;
      case 'a_liberar':
        return <span style={{ ...base, background: 'rgba(250,204,21,0.15)', color: '#facc15' }}><Clock size={13} /> A liberar{e.releaseDate ? ` ${new Date(e.releaseDate).toLocaleDateString('pt-BR')}` : ''}</span>;
      case 'estornado':
        return <span style={{ ...base, background: 'rgba(148,163,184,0.15)', color: '#cbd5e1' }}><Undo2 size={13} /> Estornado</span>;
      case 'nao_aprovado':
        return <span style={{ ...base, background: 'rgba(248,113,113,0.15)', color: '#f87171' }}><AlertTriangle size={13} /> Não aprovado no MP</span>;
      default:
        return <span style={{ ...base, background: 'rgba(248,113,113,0.15)', color: '#f87171' }}><AlertTriangle size={13} /> Não encontrado no MP</span>;
    }
  };

  const th = { textAlign: 'left', padding: '8px 10px', fontSize: '0.72rem', color: '#9ca3af', textTransform: 'uppercase' } as const;
  const td = { padding: '8px 10px', fontSize: '0.85rem', color: '#e5e7eb', borderTop: '1px solid rgba(255,255,255,0.06)' } as const;
  const input = { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', padding: '8px 10px', fontSize: '0.9rem' } as const;
  const primaryBtn = { background: '#f59e0b', color: '#111', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' } as const;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: '1.5rem' }}><Wallet size={24} /> Carteira do Proprietário</h2>
        {startDate && (
          <button onClick={() => sync(true)} disabled={syncing} style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6, opacity: syncing ? 0.6 : 1 }}>
            <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {syncing ? 'Conferindo...' : 'Conferir com o Mercado Pago'}
          </button>
        )}
      </div>

      {configLoaded && !startDate && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 12, padding: '1rem', marginBottom: 16 }}>
          <strong>Defina a data de início da carteira.</strong>
          <p style={{ fontSize: '0.85rem', color: '#d1d5db', margin: '6px 0 10px' }}>
            Só pedidos a partir dessa data entram no saldo. Escolha o dia seguinte ao último saque que você já fez do Mercado Pago, para o saldo da carteira bater com o da conta.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} style={input} />
            <button onClick={saveStartDate} disabled={!startDateInput} style={primaryBtn}>Salvar</button>
          </div>
        </div>
      )}

      {startDate && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            {card('Disponível para saque', brl(totals.withdrawable), '#4ade80', 'Confirmado na conta, menos saques')}
            {card('A liberar', brl(totals.toRelease), '#facc15', 'Aprovado, aguardando liberação do MP')}
            {card('Sacado / solicitado', brl(totals.withdrawn), '#93c5fd')}
            {card('Estornos', brl(totals.refunded), '#cbd5e1')}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 16 }}>
            Desde {new Date(startDate).toLocaleDateString('pt-BR')}
            {lastSync && ` · última conferência ${lastSync.toLocaleTimeString('pt-BR')}`}
            {unverified > 0 && ` · ${unverified} pedido(s) aguardando conferência`}
            {' · Dinheiro vivo e Stone não entram nesta carteira.'}
          </div>
          {syncError && (
            <div style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#fca5a5', borderRadius: 10, padding: '10px 12px', marginBottom: 16, fontSize: '0.85rem' }}>
              {syncError}
            </div>
          )}

          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 6 }}><ArrowUpRight size={18} /> Solicitar saque</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input placeholder="Valor (R$)" inputMode="decimal" value={wdAmount} onChange={e => setWdAmount(e.target.value)} style={{ ...input, width: 130 }} />
              <select value={wdKeyType} onChange={e => setWdKeyType(e.target.value)} style={input}>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="telefone">Telefone</option>
                <option value="aleatoria">Chave aleatória</option>
              </select>
              <input placeholder="Chave Pix de destino" value={wdKey} onChange={e => setWdKey(e.target.value)} style={{ ...input, flex: '1 1 220px' }} />
              <button onClick={requestWithdrawal} disabled={wdBusy} style={primaryBtn}>Solicitar</button>
            </div>
            {wdError && <div style={{ color: '#f87171', fontSize: '0.8rem', marginTop: 8 }}>{wdError}</div>}
            <p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '8px 0 0' }}>
              O valor sai do saldo na hora. A transferência é feita por você no app do Mercado Pago; depois marque como pago.
            </p>

            {withdrawals.length > 0 && (
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Data</th><th style={th}>Valor</th><th style={th}>Chave Pix</th><th style={th}>Status</th><th style={th}></th></tr></thead>
                  <tbody>
                    {withdrawals.map(w => (
                      <tr key={w.id}>
                        <td style={td}>{new Date(w.requestedAt).toLocaleString('pt-BR')}</td>
                        <td style={td}>{brl(w.amount)}</td>
                        <td style={td}>{w.pixKeyType}: {w.pixKey}</td>
                        <td style={td}>{w.status === 'solicitado' ? 'Aguardando transferência' : w.status === 'pago' ? 'Pago' : 'Cancelado'}</td>
                        <td style={td}>
                          {w.status === 'solicitado' && (
                            <span style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setWithdrawalStatus(w, 'pago')} style={{ ...primaryBtn, padding: '4px 10px', fontSize: '0.75rem' }}>Marcar pago</button>
                              <button onClick={() => setWithdrawalStatus(w, 'cancelado')} style={{ ...primaryBtn, background: 'rgba(255,255,255,0.1)', color: '#fff', padding: '4px 10px', fontSize: '0.75rem' }}>Cancelar</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <h3 style={{ fontSize: '1.05rem', margin: '0 0 8px' }}>Extrato de pagamentos de clientes</h3>
          <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr><th style={th}>Data</th><th style={th}>Pedido</th><th style={th}>Cliente</th><th style={th}>Forma</th><th style={th}>Bruto</th><th style={th}>Taxa</th><th style={th}>Líquido</th><th style={th}>Situação</th></tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr><td style={{ ...td, textAlign: 'center', color: '#9ca3af' }} colSpan={8}>{syncing ? 'Conferindo pagamentos...' : 'Nenhum pagamento online conferido ainda.'}</td></tr>
                )}
                {list.map(e => (
                  <tr key={e.orderId}>
                    <td style={td}>{new Date(e.orderCreatedAt).toLocaleString('pt-BR')}</td>
                    <td style={td}>{e.orderNumber ? `#${e.orderNumber}` : e.orderId.slice(0, 6)}</td>
                    <td style={td}>{e.clientName}</td>
                    <td style={td}>{e.method}</td>
                    <td style={td}>{brl(e.gross)}</td>
                    <td style={td}>{brl(e.fee)}</td>
                    <td style={td}>{brl(e.net)}</td>
                    <td style={td}>{badge(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default OwnerWallet;
