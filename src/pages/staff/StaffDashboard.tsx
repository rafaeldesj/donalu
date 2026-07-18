import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ChefHat, CreditCard, Bell, Play, Check, Navigation, TrendingUp, DollarSign, Clock } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, orderBy, addDoc, getDocs, where, deleteDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { processOrderLoyaltyStamps } from '../../utils/loyalty';
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

  const [selectedCheckoutTable, setSelectedCheckoutTable] = useState<string | null>(null);
  const [selectedCheckoutOrder, setSelectedCheckoutOrder] = useState<OrderDocument | null>(null);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<string>('dinheiro');
  const [checkoutChangeFor, setCheckoutChangeFor] = useState<string>('');

  const [timeFilterHours, setTimeFilterHours] = useState<string>('all_day');
  const [specificDateValue, setSpecificDateValue] = useState<string>(new Date().toISOString().split('T')[0]);
  const [viewingStatsDetailType, setViewingStatsDetailType] = useState<'realized' | 'paid' | 'unpaid' | null>(null);
  const [showDevToolsModal, setShowDevToolsModal] = useState<boolean>(false);
  const [devSelectedClientUid, setDevSelectedClientUid] = useState<string>('');

  const handleApproveCashierOrder = async (order: OrderDocument) => {
    if (!order.id) return;
    try {
      const orderDocRef = doc(db, 'orders', order.id);
      const isTableCheckout = order.orderType === 'dine_in_table';

      const updates: any = {
        status: isTableCheckout ? 'completed' : 'pending'
      };

      if (!isTableCheckout) {
        updates.kitchenEnteredAt = new Date().toISOString();
      } else {
        updates.updatedAt = new Date().toISOString();
      }

      await updateDoc(orderDocRef, updates);

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

      if (isTableCheckout) {
        await checkAndFreeTable(order.tableNumber, order.id);
        await processOrderLoyaltyStamps(order.id, { ...order, status: 'completed' });
        alert('Baixa do fechamento de mesa aprovada com sucesso! O pedido foi finalizado.');
      } else {
        alert('Baixa do pedido aprovada com sucesso! O pedido foi enviado para a cozinha.');
      }
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

  const handleManualTableCheckout = async (tableNum: string, tableOrdersList: OrderDocument[]) => {
    try {
      const batchPromises = tableOrdersList.map(async (order) => {
        if (!order.id) return;
        const orderDocRef = doc(db, 'orders', order.id);
        
        await updateDoc(orderDocRef, {
          status: 'completed',
          paymentMethod: checkoutPaymentMethod,
          changeFor: checkoutPaymentMethod === 'dinheiro' && checkoutChangeFor ? parseFloat(checkoutChangeFor.replace(',', '.')) : null,
          updatedAt: new Date().toISOString()
        });

        await addDoc(collection(db, 'transactions'), {
          orderId: order.id,
          clientName: order.clientName,
          clientUid: order.clientUid,
          total: order.total,
          paymentMethod: checkoutPaymentMethod,
          type: 'baixa_manual',
          approvedBy: userData?.name || userData?.email || 'Caixa',
          createdAt: new Date().toISOString()
        });

        await processOrderLoyaltyStamps(order.id, { ...order, status: 'completed', paymentMethod: checkoutPaymentMethod });
      });

      await Promise.all(batchPromises);
      await checkAndFreeTable(tableNum, undefined);
      
      alert(`Mesa ${tableNum} encerrada e paga com sucesso!`);
      setSelectedCheckoutTable(null);
      setCheckoutChangeFor('');
    } catch (err) {
      console.error("Erro ao encerrar mesa manualmente:", err);
      alert("Erro ao encerrar mesa. Tente novamente.");
    }
  };

  const handleManualOrderCheckout = async (order: OrderDocument) => {
    if (!order.id) return;
    try {
      const orderDocRef = doc(db, 'orders', order.id);
      
      await updateDoc(orderDocRef, {
        status: 'completed',
        paymentMethod: checkoutPaymentMethod,
        changeFor: checkoutPaymentMethod === 'dinheiro' && checkoutChangeFor ? parseFloat(checkoutChangeFor.replace(',', '.')) : null,
        updatedAt: new Date().toISOString()
      });

      await addDoc(collection(db, 'transactions'), {
        orderId: order.id,
        clientName: order.clientName,
        clientUid: order.clientUid,
        total: order.total,
        paymentMethod: checkoutPaymentMethod,
        type: 'baixa_manual',
        approvedBy: userData?.name || userData?.email || 'Caixa',
        createdAt: new Date().toISOString()
      });

      await processOrderLoyaltyStamps(order.id, { ...order, status: 'completed', paymentMethod: checkoutPaymentMethod });
      
      alert(`Pedido finalizado e pago com sucesso!`);
      setSelectedCheckoutOrder(null);
      setCheckoutChangeFor('');
    } catch (err) {
      console.error("Erro ao finalizar pedido manualmente:", err);
      alert("Erro ao finalizar pedido. Tente novamente.");
    }
  };

  const handleDevDeleteOrder = async (orderId: string, seqNum: number | string) => {
    if (userData?.role !== 'developer') return;
    if (!window.confirm(`[DEV] Tem certeza que deseja EXCLUIR permanentemente o Pedido #${seqNum} do histórico?`)) return;
    try {
      await deleteDoc(doc(db, 'orders', orderId));
      alert(`[DEV] Pedido #${seqNum} excluído com sucesso.`);
      setViewingStatsDetailType(null);
    } catch (err) {
      console.error("Erro do desenvolvedor ao excluir pedido:", err);
      alert("Erro ao excluir pedido.");
    }
  };

  const handleDevDeleteTodayHistory = async () => {
    if (userData?.role !== 'developer') return;
    const todayStr = getBusinessDay(new Date().toISOString());
    if (!window.confirm(`[DEV] ATENÇÃO: Você está prestes a EXCLUIR TODOS OS PEDIDOS do dia de trabalho atual (${todayStr.split('-').reverse().join('/')}). Continuar?`)) return;
    if (!window.confirm(`[DEV] CONFIRMAÇÃO FINAL: Deseja realmente apagar todos os registros de hoje? Esta ação é irreversível!`)) return;
    
    try {
      const todayOrders = orders.filter(o => getBusinessDay(o.createdAt) === todayStr);
      const batchPromises = todayOrders.map(async (o) => {
        if (o.id) {
          await deleteDoc(doc(db, 'orders', o.id));
        }
      });
      await Promise.all(batchPromises);
      alert("[DEV] Histórico do dia excluído com sucesso.");
      setShowDevToolsModal(false);
    } catch (err) {
      console.error("Erro do desenvolvedor ao excluir histórico do dia:", err);
      alert("Erro ao excluir histórico do dia.");
    }
  };

  const handleDevDeleteClientHistory = async (clientUid: string, clientName: string) => {
    if (userData?.role !== 'developer') return;
    if (!clientUid) {
      alert("Selecione um cliente válido.");
      return;
    }
    if (!window.confirm(`[DEV] ATENÇÃO: Você está prestes a EXCLUIR TODO O HISTÓRICO de pedidos do cliente "${clientName}". Continuar?`)) return;
    if (!window.confirm(`[DEV] CONFIRMAÇÃO FINAL: Deseja apagar todos os registros de "${clientName}"?`)) return;

    try {
      const ordersRef = collection(db, 'orders');
      const q = query(ordersRef, where('clientUid', '==', clientUid));
      const querySnapshot = await getDocs(q);
      
      const batchPromises = querySnapshot.docs.map(d => deleteDoc(doc(db, 'orders', d.id)));
      await Promise.all(batchPromises);
      
      alert(`[DEV] Todo o histórico de "${clientName}" foi excluído com sucesso.`);
      setDevSelectedClientUid('');
      setShowDevToolsModal(false);
    } catch (err) {
      console.error("Erro do desenvolvedor ao excluir histórico do cliente:", err);
      alert("Erro ao excluir histórico do cliente.");
    }
  };

  const handleDevDeleteAllHistory = async () => {
    if (userData?.role !== 'developer') return;
    if (!window.confirm("[DEV] 🚨🚨🚨 ALERTA CRÍTICO: Você está prestes a APAGAR ABSOLUTAMENTE TODOS OS PEDIDOS DO HISTÓRICO DESDE O INÍCIO DO SISTEMA! Isso apagará todo o faturamento histórico. Deseja continuar?")) return;
    const confirmText = prompt("[DEV] Para confirmar esta ação crítica, digite EXCLUIR_TUDO no campo abaixo:");
    if (confirmText !== 'EXCLUIR_TUDO') {
      alert("Ação cancelada. A frase de confirmação estava incorreta.");
      return;
    }

    try {
      const querySnapshot = await getDocs(collection(db, 'orders'));
      const batchPromises = querySnapshot.docs.map(d => deleteDoc(doc(db, 'orders', d.id)));
      await Promise.all(batchPromises);
      alert("[DEV] Todos os registros de pedidos históricos foram excluídos com sucesso do banco de dados.");
      setShowDevToolsModal(false);
    } catch (err) {
      console.error("Erro do desenvolvedor ao excluir histórico total:", err);
      alert("Erro ao excluir histórico total.");
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
      const updates: any = { status: newStatus };
      if (newStatus === 'ready') {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          const finishedAt = new Date().toISOString();
          const enteredAt = order.kitchenEnteredAt || order.createdAt;
          updates.kitchenFinishedAt = finishedAt;
          if (enteredAt) {
            const durationMs = new Date(finishedAt).getTime() - new Date(enteredAt).getTime();
            updates.kitchenDurationSeconds = Math.max(0, Math.floor(durationMs / 1000));
          }
        }
      }
      await updateDoc(orderDocRef, updates);

      if (newStatus === 'completed' || newStatus === 'cancelled') {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          await checkAndFreeTable(order.tableNumber, orderId);
          if (newStatus === 'completed') {
            await processOrderLoyaltyStamps(orderId, order);
          }
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

      if (nextStatus === 'completed') {
        await processOrderLoyaltyStamps(order.id, { ...order, status: 'completed' });
      }

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
                      <OrderTimer order={order} />
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
          {filter === 'cashier' && isAuthorized('cashier') && (() => {
            const todayStr = getBusinessDay(new Date().toISOString());
            let todayOrders = orders.filter(o => o.status !== 'cancelled');

            // Lógica de filtragem por tempo estendido / específico
            if (timeFilterHours === 'all_day') {
              todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === todayStr);
            } else if (['1', '2', '3', '4'].includes(timeFilterHours)) {
              const hours = parseInt(timeFilterHours);
              const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
              todayOrders = todayOrders.filter(o => 
                getBusinessDay(o.createdAt) === todayStr && 
                new Date(o.createdAt).getTime() >= cutoffTime
              );
            } else if (timeFilterHours === '3_days') {
              const cutoffTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
              todayOrders = todayOrders.filter(o => new Date(o.createdAt).getTime() >= cutoffTime);
            } else if (timeFilterHours === '7_days') {
              const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
              todayOrders = todayOrders.filter(o => new Date(o.createdAt).getTime() >= cutoffTime);
            } else if (timeFilterHours === '30_days') {
              const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
              todayOrders = todayOrders.filter(o => new Date(o.createdAt).getTime() >= cutoffTime);
            } else if (timeFilterHours === 'specific_date') {
              if (specificDateValue) {
                todayOrders = todayOrders.filter(o => o.createdAt.startsWith(specificDateValue));
              } else {
                todayOrders = [];
              }
            }

            // Pedidos pagos de hoje (tanto finalizados quanto ativos pagos online)
            const paidTodayOrders = todayOrders.filter(o => 
              o.status === 'completed' || 
              ['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
            );
            const totalPaidTodayValue = paidTodayOrders.reduce((sum, o) => sum + o.total, 0);

            // Pedidos não pagos de hoje (ativos com métodos físicos ou pagar no final)
            const unpaidTodayOrders = todayOrders.filter(o => 
              o.status !== 'completed' && 
              !['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
            );
            const totalUnpaidTodayValue = unpaidTodayOrders.reduce((sum, o) => sum + o.total, 0);
            
            // Total Geral de hoje (Vendas realizadas = Pagas + Pendentes)
            const totalRealizedTodayValue = totalPaidTodayValue + totalUnpaidTodayValue;

            // Agrupamento de mesas não pagas
            const unpaidTablesMap: { [table: string]: { total: number; count: number; clientNames: string[] } } = {};
            unpaidTodayOrders.forEach(o => {
              if (o.orderType === 'dine_in_table' && o.tableNumber) {
                if (!unpaidTablesMap[o.tableNumber]) {
                  unpaidTablesMap[o.tableNumber] = { total: 0, count: 0, clientNames: [] };
                }
                unpaidTablesMap[o.tableNumber].total += o.total;
                unpaidTablesMap[o.tableNumber].count += 1;
                if (!unpaidTablesMap[o.tableNumber].clientNames.includes(o.clientName)) {
                  unpaidTablesMap[o.tableNumber].clientNames.push(o.clientName);
                }
              }
            });

            const unpaidOthers = unpaidTodayOrders.filter(o => o.orderType !== 'dine_in_table');

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', width: '100%' }}>
                
                {/* Painel de Resumo Financeiro do Dia */}
                <div 
                  className="staff-section cashier-summary animate-fade-in" 
                  style={{ 
                    background: 'rgba(255, 255, 255, 0.01)', 
                    border: '1px solid rgba(255, 255, 255, 0.05)', 
                    borderRadius: '20px', 
                    padding: '1.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.25rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h3 style={{ fontSize: '1.3rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
                      <TrendingUp size={22} className="text-gold" style={{ color: 'var(--primary-gold)' }} />
                      Resumo do Caixa (Hoje)
                    </h3>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                      {/* Filtro de Tempo */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <select
                          value={timeFilterHours}
                          onChange={(e) => setTimeFilterHours(e.target.value)}
                          style={{ 
                            padding: '0.4rem 0.6rem', 
                            borderRadius: '8px', 
                            background: '#0b0f19', 
                            border: '1px solid rgba(255,255,255,0.1)', 
                            color: '#fff', 
                            fontSize: '0.85rem',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="all_day">Hoje (Todo o dia)</option>
                          <option value="1">Última 1 hora</option>
                          <option value="2">Últimas 2 horas</option>
                          <option value="3">Últimas 3 horas</option>
                          <option value="4">Últimas 4 horas</option>
                          <option value="3_days">Últimos 3 dias</option>
                          <option value="7_days">Última semana</option>
                          <option value="30_days">Últimos 30 dias</option>
                          <option value="specific_date">Data específica...</option>
                        </select>

                        {timeFilterHours === 'specific_date' && (
                          <input
                            type="date"
                            value={specificDateValue}
                            onChange={(e) => setSpecificDateValue(e.target.value)}
                            style={{ 
                              padding: '0.4rem 0.6rem', 
                              borderRadius: '8px', 
                              background: '#0b0f19', 
                              border: '1px solid rgba(255,255,255,0.1)', 
                              color: '#fff', 
                              fontSize: '0.85rem',
                              cursor: 'pointer'
                            }}
                          />
                        )}
                      </div>

                      {/* Botão Dev Tools */}
                      {userData?.role === 'developer' && (
                        <button
                          type="button"
                          onClick={() => setShowDevToolsModal(true)}
                          style={{
                            padding: '0.4rem 0.8rem',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            color: '#ef4444',
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}
                        >
                          🔧 Ferramentas Dev
                        </button>
                      )}

                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Dia de Trabalho: <strong style={{ color: '#fff' }}>{todayStr.split('-').reverse().join('/')}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Grid de Cards de Estatísticas */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                    
                    {/* Card 1: Total Realizado */}
                    <div 
                      onClick={() => setViewingStatsDetailType('realized')}
                      style={{ 
                        background: 'rgba(255,255,255,0.02)', 
                        border: '1px solid rgba(255,255,255,0.04)', 
                        borderRadius: '16px', 
                        padding: '1.25rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem',
                        cursor: 'pointer',
                        transition: 'transform 0.15s, background 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                    >
                      <div style={{ width: '45px', height: '45px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-gold)', flexShrink: 0 }}>
                        <DollarSign size={22} />
                      </div>
                      <div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Pedidos Realizados</span>
                        <strong style={{ fontSize: '1.35rem', color: '#fff', display: 'block', margin: '2px 0' }}>
                          R$ {totalRealizedTodayValue.toFixed(2).replace('.', ',')}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {todayOrders.length} {todayOrders.length === 1 ? 'pedido' : 'pedidos'}
                        </span>
                      </div>
                    </div>

                    {/* Card 2: Pedidos Pagos */}
                    <div 
                      onClick={() => setViewingStatsDetailType('paid')}
                      style={{ 
                        background: 'rgba(255,255,255,0.02)', 
                        border: '1px solid rgba(255,255,255,0.04)', 
                        borderRadius: '16px', 
                        padding: '1.25rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem',
                        cursor: 'pointer',
                        transition: 'transform 0.15s, background 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                    >
                      <div style={{ width: '45px', height: '45px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', flexShrink: 0 }}>
                        <Check size={22} />
                      </div>
                      <div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Pedidos Pagos</span>
                        <strong style={{ fontSize: '1.35rem', color: '#10b981', display: 'block', margin: '2px 0' }}>
                          R$ {totalPaidTodayValue.toFixed(2).replace('.', ',')}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {paidTodayOrders.length} {paidTodayOrders.length === 1 ? 'pedido' : 'pedidos'}
                        </span>
                      </div>
                    </div>

                    {/* Card 3: Pedidos Não Pagos */}
                    <div 
                      onClick={() => setViewingStatsDetailType('unpaid')}
                      style={{ 
                        background: 'rgba(255,255,255,0.02)', 
                        border: '1px solid rgba(255,255,255,0.04)', 
                        borderRadius: '16px', 
                        padding: '1.25rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem',
                        cursor: 'pointer',
                        transition: 'transform 0.15s, background 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      }}
                    >
                      <div style={{ width: '45px', height: '45px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                        <Clock size={22} />
                      </div>
                      <div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Pendente (A pagar)</span>
                        <strong style={{ fontSize: '1.35rem', color: '#ef4444', display: 'block', margin: '2px 0' }}>
                          R$ {totalUnpaidTodayValue.toFixed(2).replace('.', ',')}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {unpaidTodayOrders.length} {unpaidTodayOrders.length === 1 ? 'pedido' : 'pedidos'}
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Detalhamento de Saldos Não Pagos */}
                  {totalUnpaidTodayValue > 0 && (
                    <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '14px', padding: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Clock size={15} /> Detalhamento de Valores Pendentes
                      </h4>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                        
                        {/* Sub-painel 1: Mesas (Pagar no Final) */}
                        <div>
                          <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>
                            Mesa Consumo (Pagar no Final)
                          </span>
                          {Object.keys(unpaidTablesMap).length === 0 ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                              Nenhuma mesa com consumo pendente.
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              {Object.entries(unpaidTablesMap).map(([tableNum, data]) => (
                                <div 
                                  key={tableNum} 
                                  onClick={() => setSelectedCheckoutTable(tableNum)}
                                  style={{ 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center', 
                                    background: 'rgba(255,255,255,0.02)', 
                                    padding: '0.5rem 0.75rem', 
                                    borderRadius: '8px', 
                                    border: '1px solid rgba(255,255,255,0.03)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-in-out'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(245,158,11,0.06)';
                                    e.currentTarget.style.borderColor = 'rgba(245,158,11,0.25)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)';
                                  }}
                                >
                                  <div style={{ fontSize: '0.85rem' }}>
                                    <strong style={{ color: '#fff' }}>Mesa {tableNum}</strong>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'block' }}>
                                      {data.clientNames.join(', ')} ({data.count} {data.count === 1 ? 'pedido' : 'pedidos'})
                                    </span>
                                  </div>
                                  <strong style={{ color: 'var(--primary-gold)', fontSize: '0.9rem' }}>
                                    R$ {data.total.toFixed(2).replace('.', ',')}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Sub-painel 2: Outros Pedidos (Balcão, Retirada, Entrega) */}
                        <div>
                          <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>
                            Outros Pedidos Pendentes
                          </span>
                          {unpaidOthers.length === 0 ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                              Nenhum outro pedido pendente.
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              {unpaidOthers.map((order) => {
                                const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
                                return (
                                  <div 
                                    key={order.id} 
                                    onClick={() => setSelectedCheckoutOrder(order)}
                                    style={{ 
                                      display: 'flex', 
                                      justifyContent: 'space-between', 
                                      alignItems: 'center', 
                                      background: 'rgba(255,255,255,0.02)', 
                                      padding: '0.5rem 0.75rem', 
                                      borderRadius: '8px', 
                                      border: '1px solid rgba(255,255,255,0.03)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease-in-out'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = 'rgba(245,158,11,0.06)';
                                      e.currentTarget.style.borderColor = 'rgba(245,158,11,0.25)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)';
                                    }}
                                  >
                                    <div style={{ fontSize: '0.85rem' }}>
                                      <strong style={{ color: '#fff' }}>Ped. #{seqNum}</strong>
                                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'block' }}>
                                        {order.clientName} • {getOrderTypeLabel(order)}
                                      </span>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                      <strong style={{ color: '#fff', fontSize: '0.9rem', display: 'block' }}>
                                        R$ {order.total.toFixed(2).replace('.', ',')}
                                      </strong>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--primary-gold)' }}>
                                        {order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'debito' ? '💳 Débito' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : '💴 Outro'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  )}
                </div>

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
                              <div>Método: <strong style={{ color: 'var(--primary-gold)' }}>{order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : order.paymentMethod === 'debito' ? '💳 Débito' : order.paymentMethod === 'debito_point' ? '💴 Débito Maquininha' : order.paymentMethod === 'credito_point' ? '💳 Crédito Maquininha' : '💴 Cartão (maquininha)'}</strong></div>
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
            );
          })()}

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

      {/* Lightbox de Fechamento de Mesa Manual */}
      {selectedCheckoutTable && (() => {
        // Filtrar pedidos pendentes desta mesa
        const todayStr = getBusinessDay(new Date().toISOString());
        const tableUnpaidOrders = orders.filter(o => 
          getBusinessDay(o.createdAt) === todayStr &&
          o.status !== 'completed' &&
          o.status !== 'cancelled' &&
          o.orderType === 'dine_in_table' &&
          o.tableNumber === selectedCheckoutTable &&
          !['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
        );

        const tableTotal = tableUnpaidOrders.reduce((sum, o) => sum + o.total, 0);

        return (
          <div
            className="lightbox-overlay animate-fade-in"
            onClick={() => { setSelectedCheckoutTable(null); setCheckoutChangeFor(''); }}
            style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '24px',
                padding: '2rem',
                width: '90%',
                maxWidth: '520px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                color: '#fff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🍽️ Fechar Conta - Mesa {selectedCheckoutTable}
                </h3>
                <button
                  type="button"
                  onClick={() => { setSelectedCheckoutTable(null); setCheckoutChangeFor(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}
                >
                  ✕
                </button>
              </div>

              {/* Lista de Consumo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '12px' }}>
                {tableUnpaidOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', margin: 0, textAlign: 'center' }}>Nenhum item pendente.</p>
                ) : (
                  tableUnpaidOrders.map((order) => {
                    const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
                    return (
                      <div key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.5rem', marginBottom: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                          <span style={{ color: 'var(--primary-gold)' }}>Pedido #{seqNum}</span>
                          <span>R$ {order.total.toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '0.5rem' }}>
                          {order.items.map((item, idx) => (
                            <div key={idx}>{item.quantity}x {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</div>
                          ))}
                          {(order.serviceFee ?? 0) > 0 && (
                            <div style={{ fontStyle: 'italic', color: 'var(--primary-gold)' }}>🪑 Taxa de Serviço (10%): R$ {order.serviceFee?.toFixed(2).replace('.', ',')}</div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totalizador */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245,158,11,0.05)', border: '1px dashed var(--primary-gold)', borderRadius: '12px', padding: '0.85rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Total Consumido Pendente:</span>
                <strong style={{ fontSize: '1.3rem', color: 'var(--primary-gold)' }}>R$ {tableTotal.toFixed(2).replace('.', ',')}</strong>
              </div>

              {/* Opções de Pagamento */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>Forma de Recebimento</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.4rem' }}>
                    {[
                      ['dinheiro', '💵 Dinheiro'],
                      ['debito', '💳 Débito'],
                      ['credito', '💳 Crédito'],
                      ['debito_point', '💴 Maq. Débito'],
                      ['credito_point', '💳 Maq. Crédito'],
                      ['pix', '🟡 Pix Manual']
                    ].map(([method, label]) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => {
                          setCheckoutPaymentMethod(method);
                          if (method !== 'dinheiro') setCheckoutChangeFor('');
                        }}
                        style={{
                          padding: '0.5rem',
                          borderRadius: '8px',
                          border: checkoutPaymentMethod === method ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.1)',
                          background: checkoutPaymentMethod === method ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
                          color: checkoutPaymentMethod === method ? 'var(--primary-gold)' : '#fff',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {checkoutPaymentMethod === 'dinheiro' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Valor Pago pelo Cliente (Troco para):</label>
                    <input
                      type="text"
                      placeholder="Ex: R$ 50,00"
                      value={checkoutChangeFor}
                      onChange={(e) => setCheckoutChangeFor(e.target.value.replace(/\D/g, ''))}
                      style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.85rem' }}
                    />
                    {checkoutChangeFor && parseFloat(checkoutChangeFor) > tableTotal && (
                      <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '2px', fontWeight: 600 }}>
                        Troco a Devolver: R$ {(parseFloat(checkoutChangeFor) - tableTotal).toFixed(2).replace('.', ',')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Ações */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => { setSelectedCheckoutTable(null); setCheckoutChangeFor(''); }}
                  style={{ flex: 1, padding: '0.7rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => handleManualTableCheckout(selectedCheckoutTable, tableUnpaidOrders)}
                  style={{ flex: 1.5, padding: '0.7rem', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                >
                  Encerrar e Fechar Conta
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Lightbox de Fechamento de Pedido Avulso Manual */}
      {selectedCheckoutOrder && (() => {
        const order = selectedCheckoutOrder;
        const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
        
        return (
          <div
            className="lightbox-overlay animate-fade-in"
            onClick={() => { setSelectedCheckoutOrder(null); setCheckoutChangeFor(''); }}
            style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '24px',
                padding: '2rem',
                width: '90%',
                maxWidth: '500px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                color: '#fff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🛍️ Fechar Pedido #{seqNum} ({order.clientName})
                </h3>
                <button
                  type="button"
                  onClick={() => { setSelectedCheckoutOrder(null); setCheckoutChangeFor(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}
                >
                  ✕
                </button>
              </div>

              {/* Lista de Itens */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '12px', fontSize: '0.85rem' }}>
                {order.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{item.quantity}x {item.name}</span>
                    <span>R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</span>
                  </div>
                ))}
                {(order.deliveryFee ?? 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontStyle: 'italic', color: 'var(--primary-gold)' }}>
                    <span>🛵 Taxa de Entrega</span>
                    <span>R$ {order.deliveryFee?.toFixed(2).replace('.', ',')}</span>
                  </div>
                )}
                {(order.serviceFee ?? 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontStyle: 'italic', color: 'var(--primary-gold)' }}>
                    <span>🪑 Taxa de Serviço (10%)</span>
                    <span>R$ {order.serviceFee?.toFixed(2).replace('.', ',')}</span>
                  </div>
                )}
              </div>

              {/* Totalizador */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245,158,11,0.05)', border: '1px dashed var(--primary-gold)', borderRadius: '12px', padding: '0.85rem' }}>
                <span style={{ fontWeight: 600 }}>Total do Pedido:</span>
                <strong style={{ fontSize: '1.3rem', color: 'var(--primary-gold)' }}>R$ {order.total.toFixed(2).replace('.', ',')}</strong>
              </div>

              {/* Opções de Pagamento */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>Forma de Recebimento</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.4rem' }}>
                    {[
                      ['dinheiro', '💵 Dinheiro'],
                      ['debito', '💳 Débito'],
                      ['credito', '💳 Crédito'],
                      ['debito_point', '💴 Maq. Débito'],
                      ['credito_point', '💳 Maq. Crédito'],
                      ['pix', '🟡 Pix Manual']
                    ].map(([method, label]) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => {
                          setCheckoutPaymentMethod(method);
                          if (method !== 'dinheiro') setCheckoutChangeFor('');
                        }}
                        style={{
                          padding: '0.5rem',
                          borderRadius: '8px',
                          border: checkoutPaymentMethod === method ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.1)',
                          background: checkoutPaymentMethod === method ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
                          color: checkoutPaymentMethod === method ? 'var(--primary-gold)' : '#fff',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: 'pointer'
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {checkoutPaymentMethod === 'dinheiro' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Valor Pago pelo Cliente (Troco para):</label>
                    <input
                      type="text"
                      placeholder="Ex: R$ 50,00"
                      value={checkoutChangeFor}
                      onChange={(e) => setCheckoutChangeFor(e.target.value.replace(/\D/g, ''))}
                      style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.85rem' }}
                    />
                    {checkoutChangeFor && parseFloat(checkoutChangeFor) > order.total && (
                      <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '2px', fontWeight: 600 }}>
                        Troco a Devolver: R$ {(parseFloat(checkoutChangeFor) - order.total).toFixed(2).replace('.', ',')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Ações */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => { setSelectedCheckoutOrder(null); setCheckoutChangeFor(''); }}
                  style={{ flex: 1, padding: '0.7rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => handleManualOrderCheckout(order)}
                  style={{ flex: 1.5, padding: '0.7rem', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                >
                  Registrar Pagamento
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Lightbox do Detalhamento das Estatísticas de Pedidos */}
      {viewingStatsDetailType && (() => {
        const todayStr = getBusinessDay(new Date().toISOString());
        let filteredOrders = orders.filter(o => o.status !== 'cancelled');

        // Aplicar a mesma lógica de filtros temporais
        if (timeFilterHours === 'all_day') {
          filteredOrders = filteredOrders.filter(o => getBusinessDay(o.createdAt) === todayStr);
        } else if (['1', '2', '3', '4'].includes(timeFilterHours)) {
          const hours = parseInt(timeFilterHours);
          const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
          filteredOrders = filteredOrders.filter(o => 
            getBusinessDay(o.createdAt) === todayStr && 
            new Date(o.createdAt).getTime() >= cutoffTime
          );
        } else if (timeFilterHours === '3_days') {
          const cutoffTime = Date.now() - 3 * 24 * 60 * 60 * 1000;
          filteredOrders = filteredOrders.filter(o => new Date(o.createdAt).getTime() >= cutoffTime);
        } else if (timeFilterHours === '7_days') {
          const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
          filteredOrders = filteredOrders.filter(o => new Date(o.createdAt).getTime() >= cutoffTime);
        } else if (timeFilterHours === '30_days') {
          const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
          filteredOrders = filteredOrders.filter(o => new Date(o.createdAt).getTime() >= cutoffTime);
        } else if (timeFilterHours === 'specific_date') {
          if (specificDateValue) {
            filteredOrders = filteredOrders.filter(o => o.createdAt.startsWith(specificDateValue));
          } else {
            filteredOrders = [];
          }
        }

        // Sub-filtrar dependendo do card clicado
        if (viewingStatsDetailType === 'paid') {
          filteredOrders = filteredOrders.filter(o => 
            o.status === 'completed' || 
            ['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
          );
        } else if (viewingStatsDetailType === 'unpaid') {
          filteredOrders = filteredOrders.filter(o => 
            o.status !== 'completed' && 
            !['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
          );
        }

        const titleMap = {
          realized: 'Pedidos Realizados (Hoje)',
          paid: 'Pedidos Pagos (Hoje)',
          unpaid: 'Pedidos Pendentes (Hoje)'
        };

        return (
          <div
            className="lightbox-overlay animate-fade-in"
            onClick={() => setViewingStatsDetailType(null)}
            style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '24px',
                padding: '2rem',
                width: '95%',
                maxWidth: '650px',
                maxHeight: '85vh',
                boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                color: '#fff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  📊 Detalhes: {titleMap[viewingStatsDetailType]}
                </h3>
                <button
                  type="button"
                  onClick={() => setViewingStatsDetailType(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}
                >
                  ✕
                </button>
              </div>

              {/* Lista de Pedidos */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {filteredOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', margin: '2rem 0', textAlign: 'center' }}>Nenhum pedido correspondente encontrado.</p>
                ) : (
                  filteredOrders.map((order) => {
                    const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
                    const orderTimeStr = new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div 
                        key={order.id} 
                        style={{ 
                          background: 'rgba(255,255,255,0.02)', 
                          border: '1px solid rgba(255,255,255,0.04)', 
                          borderRadius: '12px', 
                          padding: '1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <strong style={{ color: 'var(--primary-gold)', fontSize: '0.95rem' }}>Pedido #{seqNum}</strong>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>({orderTimeStr})</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <strong style={{ fontSize: '1.05rem', color: '#fff' }}>R$ {order.total.toFixed(2).replace('.', ',')}</strong>
                            {userData?.role === 'developer' && (
                              <button
                                type="button"
                                onClick={() => handleDevDeleteOrder(order.id!, seqNum)}
                                title="[DEV] Excluir Pedido"
                                style={{
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: '8px',
                                  padding: '0.35rem 0.6rem',
                                  color: '#ef4444',
                                  fontWeight: 700,
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  marginLeft: '1rem',
                                  transition: 'background 0.2s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                              >
                                🗑️ Excluir
                              </button>
                            )}
                          </div>
                        </div>

                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.75rem' }}>
                          <span>Cliente: <strong style={{ color: '#fff' }}>{order.clientName}</strong></span>
                          <span>•</span>
                          <span>Tipo: <strong style={{ color: '#fff' }}>{getOrderTypeLabel(order)}</strong></span>
                          <span>•</span>
                          <span>Pagamento: <strong style={{ color: '#fff' }}>{order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'debito' ? '💳 Débito' : order.paymentMethod === 'credito' ? '💳 Crédito' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : order.paymentMethod || 'Não definido'}</strong></span>
                        </div>

                        {/* Itens */}
                        <div style={{ fontSize: '0.82rem', background: 'rgba(0,0,0,0.15)', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                          {order.items.map((item, idx) => (
                            <div key={idx} style={{ color: 'var(--text-secondary)' }}>
                              <span style={{ color: '#fff', fontWeight: 600 }}>{item.quantity}x</span> {item.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setViewingStatsDetailType(null)}
                  style={{
                    padding: '0.6rem 1.5rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Fechar
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Lightbox de Ferramentas de Exclusão do Desenvolvedor (Dev Tools) */}
      {showDevToolsModal && userData?.role === 'developer' && (() => {
        // Obter lista única de clientes a partir de todos os pedidos carregados
        const uniqueClientsMap = new Map<string, string>();
        orders.forEach(o => {
          if (o.clientUid && o.clientName) {
            uniqueClientsMap.set(o.clientUid, o.clientName);
          }
        });
        const uniqueClientsList = Array.from(uniqueClientsMap.entries()).map(([uid, name]) => ({ uid, name }));

        return (
          <div
            className="lightbox-overlay animate-fade-in"
            onClick={() => { setShowDevToolsModal(false); setDevSelectedClientUid(''); }}
            style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '24px',
                padding: '2rem',
                width: '90%',
                maxWidth: '520px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.9)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.5rem',
                color: '#fff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(239,68,68,0.2)', paddingBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔧 Painel do Desenvolvedor (Dev Tools)
                </h3>
                <button
                  type="button"
                  onClick={() => { setShowDevToolsModal(false); setDevSelectedClientUid(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}
                >
                  ✕
                </button>
              </div>

              {/* Banner de Aviso Crítico */}
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '1rem', fontSize: '0.85rem', color: '#ef4444', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>🚨 ATENÇÃO OPERAÇÕES CRÍTICAS</strong>
                <span>Qualquer exclusão realizada aqui apaga os registros diretamente no banco de dados Firestore. Ações são permanentes e irreversíveis!</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Ação 1: Excluir todo o histórico do dia */}
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>1. Histórico do Dia Atual</span>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Apaga todos os pedidos cadastrados no dia de trabalho de hoje (excluindo os já cancelados).</p>
                  <button
                    type="button"
                    onClick={handleDevDeleteTodayHistory}
                    style={{
                      padding: '0.5rem',
                      background: '#dc2626',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#b91c1c'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#dc2626'}
                  >
                    Excluir Todo o Histórico de Hoje
                  </button>
                </div>

                {/* Ação 2: Excluir histórico de cliente específico */}
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>2. Histórico de Cliente Específico</span>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Remove todos os pedidos associados ao cliente escolhido abaixo de todo o histórico do sistema.</p>
                  
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
                    <select
                      value={devSelectedClientUid}
                      onChange={(e) => setDevSelectedClientUid(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        borderRadius: '8px',
                        background: '#0b0f19',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontSize: '0.85rem'
                      }}
                    >
                      <option value="">-- Selecione o Cliente --</option>
                      {uniqueClientsList.map(c => (
                        <option key={c.uid} value={c.uid}>{c.name}</option>
                      ))}
                    </select>
                    
                    <button
                      type="button"
                      disabled={!devSelectedClientUid}
                      onClick={() => handleDevDeleteClientHistory(devSelectedClientUid, uniqueClientsMap.get(devSelectedClientUid) || '')}
                      style={{
                        padding: '0.5rem 0.85rem',
                        background: devSelectedClientUid ? '#dc2626' : 'rgba(255,255,255,0.05)',
                        border: 'none',
                        borderRadius: '8px',
                        color: devSelectedClientUid ? '#fff' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: devSelectedClientUid ? 'pointer' : 'not-allowed',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => { if (devSelectedClientUid) e.currentTarget.style.background = '#b91c1c'; }}
                      onMouseLeave={(e) => { if (devSelectedClientUid) e.currentTarget.style.background = '#dc2626'; }}
                    >
                      Excluir
                    </button>
                  </div>
                </div>

                {/* Ação 3: Excluir todo o histórico geral */}
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#ef4444' }}>3. Reset Completo (Limpeza Geral)</span>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Apaga absolutamente todos os pedidos armazenados na coleção 'orders' de todos os tempos.</p>
                  <button
                    type="button"
                    onClick={handleDevDeleteAllHistory}
                    style={{
                      padding: '0.5rem',
                      background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      cursor: 'pointer'
                    }}
                  >
                    Excluir Todo o Histórico (Desde o Início)
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => { setShowDevToolsModal(false); setDevSelectedClientUid(''); }}
                  style={{
                    flex: 1,
                    padding: '0.7rem',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Voltar
                </button>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
};
export default StaffDashboard;

const OrderTimer = ({ order }: { order: OrderDocument }) => {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const startTimeStr = order.kitchenEnteredAt || order.createdAt;
    if (!startTimeStr) {
      setElapsed('00:00');
      return;
    }

    const start = new Date(startTimeStr).getTime();

    if (order.kitchenFinishedAt) {
      const end = new Date(order.kitchenFinishedAt).getTime();
      const diff = Math.max(0, end - start);
      setElapsed(formatDuration(diff));
      return;
    }

    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = Math.max(0, now - start);
      setElapsed(formatDuration(diff));
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [order.kitchenEnteredAt, order.createdAt, order.kitchenFinishedAt]);

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    return [
      hours > 0 ? String(hours).padStart(2, '0') : null,
      String(minutes).padStart(2, '0'),
      String(seconds).padStart(2, '0')
    ].filter(Boolean).join(':');
  };

  const entryTime = new Date(order.kitchenEnteredAt || order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{
      marginTop: '0.75rem',
      fontSize: '0.85rem',
      color: 'var(--text-secondary)',
      background: 'rgba(255, 255, 255, 0.02)',
      padding: '0.6rem 0.8rem',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.05)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.2rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Entrada na Cozinha:</span>
        <strong style={{ color: '#fff' }}>{entryTime}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Tempo decorrido:</span>
        <strong style={{ color: order.kitchenFinishedAt ? '#10b981' : 'var(--primary-gold)', fontFamily: 'monospace', fontSize: '0.95rem' }}>
          {order.kitchenFinishedAt ? '✅ ' : '⏱️ '}{elapsed}
        </strong>
      </div>
    </div>
  );
};

