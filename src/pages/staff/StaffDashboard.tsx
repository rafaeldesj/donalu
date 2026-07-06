import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ChefHat, CreditCard, Bell, Play, Check, Navigation } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, orderBy, addDoc, getDocs, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';

interface StaffDashboardProps {
  filter?: 'cook' | 'attendant' | 'cashier' | 'delivery';
}

export const StaffDashboard = ({ filter }: StaffDashboardProps) => {
  const { userData } = useAuth();
  const staff = userData?.staffFunctions;

  const getOrderTypeLabel = (order: any) => {
    if (order.orderType === 'delivery') return '🛵 Entrega';
    if (order.orderType === 'dine_in') return '🍽️ Comer no Local';
    if (order.orderType === 'dine_in_table') return `🪑 Mesa ${order.tableNumber || '?'}`;
    if (order.orderType === 'pickup') return '🏪 Retirada (Para Viagem)';
    return order.address ? '🛵 Entrega' : '🏪 Retirada';
  };

  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelOrderSeq, setCancelOrderSeq] = useState<number | null>(null);
  const [cancelReasonOption, setCancelReasonOption] = useState<string>('Cliente desistiu do pedido');
  const [customCancelReason, setCustomCancelReason] = useState<string>('');

  const [reprovingOrderId, setReprovingOrderId] = useState<string | null>(null);
  const [reprovingOrderSeq, setReprovingOrderSeq] = useState<number | null>(null);

  const handleApproveCashierOrder = async (order: OrderDocument) => {
    if (!order.id) return;
    try {
      const orderDocRef = doc(db, 'orders', order.id);
      await updateDoc(orderDocRef, {
        status: 'pending'
      });

      await addDoc(collection(db, 'transactions'), {
        orderId: order.id,
        clientName: order.clientName,
        clientUid: order.clientUid,
        total: order.total,
        paymentMethod: order.paymentMethod,
        type: 'baixa_manual',
        approvedBy: userData?.name || userData?.email || 'Caixa',
        createdAt: new Date().toISOString()
      });

      alert('Baixa do pedido aprovada com sucesso! O pedido foi enviado para a cozinha.');
    } catch (err) {
      console.error('Erro ao aprovar baixa do caixa:', err);
      alert('Erro ao aprovar baixa do caixa. Tente novamente.');
    }
  };

  const handleReproveCashierOrder = async () => {
    if (!reprovingOrderId) return;
    try {
      const orderDocRef = doc(db, 'orders', reprovingOrderId);
      await updateDoc(orderDocRef, {
        status: 'pending',
        paymentMethod: null,
        changeFor: null
      });
      setReprovingOrderId(null);
      setReprovingOrderSeq(null);
      alert('Pedido reprovado com sucesso. O cliente poderá selecionar um novo método de pagamento no app.');
    } catch (err) {
      console.error('Erro ao reprovar pedido no caixa:', err);
      alert('Erro ao reprovar pedido. Tente novamente.');
    }
  };

  const handleWaiveServiceFee = async (order: OrderDocument) => {
    if (!order.id || !order.serviceFee) return;
    if (window.confirm("Deseja realmente isentar a taxa de serviço de 10% deste pedido?")) {
      try {
        const orderRef = doc(db, 'orders', order.id);
        await updateDoc(orderRef, {
          total: order.total - order.serviceFee,
          serviceFee: 0
        });
      } catch (err) {
        console.error("Erro ao isentar taxa de serviço:", err);
        alert("Erro ao remover taxa. Verifique suas permissões.");
      }
    }
  };

  const handleRestoreServiceFee = async (order: OrderDocument) => {
    if (!order.id) return;
    if (order.serviceFee && order.serviceFee > 0) return;
    
    if (window.confirm("Deseja realmente cobrar a taxa de serviço de 10% novamente para este pedido?")) {
      try {
        const calculatedFee = order.total * 0.10;
        const orderRef = doc(db, 'orders', order.id);
        await updateDoc(orderRef, {
          total: order.total + calculatedFee,
          serviceFee: calculatedFee
        });
      } catch (err) {
        console.error("Erro ao cobrar taxa de serviço novamente:", err);
        alert("Erro ao aplicar taxa novamente. Verifique suas permissões.");
      }
    }
  };

  // Escuta pedidos em tempo real no Firestore
  useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedOrders: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetchedOrders.push({
          id: docSnap.id,
          ...docSnap.data()
        } as OrderDocument);
      });
      setOrders(fetchedOrders);
      setLoadingOrders(false);
    }, (error) => {
      console.error("Erro ao escutar pedidos no Firestore:", error);
      setLoadingOrders(false);
    });

    return () => unsubscribe();
  }, []);

  const checkAndFreeTable = async (orderTableNumber?: string | null, orderIdToExclude?: string) => {
    if (!orderTableNumber) return;
    // Verifica se existem outros pedidos ativos para a mesma mesa
    const otherActive = orders.some(o => 
      o.id !== orderIdToExclude && 
      o.orderType === 'dine_in_table' && 
      o.tableNumber === orderTableNumber && 
      !['completed', 'cancelled'].includes(o.status)
    );
    
    if (!otherActive) {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('tableNumber', '==', orderTableNumber));
        const querySnapshot = await getDocs(q);
        const batchPromises = querySnapshot.docs.map(userDoc => 
          updateDoc(doc(db, 'users', userDoc.id), {
            tableNumber: null,
            updatedAt: new Date().toISOString()
          })
        );
        await Promise.all(batchPromises);
      } catch (err) {
        console.error("Erro ao desvincular mesa após encerramento:", err);
      }
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const orderDocRef = doc(db, 'orders', orderId);
      await updateDoc(orderDocRef, { status: newStatus });

      if (newStatus === 'completed' || newStatus === 'cancelled') {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          await checkAndFreeTable(order.tableNumber, orderId);
        }
      }
    } catch (error) {
      console.error("Erro ao atualizar status do pedido:", error);
    }
  };

  const handleMarkAsDelivered = async (order: OrderDocument) => {
    if (!order.id) return;
    try {
      let nextStatus = 'completed';

      // Se for pedido de mesa e ainda não foi pago online (Pix/Cartão):
      if (order.orderType === 'dine_in_table' && 
          order.paymentMethod !== 'pix' && 
          order.paymentMethod !== 'credito') {
        nextStatus = 'delivering'; // Fica como Entregue na Mesa (ativo para fechamento)
      }

      const orderDocRef = doc(db, 'orders', order.id);
      await updateDoc(orderDocRef, {
        status: nextStatus,
        deliveredAt: new Date().toISOString()
      });

      alert('Pedido marcado como entregue!');
    } catch (err) {
      console.error("Erro ao marcar pedido como entregue:", err);
      alert('Erro ao atualizar status do pedido.');
    }
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;
    const reason = cancelReasonOption === 'Outro motivo...' ? customCancelReason.trim() : cancelReasonOption;
    
    if (cancelReasonOption === 'Outro motivo...' && !customCancelReason.trim()) {
      alert('Por favor, informe o motivo do cancelamento.');
      return;
    }

    try {
      const order = orders.find(o => o.id === cancelOrderId);
      const orderDocRef = doc(db, 'orders', cancelOrderId);
      await updateDoc(orderDocRef, {
        status: 'cancelled',
        cancelReason: reason,
        cancelledAt: new Date().toISOString(),
        cancelledBy: userData?.name || userData?.email || 'Admin',
      });

      if (order) {
        await checkAndFreeTable(order.tableNumber, cancelOrderId);
      }

      setCancelOrderId(null);
      setCancelOrderSeq(null);
      setCancelReasonOption('Cliente desistiu do pedido');
      setCustomCancelReason('');
      alert('Pedido cancelado com sucesso!');
    } catch (error) {
      console.error("Erro ao cancelar o pedido:", error);
      alert('Ocorreu um erro ao cancelar o pedido.');
    }
  };

  // Filtragem de pedidos
  const kitchenOrders = orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  const attendingOrders = orders.filter(o => o.status === 'ready');
  const cashierOrders = orders.filter(o => o.status === 'ready');
  const cashierEvaluationOrders = orders.filter(o => o.status === 'aguardando_caixa' || o.status === 'pendente_pagamento');
  const deliveryOrders = orders.filter(o => (o.status === 'ready' || o.status === 'delivering') && o.address);

  const hasAnyFunction = staff && (staff.cook || staff.attendant || staff.cashier || staff.delivery);

  if (loadingOrders) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '250px', margin: '2rem auto' }}>
        <span className="spinner"></span>
        <span>Carregando fila de pedidos...</span>
      </div>
    );
  }

  // Verifica se o usuário tem a função específica liberada
  const getBusinessDay = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      const adjusted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
      const yyyy = adjusted.getFullYear();
      const mm = String(adjusted.getMonth() + 1).padStart(2, '0');
      const dd = String(adjusted.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    } catch {
      return '';
    }
  };

  const getOrderSequenceNumber = (orderId?: string, createdAt?: string): number => {
    if (!orderId || !createdAt) return 1;
    const oDay = getBusinessDay(createdAt);
    const sameDayOrders = orders.filter(o => getBusinessDay(o.createdAt) === oDay);
    const index = sameDayOrders.findIndex(o => o.id === orderId);
    return index !== -1 ? index + 1 : 1;
  };

  const formatOrderHeader = (order: OrderDocument) => {
    const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
    if (userData?.role === 'developer') {
      return `Pedido ${seqNum} (#${order.id?.slice(-4).toUpperCase()})`;
    }
    return `Pedido ${seqNum}`;
  };

  const isAuthorized = (f?: string) => {
    if (userData?.role === 'developer' || userData?.role === 'owner' || userData?.role === 'manager') return true;
    if (!f) return false;
    if (f === 'cook') return staff?.cook;
    if (f === 'attendant') return staff?.attendant;
    if (f === 'cashier') return staff?.cashier;
    if (f === 'delivery') return staff?.delivery;
    return false;
  };

  const isAuthorizedCancel = userData?.role === 'developer' || userData?.role === 'owner' || userData?.role === 'manager';

  return (
    <div className="dashboard-layout animate-fade-in">
      {!hasAnyFunction && userData?.role === 'staff' ? (
        <div className="alert-box" style={{ textAlign: 'center', padding: '2rem' }}>
          <h3>Nenhuma função atribuída ao seu perfil!</h3>
          <p>Solicite ao Administrador para ativar suas permissões (Cozinheiro, Caixa, Atendente ou Entregador) via checkbox no Firestore.</p>
        </div>
      ) : (
        <div className="staff-grid" style={{ gridTemplateColumns: '1fr' }}>
          {/* Fila da Cozinha */}
          {filter === 'cook' && isAuthorized('cook') && (
            <div className="staff-section kitchen-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
              <div className="section-title">
                <ChefHat className="section-icon text-gold" size={24} />
                <h3 style={{ fontSize: '1.4rem' }}>Fila da Cozinha ({kitchenOrders.length} pedidos)</h3>
              </div>
              <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
                {kitchenOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', padding: '1rem', gridColumn: '1 / -1', textAlign: 'center' }}>Sem pedidos pendentes na fila.</p>
                ) : (
                  kitchenOrders.map((order) => (
                    <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                      <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                          <span className="order-badge-status" style={{ backgroundColor: order.status === 'preparing' ? '#d9770615' : 'rgba(255,255,255,0.05)', color: order.status === 'preparing' ? 'var(--primary-gold)' : 'var(--text-secondary)' }}>
                             {order.status === 'preparing' ? 'Preparando' : 'Pendente'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                          {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                          <div>Tipo: <strong style={{ color: '#fff' }}>{getOrderTypeLabel(order)}</strong></div>
                        </div>
                      </div>
                      <div style={{ margin: '1rem 0' }}>
                        {order.items.map((item, index) => (
                          <p key={index} className="order-desc" style={{ fontSize: '1.05rem' }}>{item.quantity}x <strong>{item.name}</strong> - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</p>
                        ))}
                        {(order.deliveryFee ?? 0) > 0 && (
                          <p className="order-desc" style={{ fontSize: '0.9rem', color: 'var(--primary-gold)', fontStyle: 'italic', margin: '0.2rem 0' }}>
                            🛵 Taxa de Entrega: R$ {(order.deliveryFee ?? 0).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                        {(order.serviceFee ?? 0) > 0 && (
                          <p className="order-desc" style={{ fontSize: '0.9rem', color: 'var(--primary-gold)', fontStyle: 'italic', margin: '0.2rem 0' }}>
                            🪑 Taxa de Serviço (10%): R$ {(order.serviceFee ?? 0).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                      </div>
                      {order.address && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '8px', marginBottom: '1rem' }}>
                          Entrega: {order.address.street}, {order.address.number}
                        </div>
                      )}
                      <div className="order-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {order.status === 'pending' ? (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'preparing')} className="btn-small btn-primary" style={{ width: '100%', padding: '0.6rem' }}>
                            <Play size={14} /> Começar Preparo
                          </button>
                        ) : (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'ready')} className="btn-small btn-success" style={{ width: '100%', padding: '0.6rem' }}>
                            <Check size={14} /> Concluído (Enviar ao Balcão)
                          </button>
                        )}
                        {isAuthorizedCancel && (
                          <button type="button" onClick={() => { if (order.id) { setCancelOrderId(order.id); setCancelOrderSeq(order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt)); } }} className="btn-small btn-danger" style={{ width: '100%', padding: '0.6rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            Cancelar Pedido
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Fila do Atendimento */}
          {filter === 'attendant' && isAuthorized('attendant') && (
            <div className="staff-section attendant-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
              <div className="section-title">
                <Bell className="section-icon text-blue" size={24} />
                <h3 style={{ fontSize: '1.4rem' }}>Balcão de Entrega ({attendingOrders.length} prontos)</h3>
              </div>
              <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
                {attendingOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', padding: '1rem', gridColumn: '1 / -1', textAlign: 'center' }}>Nenhum pedido pronto aguardando entrega.</p>
                ) : (
                  attendingOrders.map((order) => (
                    <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                      <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                          <span className="order-badge-status" style={{ backgroundColor: '#10b98115', color: '#10b981' }}>Pronto</span>
                        </div>
                        <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                          {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                          <div>Tipo: <strong style={{ color: '#fff' }}>{getOrderTypeLabel(order)}</strong></div>
                        </div>
                      </div>
                      <div style={{ margin: '1rem 0' }}>
                        {order.items.map((item, index) => (
                          <p key={index} className="order-desc">{item.quantity}x {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</p>
                        ))}
                        {(order.deliveryFee ?? 0) > 0 && (
                          <p className="order-desc" style={{ fontSize: '0.9rem', color: 'var(--primary-gold)', fontStyle: 'italic', margin: '0.2rem 0' }}>
                            🛵 Taxa de Entrega: R$ {(order.deliveryFee ?? 0).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                        {(order.serviceFee ?? 0) > 0 && (
                          <p className="order-desc" style={{ fontSize: '0.9rem', color: 'var(--primary-gold)', fontStyle: 'italic', margin: '0.2rem 0' }}>
                            🪑 Taxa de Serviço (10%): R$ {(order.serviceFee ?? 0).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                      </div>
                      {order.address && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(59, 130, 246, 0.05)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)', marginBottom: '1rem' }}>
                          <Navigation size={12} style={{ display: 'inline', marginRight: '4px' }} />
                          {order.address.street}, {order.address.number} ({order.address.neighborhood})
                        </div>
                      )}
                      <div className="order-actions" style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => order.id && handleMarkAsDelivered(order)}
                          className="btn-small btn-success"
                          style={{
                            flex: 1.5,
                            padding: '0.6rem',
                            background: '#10b981',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.3rem'
                          }}
                        >
                          <Check size={14} style={{ flexShrink: 0 }} /> Entregue
                        </button>
                        {isAuthorizedCancel && (
                          <button
                            type="button"
                            onClick={() => { if (order.id) { setCancelOrderId(order.id); setCancelOrderSeq(order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt)); } }}
                            className="btn-small btn-danger"
                            style={{
                              flex: 1,
                              padding: '0.6rem',
                              background: '#dc2626',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Fila do Caixa */}
          {filter === 'cashier' && isAuthorized('cashier') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', width: '100%' }}>
              
              {/* Seção 1: Aguardando Avaliação no Caixa */}
              <div className="staff-section cashier-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                <div className="section-title">
                  <CreditCard className="section-icon text-emerald" size={24} />
                  <h3 style={{ fontSize: '1.4rem' }}>Aguardando Avaliação no Caixa ({cashierEvaluationOrders.length} pendentes)</h3>
                </div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '0.25rem 0 1rem 0' }}>
                  Pedidos com pagamento físico (dinheiro ou cartão na entrega/retirada) que aguardam baixa manual.
                </p>
                <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                  {cashierEvaluationOrders.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', padding: '1.5rem', gridColumn: '1 / -1', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      Nenhum pedido aguardando avaliação no momento.
                    </p>
                  ) : (
                    cashierEvaluationOrders.map((order) => (
                      <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                        <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                            <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                            <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.1rem' }}>
                              R$ {order.total.toFixed(2).replace('.', ',')}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                            {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                            <div>Tipo: <strong style={{ color: '#fff' }}>{getOrderTypeLabel(order)}</strong></div>
                             <div>Método: <strong style={{ color: 'var(--primary-gold)' }}>{order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : '💴 Cartão (maquininha)'}</strong></div>
                            {order.paymentMethod === 'dinheiro' && order.changeFor && (
                              <div style={{ color: '#ef4444' }}>Troco para: <strong>R$ {order.changeFor.toFixed(2).replace('.', ',')}</strong> (Troco: R$ {(order.changeFor - order.total).toFixed(2).replace('.', ',')})</div>
                            )}
                          </div>
                        </div>
                        <div style={{ margin: '0.75rem 0', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.5rem' }}>
                          {order.items.map((item, index) => (
                            <p key={index} style={{ fontSize: '0.9rem', margin: '0.2rem 0', color: 'var(--text-secondary)' }}>{item.quantity}x {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</p>
                          ))}
                          {(order.deliveryFee ?? 0) > 0 && (
                            <p style={{ fontSize: '0.9rem', margin: '0.2rem 0', color: 'var(--primary-gold)', fontStyle: 'italic' }}>
                              🛵 Taxa de Entrega: R$ {(order.deliveryFee ?? 0).toFixed(2).replace('.', ',')}
                            </p>
                          )}
                          {(order.serviceFee ?? 0) > 0 && (
                            <p style={{ fontSize: '0.9rem', margin: '0.2rem 0', color: 'var(--primary-gold)', fontStyle: 'italic' }}>
                              🪑 Taxa de Serviço (10%): R$ {(order.serviceFee ?? 0).toFixed(2).replace('.', ',')}
                            </p>
                          )}
                          {order.orderType === 'dine_in_table' && (order.serviceFee ?? 0) === 0 && (
                            <p style={{ fontSize: '0.9rem', margin: '0.2rem 0', color: '#ef4444', fontStyle: 'italic' }}>
                              🪑 Taxa de Serviço (10%): Isento/Não cobrado
                            </p>
                          )}
                        </div>
                        <div className="order-actions" style={{ 
                          display: 'grid', 
                          gridTemplateColumns: order.orderType === 'dine_in_table' ? '1fr 1fr 1fr' : '1fr 1fr', 
                          gap: '0.5rem', 
                          marginTop: '0.75rem' 
                        }}>
                          <button 
                            type="button" 
                            onClick={() => handleApproveCashierOrder(order)} 
                            className="btn-small btn-success" 
                            style={{ width: '100%', padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontWeight: 700 }}
                          >
                            ✓ Aprovar
                          </button>
                          {order.orderType === 'dine_in_table' && (
                            (order.serviceFee ?? 0) > 0 ? (
                              <button
                                type="button"
                                onClick={() => handleWaiveServiceFee(order)}
                                className="btn-small"
                                style={{ 
                                  width: '100%', 
                                  padding: '0.6rem', 
                                  background: 'rgba(245, 158, 11, 0.1)', 
                                  color: 'var(--primary-gold)', 
                                  border: '1px dashed var(--primary-gold)', 
                                  borderRadius: '8px', 
                                  cursor: 'pointer', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  gap: '0.3rem', 
                                  fontWeight: 700 
                                }}
                              >
                                Isentar 10%
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleRestoreServiceFee(order)}
                                className="btn-small"
                                style={{ 
                                  width: '100%', 
                                  padding: '0.6rem', 
                                  background: 'rgba(16, 185, 129, 0.1)', 
                                  color: '#10b981', 
                                  border: '1px dashed #10b981', 
                                  borderRadius: '8px', 
                                  cursor: 'pointer', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  gap: '0.3rem', 
                                  fontWeight: 700 
                                }}
                              >
                                Cobrar 10%
                              </button>
                            )
                          )}
                          <button 
                            type="button" 
                            onClick={() => { if (order.id) { setReprovingOrderId(order.id); setReprovingOrderSeq(order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt)); } }} 
                            className="btn-small btn-danger" 
                            style={{ width: '100%', padding: '0.6rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontWeight: 700 }}
                          >
                            ✗ Reprovar
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Seção 2: Fila de Finalização (Pedidos Prontos) */}
              <div className="staff-section cashier-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                <div className="section-title">
                  <Bell className="section-icon text-blue" size={24} />
                  <h3 style={{ fontSize: '1.4rem' }}>Finalização de Pedidos Prontos ({cashierOrders.length} aguardando)</h3>
                </div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '0.25rem 0 1rem 0' }}>
                  Pedidos finalizados na cozinha que aguardam a confirmação de entrega ao cliente.
                </p>
                <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                  {cashierOrders.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', padding: '1.5rem', gridColumn: '1 / -1', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      Nenhum recebimento pendente.
                    </p>
                  ) : (
                    cashierOrders.map((order) => (
                      <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                        <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                            <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                            <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.1rem' }}>
                              R$ {order.total.toFixed(2).replace('.', ',')}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                            {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                          </div>
                        </div>
                        <div className="order-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'completed')} className="btn-small btn-success" style={{ width: '100%', padding: '0.6rem' }}>
                            Confirmar Entrega e Finalizar
                          </button>
                          {isAuthorizedCancel && (
                            <button type="button" onClick={() => { if (order.id) { setCancelOrderId(order.id); setCancelOrderSeq(order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt)); } }} className="btn-small btn-danger" style={{ width: '100%', padding: '0.6rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                              Cancelar Pedido
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Fila de Entregas */}
          {filter === 'delivery' && isAuthorized('delivery') && (
            <div className="staff-section delivery-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
              <div className="section-title">
                <Navigation className="section-icon text-gold" size={24} style={{ color: 'var(--primary-gold)' }} />
                <h3 style={{ fontSize: '1.4rem' }}>Fila de Entregas ({deliveryOrders.length} pendentes)</h3>
              </div>
              <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
                {deliveryOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', padding: '1rem', gridColumn: '1 / -1', textAlign: 'center' }}>Nenhuma entrega pendente.</p>
                ) : (
                  deliveryOrders.map((order) => (
                    <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                      <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                          <span className="order-badge-status" style={{ 
                            backgroundColor: order.status === 'delivering' ? '#3b82f615' : '#10b98115', 
                            color: order.status === 'delivering' ? '#60a5fa' : '#10b981' 
                          }}>
                            {order.status === 'delivering' ? 'Em Rota de Entrega' : 'Pronto para Entrega'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                          {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                        </div>
                      </div>
                      <div style={{ margin: '1rem 0' }}>
                        {order.items.map((item, index) => (
                          <p key={index} className="order-desc" style={{ fontSize: '1.05rem' }}>{item.quantity}x <strong>{item.name}</strong> - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</p>
                        ))}
                        {(order.deliveryFee ?? 0) > 0 && (
                          <p className="order-desc" style={{ fontSize: '0.9rem', color: 'var(--primary-gold)', fontStyle: 'italic', margin: '0.2rem 0' }}>
                            🛵 Taxa de Entrega: R$ {(order.deliveryFee ?? 0).toFixed(2).replace('.', ',')}
                          </p>
                        )}
                      </div>
                      {order.address && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(59, 130, 246, 0.05)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)', marginBottom: '1rem' }}>
                          <Navigation size={12} style={{ display: 'inline', marginRight: '4px' }} />
                          {order.address.street}, {order.address.number} ({order.address.neighborhood})
                          {order.address.complement && <div style={{ fontSize: '0.75rem', marginTop: '2px', opacity: 0.8 }}>Compl: {order.address.complement}</div>}
                        </div>
                      )}
                      <div className="order-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {order.status === 'ready' ? (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'delivering')} className="btn-small btn-primary" style={{ width: '100%', padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <Play size={14} /> Iniciar Entrega
                          </button>
                        ) : (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'completed')} className="btn-small btn-success" style={{ width: '100%', padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <Check size={14} /> Concluir Entrega (Pago)
                          </button>
                        )}
                        {isAuthorizedCancel && (
                          <button type="button" onClick={() => { if (order.id) { setCancelOrderId(order.id); setCancelOrderSeq(order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt)); } }} className="btn-small btn-danger" style={{ width: '100%', padding: '0.6rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            Cancelar Pedido
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Modal de Cancelamento de Pedido */}
      {cancelOrderId && (
        <div
          className="lightbox-overlay"
          onClick={() => { setCancelOrderId(null); setCancelOrderSeq(null); setCustomCancelReason(''); }}
          style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '20px',
              padding: '2rem',
              width: '90%',
              maxWidth: '450px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.2rem',
              position: 'relative'
            }}
          >
            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.3rem' }}>⚠️</div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#ef4444' }}>Cancelar Pedido</h2>
              <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {cancelOrderSeq
                  ? userData?.role === 'developer'
                    ? `Confirme o cancelamento: Pedido ${cancelOrderSeq} (#${cancelOrderId?.slice(-4).toUpperCase()})`
                    : `Confirme o cancelamento: Pedido ${cancelOrderSeq}`
                  : 'Selecione o motivo do cancelamento'
                }
              </p>
            </div>

            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                Motivo do Cancelamento:
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[
                  'Cliente desistiu do pedido',
                  'Ingredientes esgotados / falta de estoque',
                  'Endereço de entrega incorreto / fora da área',
                  'Pedido duplicado / Erro no sistema',
                  'Outro motivo...'
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '10px',
                      border: cancelReasonOption === option ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255,255,255,0.05)',
                      background: cancelReasonOption === option ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      color: cancelReasonOption === option ? '#f87171' : 'var(--text-secondary)',
                      transition: 'all 0.2s'
                    }}
                  >
                    <input
                      type="radio"
                      name="cancelReason"
                      value={option}
                      checked={cancelReasonOption === option}
                      onChange={() => setCancelReasonOption(option)}
                      style={{ accentColor: '#ef4444' }}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>

            {cancelReasonOption === 'Outro motivo...' && (
              <div className="animate-fade-in">
                <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                  Descreva o motivo:
                </label>
                <textarea
                  className="pastel-edit-input"
                  style={{ width: '100%', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', padding: '0.6rem', boxSizing: 'border-box' }}
                  placeholder="Ex: Cliente informou que cadastrou a forma de pagamento errada e vai refazer o pedido."
                  value={customCancelReason}
                  onChange={(e) => setCustomCancelReason(e.target.value)}
                  maxLength={200}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => { setCancelOrderId(null); setCancelOrderSeq(null); setCustomCancelReason(''); }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleCancelOrder}
                style={{
                  flex: 1.5,
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#dc2626',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#b91c1c'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#dc2626'}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Reprovação de Pedido no Caixa */}
      {reprovingOrderId && (
        <div
          className="lightbox-overlay"
          onClick={() => { setReprovingOrderId(null); setReprovingOrderSeq(null); }}
          style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '20px',
              padding: '2rem',
              width: '90%',
              maxWidth: '450px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.2rem',
              position: 'relative'
            }}
          >
            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.3rem' }}>❌</div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#ef4444' }}>Reprovar Pedido no Caixa</h2>
              <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Confirma a reprovação do **Pedido {reprovingOrderSeq}**?
              </p>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: 0, lineHeight: '1.5' }}>
              Ao reprovar a baixa manual, o pedido voltará para o status de pendência original de pagamento e o método de pagamento será reiniciado para nulo. Isso permitirá que o cliente tente efetuar o pagamento novamente usando outro meio (ex: cartão online ou Pix).
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => { setReprovingOrderId(null); setReprovingOrderSeq(null); }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleReproveCashierOrder}
                style={{
                  flex: 1.5,
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#dc2626',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#b91c1c'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#dc2626'}
              >
                Confirmar Reprovação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default StaffDashboard;
