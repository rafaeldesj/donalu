import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { TrendingUp, Users, DollarSign, ShieldAlert, Cpu, Clock, X, ArrowLeft, AlertCircle } from 'lucide-react';
import { collection, query, onSnapshot, orderBy, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';
import { logAuditAction } from '../../utils/audit';
import { API_BASE_URL } from '../../config/api';

type ActiveModal = 
  | { type: 'category'; category: 'billing' | 'sales' | 'prep_queue' | 'prep_time' }
  | { type: 'order'; order: OrderDocument; previousModal?: ActiveModal }
  | null;

export const AdminDashboard = () => {
  const { user, userData } = useAuth();
  
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [refundLoading, setRefundLoading] = useState(false);

  const handleRefundPayment = async (order: OrderDocument) => {
    if (!window.confirm(`Tem certeza que deseja estornar o pagamento de R$ ${order.total.toFixed(2).replace('.', ',')} do Pedido ${order.dailySeq}?`)) {
      return;
    }
    setRefundLoading(true);
    try {
      const storeConfigRef = doc(db, 'settings', 'store_config');
      const storeConfigSnap = await getDoc(storeConfigRef);
      const storeConfigData = storeConfigSnap.exists() ? storeConfigSnap.data() : null;
      const token = storeConfigData?.storeOwnerAccessToken || storeConfigData?.devAccessToken || 'mock';

      const response = await fetch(`${API_BASE_URL}/api/pagamentos/refund-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: order.mercadoPagoPaymentId,
          token: token
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Erro ao processar estorno no Mercado Pago.');
      }

      const orderDocRef = doc(db, 'orders', order.id!);
      await updateDoc(orderDocRef, {
        refunded: true,
        refundedAt: new Date().toISOString(),
        refundedBy: userData?.name || 'Sistema',
        updatedAt: new Date().toISOString()
      });

      await logAuditAction({
        userId: user?.uid || 'guest',
        userEmail: user?.email || 'anonimo@donalu.web.app',
        userName: userData?.name || 'Administrador',
        actionType: 'PAYMENT_REFUND',
        title: 'Pagamento Estornado',
        description: `Estornou o pagamento de R$ ${order.total.toFixed(2).replace('.', ',')} do Pedido ${order.dailySeq || ''} (ID: "${order.id}").`,
        userRole: userData?.role || 'admin',
        metadata: { orderId: order.id, dailySeq: order.dailySeq, total: order.total, paymentId: order.mercadoPagoPaymentId }
      });

      alert('Pagamento estornado com sucesso no Mercado Pago!');
      
      setActiveModal(prev => {
        if (prev?.type === 'order' && prev.order.id === order.id) {
          return {
            ...prev,
            order: {
              ...prev.order,
              refunded: true,
              refundedAt: new Date().toISOString(),
              refundedBy: userData?.name || 'Sistema'
            }
          };
        }
        return prev;
      });

    } catch (err: any) {
      console.error('Erro ao estornar pagamento:', err);
      alert('Erro ao estornar pagamento: ' + err.message);
    } finally {
      setRefundLoading(false);
    }
  };

  // Escuta todos os pedidos para calcular métricas reais
  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedOrders: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetchedOrders.push({
          id: docSnap.id,
          ...docSnap.data()
        } as OrderDocument);
      });
      setOrders(fetchedOrders);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao carregar dados administrativos:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Métricas calculadas em tempo real
  const completedOrders = orders.filter(o => o.status === 'completed');
  
  const billingToday = completedOrders.reduce((sum, order) => sum + order.total, 0);
  
  const pendingPrepCount = orders.filter(o => o.status === 'pending').length;
  const inPrepCount = orders.filter(o => o.status === 'preparing' || o.status === 'prepared').length;

  // Filtra pedidos que têm tempo de preparo registrado para calcular a média
  const ordersWithPrepTime = orders.filter(o => o.kitchenDurationSeconds !== undefined && o.kitchenDurationSeconds > 0);
  const avgPrepTimeSeconds = ordersWithPrepTime.length > 0 
    ? ordersWithPrepTime.reduce((sum, o) => sum + (o.kitchenDurationSeconds || 0), 0) / ordersWithPrepTime.length 
    : 0;

  const formatPrepTime = (totalSeconds: number) => {
    if (totalSeconds === 0) return '--';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const mockStats = [
    { id: 1, label: 'Faturamento Total Real', val: `R$ ${billingToday.toFixed(2).replace('.', ',')}`, icon: DollarSign, color: '#f59e0b', category: 'billing' as const },
    { id: 2, label: 'Vendas Finalizadas', val: `${completedOrders.length} pedidos`, icon: TrendingUp, color: '#10b981', category: 'sales' as const },
    { id: 3, label: 'Fila de Preparação', val: `${pendingPrepCount} pendentes / ${inPrepCount} preparando`, icon: Users, color: '#3b82f6', category: 'prep_queue' as const },
    { id: 4, label: 'Tempo Médio de Preparo', val: formatPrepTime(avgPrepTimeSeconds), icon: Clock, color: '#a855f7', category: 'prep_time' as const },
  ];

  if (loading) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '250px', margin: '2rem auto' }}>
        <span className="spinner"></span>
        <span>Carregando estatísticas...</span>
      </div>
    );
  }

  // Helper to format date nicely
  const formatDateTime = (isoString?: string) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Helper to translate order type
  const getOrderTypeLabel = (type?: string) => {
    switch (type) {
      case 'delivery': return '🛵 Entrega';
      case 'dine_in': return '🍽️ Comer no Local';
      case 'dine_in_table': return '🪑 Na Mesa';
      case 'pickup': return '🏪 Retirada';
      default: return 'Outro';
    }
  };

  // Helper for friendly payment methods
  const getPaymentMethodLabel = (method?: string | null) => {
    if (!method) return 'Não informado';
    switch (method) {
      case 'dinheiro': return 'Dinheiro';
      case 'pix': return 'Pix';
      case 'credito': return 'Cartão de Crédito';
      case 'debito': return 'Cartão de Débito';
      case 'maq_pix': return 'Pix (Maquininha)';
      case 'maq_debito': return 'Débito (Maquininha)';
      case 'maq_credito': return 'Crédito (Maquininha)';
      case 'google_pay': return 'Google Pay';
      default: return method.toUpperCase();
    }
  };

  const renderStatusBadge = (status: string, refunded?: boolean) => {
    const isGreen = ['completed', 'delivering'].includes(status);
    const isBlue = ['ready', 'prepared'].includes(status);
    const isYellow = ['preparing', 'pending', 'aguardando_caixa', 'pendente_pagamento', 'awaiting_payment'].includes(status);
    const isRed = ['cancelled'].includes(status);

    let bgColor = 'rgba(75, 85, 99, 0.2)';
    let color = 'var(--text-secondary)';
    if (refunded) { bgColor = '#ef444430'; color = '#f87171'; }
    else if (isGreen) { bgColor = '#05966920'; color = '#10b981'; }
    else if (isBlue) { bgColor = '#0284c720'; color = '#3b82f6'; }
    else if (isYellow) { bgColor = '#d9770620'; color = 'var(--primary-gold)'; }
    else if (isRed) { bgColor = '#ef444420'; color = '#f87171'; }

    let text = status.toUpperCase();
    if (refunded) {
      text = 'CANCELADO E ESTORNADO';
    } else {
      switch (status) {
        case 'pending': text = 'PENDENTE'; break;
        case 'preparing': text = 'EM PREPARO'; break;
        case 'prepared': text = 'PREPARADO'; break;
        case 'ready': text = 'PRONTO'; break;
        case 'delivering': text = 'EM ROTA'; break;
        case 'completed': text = 'FINALIZADO'; break;
        case 'cancelled': text = 'CANCELADO'; break;
        case 'aguardando_caixa': text = 'FECHANDO CONTA'; break;
        case 'pendente_pagamento': text = 'PGTO PENDENTE'; break;
        case 'awaiting_payment': text = 'AGUARDANDO PGTO'; break;
      }
    }

    return (
      <span className="auth-role-badge" style={{ backgroundColor: bgColor, color: color, fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 600 }}>
        {text}
      </span>
    );
  };

  const renderCategoryModal = (category: 'billing' | 'sales' | 'prep_queue' | 'prep_time') => {
    let title = '';
    let filteredOrdersList: OrderDocument[] = [];
    let kpis: { label: string; val: string; isGold?: boolean; isGreen?: boolean }[] = [];

    if (category === 'billing') {
      title = 'Detalhamento de Faturamento Real';
      filteredOrdersList = orders.filter(o => o.status === 'completed');
      kpis = [
        { label: 'Faturamento Total', val: `R$ ${billingToday.toFixed(2).replace('.', ',')}`, isGold: true },
        { label: 'Vendas Finalizadas', val: `${filteredOrdersList.length} pedidos`, isGreen: true }
      ];
    } else if (category === 'sales') {
      title = 'Vendas Finalizadas (Completed)';
      filteredOrdersList = orders.filter(o => o.status === 'completed');
      const avgTicket = filteredOrdersList.length > 0 
        ? filteredOrdersList.reduce((sum, o) => sum + o.total, 0) / filteredOrdersList.length 
        : 0;
      kpis = [
        { label: 'Total de Vendas', val: `${filteredOrdersList.length} pedidos`, isGreen: true },
        { label: 'Ticket Médio', val: `R$ ${avgTicket.toFixed(2).replace('.', ',')}`, isGold: true }
      ];
    } else if (category === 'prep_queue') {
      title = 'Pedidos na Fila de Preparação';
      filteredOrdersList = orders.filter(o => 
        ['pending', 'preparing', 'prepared', 'ready', 'aguardando_caixa', 'pendente_pagamento', 'awaiting_payment'].includes(o.status)
      );
      kpis = [
        { label: 'Aguardando Cozinha', val: `${pendingPrepCount} pendentes`, isGold: true },
        { label: 'Em Preparação', val: `${inPrepCount} preparando`, isGreen: false }
      ];
    } else if (category === 'prep_time') {
      title = 'Métricas de Tempo de Preparo';
      filteredOrdersList = orders.filter(o => o.kitchenDurationSeconds !== undefined && o.kitchenDurationSeconds > 0);
      kpis = [
        { label: 'Tempo Médio Geral', val: formatPrepTime(avgPrepTimeSeconds), isGold: true },
        { label: 'Pedidos Avaliados', val: `${filteredOrdersList.length} pedidos`, isGreen: true }
      ];
    }

    return (
      <div className="admin-modal-overlay" onClick={() => setActiveModal(null)}>
        <div className="admin-modal-content wide" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {title}
            </h3>
            <button className="admin-modal-close-btn" onClick={() => setActiveModal(null)}>
              <X size={18} />
            </button>
          </div>

          {/* KPIs */}
          <div className="modal-kpi-container">
            {kpis.map((kpi, idx) => (
              <div key={idx} className="modal-kpi-card">
                <span className="modal-kpi-label">{kpi.label}</span>
                <span className={`modal-kpi-val ${kpi.isGold ? 'gold' : kpi.isGreen ? 'green' : ''}`}>{kpi.val}</span>
              </div>
            ))}
          </div>

          {/* Table list */}
          <div style={{ overflowX: 'auto', flex: 1, maxHeight: '50vh' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Total</th>
                  {category === 'billing' || category === 'sales' ? (
                    <th>Pagamento</th>
                  ) : category === 'prep_time' ? (
                    <th>Tempo Cozinha</th>
                  ) : (
                    <th>Status</th>
                  )}
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrdersList.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum pedido encontrado nesta categoria.</td>
                  </tr>
                ) : (
                  filteredOrdersList.map((order) => (
                    <tr 
                      key={order.id} 
                      className="interactive-row" 
                      onClick={() => setActiveModal({ type: 'order', order, previousModal: { type: 'category', category } })}
                      title="Clique para ver os detalhes deste pedido"
                    >
                      <td>
                        {order.dailySeq ? (
                          userData?.role === 'developer' ? (
                            `Pedido ${order.dailySeq} (#${order.id?.slice(-4).toUpperCase()})`
                          ) : (
                            `Pedido ${order.dailySeq}`
                          )
                        ) : (
                          `#${order.id?.slice(-4).toUpperCase()}`
                        )}
                      </td>
                      <td>{order.clientName}</td>
                      <td>{getOrderTypeLabel(order.orderType)}</td>
                      <td style={{ color: 'var(--primary-gold)', fontWeight: 600 }}>R$ {order.total.toFixed(2).replace('.', ',')}</td>
                      {category === 'billing' || category === 'sales' ? (
                        <td>{getPaymentMethodLabel(order.paymentMethod)}</td>
                      ) : category === 'prep_time' ? (
                        <td><strong>{formatPrepTime(order.kitchenDurationSeconds || 0)}</strong></td>
                      ) : (
                        <td>{renderStatusBadge(order.status, order.refunded)}</td>
                      )}
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDateTime(order.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer close */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
            <button className="logout-action-btn" onClick={() => setActiveModal(null)} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderOrderDetailModal = (order: OrderDocument, previousModal?: any) => {
    // Calculo de subtotal e taxa de serviço/entrega
    const itemsSubtotal = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const hasServiceFee = order.serviceFee !== undefined && order.serviceFee > 0;
    const hasDeliveryFee = order.deliveryFee !== undefined && order.deliveryFee > 0;

    return (
      <div className="admin-modal-overlay" onClick={() => setActiveModal(null)}>
        <div className="admin-modal-content wide" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {previousModal && (
                <button className="admin-modal-back-btn" onClick={() => setActiveModal(previousModal)}>
                  <ArrowLeft size={16} /> Voltar
                </button>
              )}
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Pedido {order.dailySeq || ''} <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>(#{order.id?.slice(-6).toUpperCase()})</span>
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {renderStatusBadge(order.status, order.refunded)}
              <button className="admin-modal-close-btn" onClick={() => setActiveModal(null)}>
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Grid de Informações de Pedido */}
          <div className="detail-grid-2col">
            {/* Coluna 1: Informações Gerais */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="modal-detail-section" style={{ borderTop: 'none', paddingTop: 0 }}>
                <h4>Informações do Cliente</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.25rem' }}>
                  <div className="detail-item">
                    <span className="detail-label">Nome</span>
                    <span className="detail-val">{order.clientName}</span>
                  </div>
                  {order.clientPhone && (
                    <div className="detail-item">
                      <span className="detail-label">Telefone</span>
                      <span className="detail-val">{order.clientPhone}</span>
                    </div>
                  )}
                  <div className="detail-item">
                    <span className="detail-label">Tipo de Pedido</span>
                    <span className="detail-val" style={{ color: 'var(--primary-gold)', fontWeight: 600 }}>
                      {getOrderTypeLabel(order.orderType)}
                      {order.orderType === 'dine_in_table' && ` (Mesa ${order.tableNumber})`}
                    </span>
                  </div>
                </div>
              </div>

              {order.orderType === 'delivery' && order.address && (
                <div className="modal-detail-section">
                  <h4>Endereço de Entrega</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem', fontSize: '0.85rem' }}>
                    <div><strong>Rua:</strong> {order.address.street}, {order.address.number}</div>
                    {order.address.complement && <div><strong>Complemento:</strong> {order.address.complement}</div>}
                    <div><strong>Bairro:</strong> {order.address.neighborhood}</div>
                    <div><strong>Cidade/CEP:</strong> {order.address.city} - {order.address.zipCode}</div>
                    {order.deliveryName && (
                      <div style={{ marginTop: '0.5rem', color: 'var(--primary-gold)' }}>
                        <strong>Entregador:</strong> {order.deliveryName}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="modal-detail-section">
                <h4>Pagamento</h4>
                <div className="detail-grid-2col" style={{ marginTop: '0.25rem' }}>
                  <div className="detail-item">
                    <span className="detail-label">Meio de Pagamento</span>
                    <span className="detail-val">{getPaymentMethodLabel(order.paymentMethod)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Valor Pago</span>
                    <span className="detail-val" style={{ color: '#10b981', fontWeight: 600 }}>R$ {order.total.toFixed(2).replace('.', ',')}</span>
                  </div>
                  {order.changeFor !== undefined && order.changeFor !== null && order.changeFor > 0 && (
                    <div className="detail-item" style={{ gridColumn: 'span 2' }}>
                      <span className="detail-label">Troco para</span>
                      <span className="detail-val">R$ {order.changeFor.toFixed(2).replace('.', ',')} (Troco de R$ {(order.changeFor - order.total).toFixed(2).replace('.', ',')})</span>
                    </div>
                  )}
                  {order.refunded && (
                    <div className="detail-item" style={{ gridColumn: 'span 2', marginTop: '0.5rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.5rem 0.75rem', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#f87171', fontWeight: 600, fontSize: '0.85rem' }}>❌ Pagamento Estornado</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Por: {order.refundedBy} em {new Date(order.refundedAt || '').toLocaleDateString('pt-BR')}</span>
                    </div>
                  )}
                  {!order.refunded && order.status === 'cancelled' && order.mercadoPagoPaymentId && (
                    <div style={{ gridColumn: 'span 2', marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => handleRefundPayment(order)}
                        disabled={refundLoading}
                        style={{
                          width: '100%',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '10px',
                          padding: '0.5rem',
                          color: '#f87171',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          cursor: refundLoading ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.5rem',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => { if (!refundLoading) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; }}
                        onMouseLeave={(e) => { if (!refundLoading) e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                      >
                        {refundLoading ? 'Estornando...' : 'Estornar Pagamento no Mercado Pago'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Coluna 2: Histórico/Timeline de Preparo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="modal-detail-section" style={{ borderTop: 'none', paddingTop: 0 }}>
                <h4>Cronologia do Pedido</h4>
                <div className="modal-timeline">
                  <div className={`modal-timeline-step completed`}>
                    <span className="modal-timeline-label">Criado</span>
                    <span className="modal-timeline-time">{formatDateTime(order.createdAt)}</span>
                  </div>
                  {order.kitchenEnteredAt && (
                    <div className={`modal-timeline-step ${order.kitchenFinishedAt || order.kitchenDurationSeconds ? 'completed' : 'active'}`}>
                      <span className="modal-timeline-label">Entrou na Cozinha</span>
                      <span className="modal-timeline-time">{formatDateTime(order.kitchenEnteredAt)}</span>
                    </div>
                  )}
                  {order.kitchenDurationSeconds !== undefined && (
                    <div className="modal-timeline-step completed">
                      <span className="modal-timeline-label">Pronto na Cozinha (Tempo: {formatPrepTime(order.kitchenDurationSeconds)})</span>
                      <span className="modal-timeline-time">{order.kitchenFinishedAt ? formatDateTime(order.kitchenFinishedAt) : '-'}</span>
                    </div>
                  )}
                  {order.dispatchedAt && (
                    <div className="modal-timeline-step completed">
                      <span className="modal-timeline-label">{order.orderType === 'delivery' ? 'Saiu para Entrega' : 'Pronto para Retirada'}</span>
                      <span className="modal-timeline-time">{formatDateTime(order.dispatchedAt)}</span>
                    </div>
                  )}
                  {order.deliveredAt && (
                    <div className="modal-timeline-step completed">
                      <span className="modal-timeline-label">Entregue</span>
                      <span className="modal-timeline-time">{formatDateTime(order.deliveredAt)}</span>
                    </div>
                  )}
                  {order.status === 'completed' && (
                    <div className="modal-timeline-step completed">
                      <span className="modal-timeline-label">Finalizado</span>
                      <span className="modal-timeline-time">{formatDateTime(order.deliveredAt || order.kitchenFinishedAt || order.createdAt)}</span>
                    </div>
                  )}
                  {order.status === 'cancelled' && (
                    <div className="modal-timeline-step cancelled">
                      <span className="modal-timeline-label">Cancelado</span>
                      <span className="modal-timeline-time">{formatDateTime(order.cancelledAt || order.createdAt)}</span>
                    </div>
                  )}
                </div>
              </div>

              {order.status === 'cancelled' && (
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f87171', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                    <AlertCircle size={16} /> Motivo do Cancelamento
                  </div>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {order.cancelReason || 'Nenhum motivo informado.'}
                  </p>
                  {order.cancelledBy && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      Cancelado por: {order.cancelledBy}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Seção de Itens Pedidos */}
          <div className="modal-detail-section">
            <h4>Itens Solicitados</h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="modal-order-items-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ textAlign: 'center' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Preço Unitário</th>
                    <th style={{ textAlign: 'right' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        <ul className="item-options-list">
                          {item.category && <li><span className="item-option-badge">{item.category}</span></li>}
                          {item.size && <li><span className="item-option-badge highlight">Tamanho: {item.size === 'grande' ? 'Grande' : 'Kids'}</span></li>}
                          {item.cheeseOption && <li><span className="item-option-badge highlight">Queijo: {item.cheeseOption.toUpperCase()}</span></li>}
                          {item.withCatupiry && <li><span className="item-option-badge highlight">+ Catupiry</span></li>}
                          {item.withBorda && <li><span className="item-option-badge highlight">+ Borda Recheada</span></li>}
                          {item.ingredients && item.ingredients.length > 0 && (
                            <li>
                              <span className="item-option-badge">
                                Adicionais: {item.ingredients.join(', ')}
                              </span>
                            </li>
                          )}
                        </ul>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.quantity}</td>
                      <td style={{ textAlign: 'right' }}>R$ {item.price.toFixed(2).replace('.', ',')}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--primary-gold)' }}>
                        R$ {(item.price * item.quantity).toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Resumo Financeiro do Pedido */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', marginTop: '1rem', paddingRight: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '2rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>Subtotal dos Itens:</span>
                <span style={{ fontWeight: 500, minWidth: '80px', textAlign: 'right' }}>R$ {itemsSubtotal.toFixed(2).replace('.', ',')}</span>
              </div>
              {hasServiceFee && (
                <div style={{ display: 'flex', gap: '2rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span>Taxa de Serviço:</span>
                  <span style={{ fontWeight: 500, minWidth: '80px', textAlign: 'right' }}>R$ {(order.serviceFee || 0).toFixed(2).replace('.', ',')}</span>
                </div>
              )}
              {hasDeliveryFee && (
                <div style={{ display: 'flex', gap: '2rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <span>Taxa de Entrega:</span>
                  <span style={{ fontWeight: 500, minWidth: '80px', textAlign: 'right' }}>R$ {(order.deliveryFee || 0).toFixed(2).replace('.', ',')}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '2rem', fontSize: '1.05rem', fontWeight: 700, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                <span style={{ color: '#fff' }}>Valor Total:</span>
                <span style={{ color: 'var(--primary-gold)', minWidth: '80px', textAlign: 'right' }}>R$ {order.total.toFixed(2).replace('.', ',')}</span>
              </div>
            </div>
          </div>

          {/* Footer close */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
            <button className="logout-action-btn" onClick={() => setActiveModal(null)} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-layout">
      <div className="dashboard-header">
        <h2>Painel Administrativo</h2>
        <p>Acompanhamento de faturamento, pedidos e controle de permissões em tempo real.</p>
      </div>

      <div className="stats-grid">
        {mockStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div 
              key={stat.id} 
              className="stat-card interactive"
              onClick={() => setActiveModal({ type: 'category', category: stat.category })}
              title={`Clique para detalhar: ${stat.label}`}
            >
              <div className="stat-icon" style={{ backgroundColor: `${stat.color}15`, color: stat.color }}>
                <Icon size={24} />
              </div>
              <div className="stat-details">
                <span className="stat-label">{stat.label}</span>
                <span className="stat-value">{stat.val}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="admin-sections-grid">
        {/* Tabela de Pedidos Recentes */}
        <div className="admin-card-box">
          <h3>Últimos Pedidos</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Tempo Preparo</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum pedido efetuado ainda.</td>
                  </tr>
                ) : (
                  orders.slice(0, 5).map((order) => (
                    <tr 
                      key={order.id} 
                      className="interactive-row"
                      onClick={() => setActiveModal({ type: 'order', order })}
                      title="Clique para ver os detalhes deste pedido"
                    >
                      <td>
                        {order.dailySeq ? (
                          userData?.role === 'developer' ? (
                            `Pedido ${order.dailySeq} (#${order.id?.slice(-4).toUpperCase()})`
                          ) : (
                            `Pedido ${order.dailySeq}`
                          )
                        ) : (
                          `#${order.id?.slice(-4).toUpperCase()}`
                        )}
                      </td>
                      <td>{order.clientName}</td>
                      <td style={{ color: 'var(--primary-gold)', fontWeight: 600 }}>R$ {order.total.toFixed(2).replace('.', ',')}</td>
                      <td>
                        <span className="auth-role-badge" style={{ 
                          backgroundColor: 
                            order.refunded ? '#ef444430' :
                            order.status === 'completed' || order.status === 'delivering' ? '#05966920' : 
                            order.status === 'ready' ? '#0284c720' : 
                            order.status === 'preparing' || order.status === 'prepared' ? '#d9770620' : 
                            order.status === 'cancelled' ? '#ef444420' : '#4b556320', 
                          color: 
                            order.refunded ? '#f87171' :
                            order.status === 'completed' || order.status === 'delivering' ? '#10b981' : 
                            order.status === 'ready' ? '#3b82f6' : 
                            order.status === 'preparing' || order.status === 'prepared' ? 'var(--primary-gold)' : 
                            order.status === 'cancelled' ? '#f87171' : 'var(--text-secondary)',
                          fontSize: '0.7rem',
                          padding: '0.1rem 0.5rem'
                        }}>
                          {(() => {
                            if (order.refunded) return 'CANCELADO E ESTORNADO';
                            switch (order.status) {
                              case 'pending': return 'PENDENTE';
                              case 'preparing': return 'EM PREPARO';
                              case 'prepared': return 'PREPARADO';
                              case 'ready': return 'PRONTO';
                              case 'delivering': 
                                return order.orderType === 'dine_in_table' ? 'ENTREGUE NA MESA' : 'EM ROTA';
                              case 'completed': return 'FINALIZADO';
                              case 'cancelled': return 'CANCELADO';
                              case 'aguardando_caixa': return 'FECHANDO CONTA';
                              case 'pendente_pagamento': return 'PGTO PENDENTE';
                              default: return (order.status as string).toUpperCase();
                            }
                          })()}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {order.kitchenDurationSeconds !== undefined ? (
                          <div>
                            <strong>{formatPrepTime(order.kitchenDurationSeconds)}</strong>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              Entrada: {new Date(order.kitchenEnteredAt || order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        ) : order.kitchenEnteredAt ? (
                          <div>
                            <span style={{ color: 'var(--primary-gold)', fontWeight: 600 }}>⏱️ Em andamento</span>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              Entrada: {new Date(order.kitchenEnteredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Informações Específicas do Nível de Permissão */}
        <div className="admin-card-box">
          {userData?.role === 'developer' && (
            <div className="dev-features">
              <h3 className="text-purple flex-center">
                <Cpu size={18} style={{ marginRight: '8px' }} /> Configurações de Developer (Root)
              </h3>
              <p className="small-text">Você possui acesso de root ao Firestore. Logs de depuração ativos:</p>
              <div className="dev-logs">
                <code>[SYS] Conectado ao banco: dona-lu-4242d</code><br />
                <code>[SYS] Eventos de pedidos ativos: {orders.length}</code><br />
                <code>[SYS] Faturamento sincronizado em tempo real.</code>
              </div>
            </div>
          )}

          {userData?.role === 'owner' && (
            <div>
              <h3 className="text-gold flex-center">
                <ShieldAlert size={18} style={{ marginRight: '8px' }} /> Visão do Proprietário
              </h3>
              <p>Você tem acesso total aos relatórios financeiros de fechamento de caixa e faturamento mensal.</p>
              <button type="button" className="setup-btn" style={{ background: 'var(--primary-gold)', color: '#000', width: '100%', padding: '0.6rem' }}>
                Gerar Fechamento Mensal
              </button>
            </div>
          )}

          {userData?.role === 'manager' && (
            <div>
              <h3>Controle do Gerente</h3>
              <p>Acesso liberado para gerenciar escala de horários de funcionários e estoque de insumos.</p>
              <button type="button" className="setup-btn" style={{ width: '100%', padding: '0.6rem' }}>
                Gerenciar Estoque de Insumos
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modais Interativos com Informações Detalhadas */}
      {activeModal?.type === 'category' && renderCategoryModal(activeModal.category)}
      {activeModal?.type === 'order' && renderOrderDetailModal(activeModal.order, activeModal.previousModal)}
    </div>
  );
};
export default AdminDashboard;
