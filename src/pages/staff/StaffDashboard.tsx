import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ChefHat, CreditCard, Bell, Play, Check, Navigation, TrendingUp, DollarSign, Clock, Printer, CheckCircle } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, orderBy, addDoc, getDocs, getDoc, where, deleteDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { logAuditAction } from '../../utils/audit';
import { processOrderLoyaltyStamps } from '../../utils/loyalty';
import type { OrderDocument } from '../../types/order';
import { printOrder, getPrinterSettings, printTableBill, printPaymentReceipt } from '../../utils/printer';
import { API_BASE_URL } from '../../config/api';
import { FeeBreakdown } from '../../components/FeeBreakdown';

interface StaffDashboardProps {
  filter?: 'cook' | 'attendant' | 'cashier' | 'delivery' | 'mercadopago';
}

export const StaffDashboard = ({ filter }: StaffDashboardProps) => {
  const { user, userData } = useAuth();
  const staff = userData?.staffFunctions;

  const getOrderTypeLabel = (order: any) => {
    if (order.orderType === 'delivery') return '🛵 Entrega';
    if (order.orderType === 'dine_in') return `🍽️ Balcão${order.packForTakeout ? ' (Para Viagem)' : ''}`;
    if (order.orderType === 'dine_in_table') return `🪑 Mesa ${order.tableNumber || '?'}`;
    if (order.orderType === 'pickup') return '🏪 Retirada (Para Viagem)';
    return order.address ? '🛵 Entrega' : '🏪 Retirada';
  };

  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const pendingAudioRef = useRef<HTMLAudioElement | null>(null);
  const preparingAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingTimeoutRef = useRef<any>(null);
  const preparingTimeoutRef = useRef<any>(null);
  const watchdogIntervalRef = useRef<any>(null);
  const silentAudioCtxRef = useRef<AudioContext | null>(null);
  const [volumePending, setVolumePending] = useState<number>(0.8);
  const [volumePreparing, setVolumePreparing] = useState<number>(0.8);
  
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
  const [partialPayments, setPartialPayments] = useState<{ method: string, amount: number, id: string, payerName?: string }[]>([]);
  const [partialPaymentInputAmount, setPartialPaymentInputAmount] = useState<string>('');
  const [partialPaymentInputName, setPartialPaymentInputName] = useState<string>('');
  // Client selection inside table checkout modal (multi-select)
  const [checkoutSelectedClients, setCheckoutSelectedClients] = useState<string[]>([]);
  // Mercado Pago Point states for operator checkout
  const [storeConfig, setStoreConfig] = useState<any>(null);
  const [pointPaymentStatus, setPointPaymentStatus] = useState<'idle' | 'pending' | 'approved' | 'rejected'>('idle');
  const [pointIntentId, setPointIntentId] = useState<string>('');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [pointDeviceLabel, setPointDeviceLabel] = useState<string>('');
  const [pointPaymentLoading, setPointPaymentLoading] = useState<boolean>(false);
  const [pointPaymentError, setPointPaymentError] = useState<string | null>(null);
  const [pendingPointAmount, setPendingPointAmount] = useState<number>(0);
  const [pendingPointMethod, setPendingPointMethod] = useState<string>('');

  const [timeFilterHours, setTimeFilterHours] = useState<string>('all_day');
  const [specificDateValue, setSpecificDateValue] = useState<string>(new Date().toISOString().split('T')[0]);
  const [viewingStatsDetailType, setViewingStatsDetailType] = useState<'realized' | 'paid' | 'unpaid' | null>(null);
  const [viewingReceiptDetails, setViewingReceiptDetails] = useState<{ title: string; orders: OrderDocument[] } | null>(null);
  const [refundLoading, setRefundLoading] = useState<boolean>(false);
  const [showDevToolsModal, setShowDevToolsModal] = useState<boolean>(false);
  const [devSelectedClientUid, setDevSelectedClientUid] = useState<string>('');
  const [deliverers, setDeliverers] = useState<any[]>([]);
  const [selectedDelivererMap, setSelectedDelivererMap] = useState<Record<string, string>>({});

  // Dynamically initialize multi-selected checkout clients for the selected table
  useEffect(() => {
    if (selectedCheckoutTable) {
      const allTableOrders = orders.filter(o =>
        o.status !== 'completed' &&
        o.status !== 'cancelled' &&
        o.orderType === 'dine_in_table' &&
        o.tableNumber === selectedCheckoutTable &&
        !['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
      );
      const uniqueNames = Array.from(new Set(allTableOrders.map(o => o.clientName).filter(Boolean))) as string[];
      setCheckoutSelectedClients(uniqueNames);
    } else {
      setCheckoutSelectedClients([]);
    }
  }, [selectedCheckoutTable, orders]);

  // Reset checkout payment method if it becomes invisible for staff
  useEffect(() => {
    if (!storeConfig) return;
    const visConfig = storeConfig.paymentMethodsVisibility || {};
    const isMethodAllowed = (id: string) => {
      let key = id;
      if (id === 'maq_pix') key = 'pix';
      else if (id === 'maq_debito') key = 'debito_point';
      else if (id === 'maq_credito') key = 'credito_point';
      else if (id === 'debito' || id === 'credito') key = 'cartao';
      const vis = visConfig[key] || 'both';
      return vis === 'staff' || vis === 'both';
    };

    if (!isMethodAllowed(checkoutPaymentMethod)) {
      const defaultOrder = ['dinheiro', 'maq_pix', 'maq_debito', 'maq_credito', 'debito', 'credito', 'debito_point', 'credito_point', 'pix'];
      const allowed = defaultOrder.find(m => isMethodAllowed(m));
      if (allowed) {
        setCheckoutPaymentMethod(allowed);
      }
    }
  }, [storeConfig, checkoutPaymentMethod]);

  const handleAssignDeliverer = async (orderId: string, delivererId: string) => {
    if (!delivererId) {
      alert('Selecione um entregador.');
      return;
    }
    const deliverer = deliverers.find(d => d.uid === delivererId);
    if (!deliverer) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'delivering',
        deliveryUid: deliverer.uid,
        deliveryName: deliverer.name || deliverer.displayName || deliverer.email || 'Entregador',
        dispatchedAt: new Date().toISOString()
      });

      if (userData) {
        await logAuditAction({
          userId: userData.uid || '',
          userEmail: userData.email || '',
          userName: userData.name || 'Funcionário',
          actionType: 'ORDER_DISPATCH',
          title: 'Pedido Despachado',
          description: `Despachou o pedido para o entregador "${deliverer.name || 'Entregador'}" (Pedido ID: "${orderId}").`,
          userRole: userData.role || 'staff',
          metadata: { orderId, delivererId, delivererName: deliverer.name }
        });
      }
    } catch (err) {
      console.error('Erro ao atribuir entregador:', err);
      alert('Erro ao atribuir entregador.');
    }
  };

  const handleRemoveDeliverer = async (orderId: string) => {
    if (!window.confirm('Tem certeza que deseja retirar o entregador deste pedido e enviá-lo de volta ao balcão?')) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'ready',
        deliveryUid: null,
        deliveryName: null,
        deliveryCoords: null,
        dispatchedAt: null
      });
      alert('Entregador removido. O pedido voltou ao balcão de entrega.');
    } catch (err) {
      console.error('Erro ao remover entregador:', err);
      alert('Erro ao remover entregador.');
    }
  };

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
      const isMultiPayment = partialPayments.length > 1;
      const finalMethod = isMultiPayment ? 'multiplo' : (partialPayments.length === 1 ? partialPayments[0].method : checkoutPaymentMethod);
      
      const storedMethod = finalMethod === 'maq_pix' ? 'pix'
        : finalMethod === 'maq_debito' ? 'debito'
        : finalMethod === 'maq_credito' ? 'credito'
        : finalMethod;

      const mappedPartialPayments = partialPayments.map(p => ({
        ...p,
        method: p.method === 'maq_pix' ? 'pix' : p.method === 'maq_debito' ? 'debito' : p.method === 'maq_credito' ? 'credito' : p.method
      }));

      const batchPromises = tableOrdersList.map(async (order) => {
        if (!order.id) return;
        const orderDocRef = doc(db, 'orders', order.id);
        
        const updates: any = {
          status: 'completed',
          paymentMethod: storedMethod,
          payments: mappedPartialPayments.length > 0 ? mappedPartialPayments : [{ method: storedMethod, amount: order.total }],
          changeFor: storedMethod === 'dinheiro' && checkoutChangeFor ? parseFloat(checkoutChangeFor.replace(',', '.')) : null,
          updatedAt: new Date().toISOString()
        };

        if (pointIntentId && ['maq_pix', 'maq_debito', 'maq_credito'].includes(checkoutPaymentMethod)) {
          updates.pointPaymentIntentId = pointIntentId;
        }

        await updateDoc(orderDocRef, updates);

        await addDoc(collection(db, 'transactions'), {
          orderId: order.id,
          clientName: order.clientName,
          clientUid: order.clientUid,
          total: order.total,
          paymentMethod: storedMethod,
          payments: mappedPartialPayments.length > 0 ? mappedPartialPayments : [{ method: storedMethod, amount: order.total }],
          type: 'baixa_manual',
          approvedBy: userData?.name || userData?.email || 'Caixa',
          createdAt: new Date().toISOString()
        });

        await processOrderLoyaltyStamps(order.id, { ...order, status: 'completed', paymentMethod: storedMethod });
      });

      await Promise.all(batchPromises);
      await checkAndFreeTable(tableNum, undefined);
      
      const todayStr = getBusinessDay(new Date().toISOString());
      const allTableOrders = orders.filter(o =>
        getBusinessDay(o.createdAt) === todayStr &&
        o.status !== 'completed' &&
        o.status !== 'cancelled' &&
        o.orderType === 'dine_in_table' &&
        o.tableNumber === tableNum &&
        !['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
      );
      const clientsAtTable = Array.from(new Set(allTableOrders.map(o => o.clientName).filter(Boolean))) as string[];
      const isMesaCompleta = checkoutSelectedClients.length === clientsAtTable.length;
      const clientLabel = isMesaCompleta ? '' : ` (conta de: ${checkoutSelectedClients.join(', ')})`;

      alert(`Mesa ${tableNum}${clientLabel} encerrada e paga com sucesso!`);
      setSelectedCheckoutTable(null);
      setCheckoutChangeFor('');
      setCheckoutSelectedClients([]);
      setPointPaymentStatus('idle');
      setPointIntentId('');
      setPointPaymentError(null);
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
      try {
        await deleteDoc(doc(db, 'orders', orderId));
      } catch (err: any) {
        if (err?.code === 'not-found' || err?.message?.includes('No document to update') || true) {
          const q = query(collection(db, 'orders'), where('id', '==', orderId));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const batchPromises = snap.docs.map(d => deleteDoc(doc(db, 'orders', d.id)));
            await Promise.all(batchPromises);
          } else {
            throw err;
          }
        }
      }
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
      const bStart = new Date();
      bStart.setHours(0,0,0,0);
      const q = query(collection(db, 'orders'), where('createdAt', '>=', bStart.toISOString()));
      const snap = await getDocs(q);
      const batchPromises = snap.docs.map(d => deleteDoc(doc(db, 'orders', d.id)));
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

  const handleRefundReceipt = async (ordersToRefund: OrderDocument[]) => {
    // Busca um pagamento online válido
    const orderWithPayment = ordersToRefund.find(o => 
      o.mercadoPagoPaymentId || o.mercadoPagoOrderId || o.stonePaymentId || 
      (o.payments && o.payments.some((p: any) => p.id && ['pix', 'credito', 'credito_mp', 'google_pay'].includes(p.method)))
    );

    if (!orderWithPayment) {
      alert("Não foi encontrado um ID de pagamento online nesta conta para realizar o estorno.");
      return;
    }

    let paymentId: string | number | undefined = orderWithPayment.mercadoPagoPaymentId || orderWithPayment.mercadoPagoOrderId || orderWithPayment.stonePaymentId;
    if (!paymentId && orderWithPayment.payments) {
      const onlinePmt = orderWithPayment.payments.find((p: any) => p.id && ['pix', 'credito', 'credito_mp', 'google_pay'].includes(p.method));
      if (onlinePmt) paymentId = onlinePmt.id;
    }

    const totalToRefund = ordersToRefund.reduce((sum, o) => sum + o.total, 0);
    const isStone = (orderWithPayment.paymentMethod?.includes('stone') || (typeof paymentId === 'string' && (paymentId.startsWith('or_') || paymentId.includes('STONE_PIX_MOCK'))));
    const providerName = isStone ? 'Stone' : 'Mercado Pago';

    if (!window.confirm(`Tem certeza que deseja estornar R$ ${totalToRefund.toFixed(2).replace('.', ',')} na ${providerName}?`)) {
      return;
    }

    setRefundLoading(true);
    try {
      const storeConfigRef = doc(db, 'settings', 'store_config');
      const storeConfigSnap = await getDoc(storeConfigRef);
      const storeConfigData = storeConfigSnap.exists() ? storeConfigSnap.data() : null;
      
      const token = isStone 
        ? (storeConfigData?.stoneAccessToken || 'mock')
        : (storeConfigData?.storeOwnerAccessToken || storeConfigData?.devAccessToken || 'mock');

      const devToken = storeConfigData?.devAccessToken || 'mock';

      const endpoint = isStone 
        ? `${API_BASE_URL}/api/pagamentos/stone-refund`
        : `${API_BASE_URL}/api/pagamentos/refund-payment`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: paymentId,
          token: token,
          devToken: devToken
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message + ` [DEBUG: ID=${paymentId}, Token=${token ? token.substring(0,15) : 'none'}...]`);
      }

      // Marcar todos os pedidos como estornados
      const batchPromises = ordersToRefund.map(async (o) => {
        const orderDocRef = doc(db, 'orders', o.id!);
        await updateDoc(orderDocRef, {
          refunded: true,
          refundedAt: new Date().toISOString(),
          refundedBy: userData?.name || 'Sistema',
          updatedAt: new Date().toISOString()
        });
      });
      await Promise.all(batchPromises);

      await logAuditAction({
        userId: user?.uid || 'guest',
        userEmail: user?.email || 'anonimo@donalu.web.app',
        userName: userData?.name || 'Staff',
        actionType: 'PAYMENT_REFUND',
        title: 'Pagamento Estornado',
        description: `Estornou o pagamento de R$ ${totalToRefund.toFixed(2).replace('.', ',')} (ID: "${paymentId}") na ${providerName}.`,
        userRole: userData?.role || 'staff',
        metadata: { total: totalToRefund, paymentId: paymentId, provider: providerName }
      });

      alert(`Pagamento estornado com sucesso na ${providerName}!`);
      
      setViewingReceiptDetails(null);
    } catch (err: any) {
      console.error("Erro ao estornar:", err);
      alert(err.message || 'Erro ao processar o estorno.');
    } finally {
      setRefundLoading(false);
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
        const orderData = docSnap.data() as any;
        if (!orderData.isTest || userData?.role === 'developer') {
          fetchedOrders.push({
            id: docSnap.id,
            ...orderData
          } as OrderDocument);
        }
      });

      setOrders(fetchedOrders);
      setLoadingOrders(false);
    }, (error) => {
      console.error("Erro ao escutar pedidos no Firestore:", error);
      setLoadingOrders(false);
    });

    return () => unsubscribe();
  }, []);

  // Escuta configurações da loja (para Point devices e devPercentage)
  useEffect(() => {
    const docRef = doc(db, 'settings', 'store_config');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setStoreConfig(docSnap.data());
      }
    });
    return () => unsubscribe();
  }, []);

  // Escuta entregadores ativos no sistema
  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        const u = docSnap.data();
        if (u.staffFunctions?.delivery === true) {
          list.push({ uid: docSnap.id, ...u });
        }
      });
      setDeliverers(list);
    });
    return () => unsubscribe();
  }, []);

  // Polling do status de pagamento na Maquininha Point (do caixa)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (pointIntentId && pointPaymentStatus === 'pending') {
      let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
      if (token === 'null' || token === 'undefined' || !token) token = 'mock';
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/pagamentos/check-point-order?intentId=${pointIntentId}&token=${token}`);
          const data = await res.json();
          if (data.success && data.status === 'FINISHED') {
            setPointPaymentStatus('approved');
            clearInterval(interval);
          } else if (data.success && (data.status === 'CANCELED' || data.status === 'ERROR')) {
            setPointPaymentStatus('rejected');
            setPointPaymentError(`Pagamento ${data.status === 'CANCELED' ? 'cancelado' : 'recusado'} na maquininha.`);
            clearInterval(interval);
          }
        } catch (err) {
          console.error('Erro ao verificar status da Point (caixa):', err);
        }
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [pointIntentId, pointPaymentStatus, storeConfig]);

  useEffect(() => {
    if (pointPaymentStatus === 'approved' && pendingPointAmount > 0) {
      setPartialPayments(prev => [
        ...prev,
        { method: pendingPointMethod, amount: pendingPointAmount, id: Date.now().toString(), payerName: partialPaymentInputName }
      ]);
      setPendingPointAmount(0);
      setPointPaymentStatus('idle');
      setPartialPaymentInputAmount('');
      setPartialPaymentInputName('');
    }
  }, [pointPaymentStatus, pendingPointAmount, pendingPointMethod, partialPaymentInputName]);

  // Limpa todos os áudios e timers quando a tela da cozinha é desmontada por completo
  useEffect(() => {
    return () => {
      if (pendingAudioRef.current) {
        pendingAudioRef.current.pause();
      }
      if (preparingAudioRef.current) {
        preparingAudioRef.current.pause();
      }
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }
      if (preparingTimeoutRef.current) {
        clearTimeout(preparingTimeoutRef.current);
      }
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
      }
      if (silentAudioCtxRef.current) {
        silentAudioCtxRef.current.close();
      }
    };
  }, []);

  // Mantém o AudioContext ativo com um oscilador silencioso para evitar
  // que o browser suspenda o áudio durante períodos de ociosidade.
  useEffect(() => {
    if (filter !== 'cook') return;
    try {
      if (!silentAudioCtxRef.current || silentAudioCtxRef.current.state === 'closed') {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, ctx.currentTime); // volume zero - completamente silencioso
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start();
        silentAudioCtxRef.current = ctx;
      } else if (silentAudioCtxRef.current.state === 'suspended') {
        silentAudioCtxRef.current.resume();
      }
    } catch {
      // AudioContext não suportado ou bloqueado - não crítico
    }
    return () => {
      if (silentAudioCtxRef.current && silentAudioCtxRef.current.state !== 'closed') {
        silentAudioCtxRef.current.close();
        silentAudioCtxRef.current = null;
      }
    };
  }, [filter]);


  // Controle de áudio da cozinha movido para o App.tsx global
  useEffect(() => {
    // Desativado localmente para evitar reprodução duplicada
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
      if (newStatus === 'prepared' || newStatus === 'ready') {
        const order = orders.find(o => o.id === orderId);
        if (order && !order.kitchenFinishedAt) {
          const finishedAt = new Date().toISOString();
          const enteredAt = order.kitchenEnteredAt || order.createdAt;
          updates.kitchenFinishedAt = finishedAt;
          if (enteredAt) {
            const durationMs = new Date(finishedAt).getTime() - new Date(enteredAt).getTime();
            updates.kitchenDurationSeconds = Math.max(0, Math.floor(durationMs / 1000));
          }
        }
      }
      try {
        await updateDoc(orderDocRef, updates);
      } catch (err: any) {
        if (err?.code === 'not-found' || err?.message?.includes('No document to update') || true) {
          const q = query(collection(db, 'orders'), where('id', '==', orderId));
          const snap = await getDocs(q);
          if (!snap.empty) {
            await updateDoc(doc(db, 'orders', snap.docs[0].id), updates);
          } else {
            throw err;
          }
        }
      }

      // Log status update audit trail
      if (userData) {
        const order = orders.find(o => o.id === orderId);
        let statusLabel = newStatus.toUpperCase();
        switch (newStatus) {
          case 'pending': statusLabel = 'PENDENTE'; break;
          case 'preparing': statusLabel = 'EM PREPARO'; break;
          case 'prepared': statusLabel = 'PREPARADO'; break;
          case 'ready': statusLabel = 'PRONTO'; break;
          case 'completed': statusLabel = 'FINALIZADO'; break;
          case 'cancelled': statusLabel = 'CANCELADO'; break;
          case 'aguardando_caixa': statusLabel = 'FECHANDO CONTA'; break;
          case 'pendente_pagamento': statusLabel = 'PGTO PENDENTE'; break;
          default: statusLabel = newStatus.toUpperCase();
        }

        await logAuditAction({
          userId: userData.uid || '',
          userEmail: userData.email || '',
          userName: userData.name || 'Funcionário',
          actionType: 'ORDER_STATUS_UPDATE',
          title: 'Status do Pedido Atualizado',
          description: `Alterou o status do Pedido ${order?.dailySeq || ''} (ID: "${orderId}") para "${statusLabel}".`,
          userRole: userData.role || 'staff',
          metadata: { orderId, dailySeq: order?.dailySeq, previousStatus: order?.status, newStatus }
        });
      }

      // Auto-printing trigger on status transition
      try {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          const printerSet = getPrinterSettings();
          const mergedOrder = { ...order, ...updates }; // Ensure status reflects newStatus
          if (newStatus === 'preparing' && printerSet.autoPrintOnAccept) {
            printOrder(mergedOrder).catch(err => console.error("Erro ao imprimir automaticamente:", err));
          } else if (newStatus === 'ready' && printerSet.autoPrintOnReady) {
            printOrder(mergedOrder).catch(err => console.error("Erro ao imprimir automaticamente:", err));
          }
        }
      } catch (err) {
        console.error("Erro ao verificar auto-impressão:", err);
      }

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

      if (userData) {
        await logAuditAction({
          userId: userData.uid || '',
          userEmail: userData.email || '',
          userName: userData.name || 'Funcionário',
          actionType: 'ORDER_DELIVERY',
          title: 'Pedido Confirmado como Entregue',
          description: `Confirmou a entrega do Pedido ${order.dailySeq || ''} (ID: "${order.id}") (Novo status: "${nextStatus.toUpperCase()}").`,
          userRole: userData.role || 'staff',
          metadata: { orderId: order.id, dailySeq: order.dailySeq, clientName: order.clientName, nextStatus }
        });
      }

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
      const updates = {
        status: 'cancelled',
        cancelReason: reason,
        cancelledAt: new Date().toISOString(),
        cancelledBy: userData?.name || userData?.email || 'Admin',
      };
      
      try {
        const orderDocRef = doc(db, 'orders', cancelOrderId);
        await updateDoc(orderDocRef, updates);
      } catch (err: any) {
        if (err?.code === 'not-found' || err?.message?.includes('No document to update') || true) {
          const q = query(collection(db, 'orders'), where('id', '==', cancelOrderId));
          const snap = await getDocs(q);
          if (!snap.empty) {
            await updateDoc(doc(db, 'orders', snap.docs[0].id), updates);
          } else {
            throw err;
          }
        }
      }

      if (userData) {
        await logAuditAction({
          userId: userData.uid || '',
          userEmail: userData.email || '',
          userName: userData.name || 'Funcionário',
          actionType: 'ORDER_CANCEL',
          title: 'Pedido Cancelado',
          description: `Cancelou o Pedido ${order?.dailySeq || ''} (ID: "${cancelOrderId}") com o motivo: "${reason}".`,
          userRole: userData.role || 'staff',
          metadata: { orderId: cancelOrderId, dailySeq: order?.dailySeq, clientName: order?.clientName, reason }
        });
      }

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
  const kitchenOrders = orders.filter(o => o.status === 'pending' || o.status === 'preparing' || o.status === 'prepared');
  const attendingOrders = orders.filter(o => o.status === 'ready' || (o.status === 'delivering' && o.orderType === 'delivery'));
  const cashierOrders = orders.filter(o => o.status === 'ready');
  const cashierEvaluationOrders = orders.filter(o => o.status === 'aguardando_caixa' || o.status === 'pendente_pagamento' || o.status === 'awaiting_payment');
  const deliveryOrders = orders.filter(o => (o.status === 'ready' || o.status === 'delivering') && o.address);
  const sortedDeliveryOrders = [...deliveryOrders].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'delivering' ? -1 : 1;
    }
    const uidA = a.deliveryUid || '';
    const uidB = b.deliveryUid || '';
    if (uidA !== uidB) return uidA.localeCompare(uidB);
    const roA = a.routeOrder ?? 999;
    const roB = b.routeOrder ?? 999;
    if (roA !== roB) return roA - roB;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

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
              {/* Controles de volume dos alarmes */}
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem', padding: '0.85rem 1.1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>🔊 Volumes</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: '160px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>🔔 Novo Pedido</span>
                  <input
                    id="volume-pending"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumePending}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolumePending(v);
                      if (pendingAudioRef.current) pendingAudioRef.current.volume = v;
                    }}
                    style={{ flex: 1, accentColor: 'var(--primary-gold)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: '32px', textAlign: 'right' }}>{Math.round(volumePending * 100)}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: '160px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>🍳 Pedido Pronto</span>
                  <input
                    id="volume-preparing"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volumePreparing}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolumePreparing(v);
                      if (preparingAudioRef.current) preparingAudioRef.current.volume = v;
                    }}
                    style={{ flex: 1, accentColor: '#10b981', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', minWidth: '32px', textAlign: 'right' }}>{Math.round(volumePreparing * 100)}%</span>
                </div>
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
                          <span className="order-badge-status" style={{ 
                            backgroundColor: 
                              order.status === 'prepared' ? '#10b98115' :
                              order.status === 'preparing' ? '#d9770615' : 'rgba(255,255,255,0.05)', 
                            color: 
                              order.status === 'prepared' ? '#10b981' :
                              order.status === 'preparing' ? 'var(--primary-gold)' : 'var(--text-secondary)' 
                          }}>
                             {order.status === 'prepared' ? 'Pronto na Cozinha' : order.status === 'preparing' ? 'Preparando' : 'Pendente'}
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
                        ) : order.status === 'preparing' ? (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'prepared')} className="btn-small btn-success" style={{ width: '100%', padding: '0.6rem' }}>
                            <Check size={14} /> Concluído (Enviar ao Balcão)
                          </button>
                        ) : (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'ready')} className="btn-small btn-success" style={{ width: '100%', padding: '0.6rem', background: '#3b82f6', borderColor: '#3b82f6' }}>
                            <Check size={14} /> Retirar para o Balcão
                          </button>
                        )}
                        <button 
                          type="button" 
                          onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))} 
                          className="btn-small" 
                          style={{ 
                            width: '100%', 
                            padding: '0.6rem', 
                            background: 'rgba(245, 158, 11, 0.1)', 
                            color: 'var(--primary-gold)', 
                            border: '1px solid rgba(245, 158, 11, 0.2)', 
                            borderRadius: '8px', 
                            cursor: 'pointer', 
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem'
                          }}
                        >
                          <Printer size={14} /> Imprimir Via Embalagem
                        </button>
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
                  attendingOrders.map((order) => {
                    const isDelivery = order.orderType === 'delivery';
                    const hasDeliverer = !!order.deliveryUid;

                    return (
                      <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                        <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                            <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                            <span className="order-badge-status" style={{ 
                              backgroundColor: order.status === 'delivering' ? 'rgba(245, 158, 11, 0.15)' : '#10b98115', 
                              color: order.status === 'delivering' ? 'var(--primary-gold)' : '#10b981' 
                            }}>
                              {order.status === 'delivering' ? 'Em Rota' : 'Pronto'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                            {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                            <div>Tipo: <strong style={{ color: '#fff' }}>{getOrderTypeLabel(order)}</strong></div>
                            {isDelivery && order.deliveryName && (
                              <div style={{ marginTop: '0.1rem', color: 'var(--primary-gold)', fontWeight: 600 }}>
                                🏍️ Entregador: {order.deliveryName}
                              </div>
                            )}
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
                        <div className="order-actions" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <button 
                            type="button" 
                            onClick={() => printOrder(order, true).catch(err => alert("Erro ao imprimir: " + err.message))} 
                            className="btn-small" 
                            style={{ 
                              width: '100%', 
                              padding: '0.6rem', 
                              background: 'rgba(59, 130, 246, 0.1)', 
                              color: '#3b82f6', 
                              border: '1px solid rgba(59, 130, 246, 0.2)', 
                              borderRadius: '8px', 
                              cursor: 'pointer', 
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.4rem'
                            }}
                          >
                            <Printer size={14} /> Imprimir Nota Resumida
                          </button>
                          
                          <button 
                            type="button" 
                            onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))} 
                            className="btn-small" 
                            style={{ 
                              width: '100%', 
                              padding: '0.6rem', 
                              background: 'rgba(245, 158, 11, 0.1)', 
                              color: 'var(--primary-gold)', 
                              border: '1px solid rgba(245, 158, 11, 0.2)', 
                              borderRadius: '8px', 
                              cursor: 'pointer', 
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.4rem'
                            }}
                          >
                            <Printer size={14} /> Imprimir Via Embalagem
                          </button>

                          {isDelivery && !hasDeliverer ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', background: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Atribuir Entregador:</label>
                              <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <select
                                  value={selectedDelivererMap[order.id!] || ''}
                                  onChange={(e) => setSelectedDelivererMap(prev => ({ ...prev, [order.id!]: e.target.value }))}
                                  style={{
                                    flex: 1,
                                    background: '#1f2937',
                                    color: '#fff',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '6px',
                                    padding: '0.4rem',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  <option value="">Selecione...</option>
                                  {deliverers.map(d => (
                                    <option key={d.uid} value={d.uid}>{d.name || d.displayName || d.email}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleAssignDeliverer(order.id!, selectedDelivererMap[order.id!] || '')}
                                  className="btn-small btn-primary"
                                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                >
                                  Confirmar
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {(!isDelivery || hasDeliverer) && (
                            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
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
                          )}

                          {isDelivery && hasDeliverer && (
                            <>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', background: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ordem de Entrega:</label>
                                <select
                                  value={order.routeOrder || ''}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                                    updateDoc(doc(db, 'orders', order.id!), { routeOrder: val })
                                      .catch(err => console.error("Erro ao definir rota:", err));
                                  }}
                                  style={{
                                    background: '#1f2937',
                                    color: '#fff',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '6px',
                                    padding: '0.4rem',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <option value="">Automático</option>
                                  <option value="1">1ª Entrega (Prioridade Máxima)</option>
                                  <option value="2">2ª Entrega</option>
                                  <option value="3">3ª Entrega</option>
                                  <option value="4">4ª Entrega</option>
                                  <option value="5">5ª Entrega</option>
                                </select>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', background: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Trocar Entregador:</label>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                  <select
                                    value={selectedDelivererMap[order.id!] || ''}
                                    onChange={(e) => setSelectedDelivererMap(prev => ({ ...prev, [order.id!]: e.target.value }))}
                                    style={{
                                      flex: 1,
                                      background: '#1f2937',
                                      color: '#fff',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      borderRadius: '6px',
                                      padding: '0.4rem',
                                      fontSize: '0.85rem'
                                    }}
                                  >
                                    <option value="">Selecione outro...</option>
                                    {deliverers.filter(d => d.uid !== order.deliveryUid).map(d => (
                                      <option key={d.uid} value={d.uid}>{d.name || d.displayName || d.email}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => handleAssignDeliverer(order.id!, selectedDelivererMap[order.id!] || '')}
                                    className="btn-small btn-primary"
                                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                                  >
                                    Confirmar
                                  </button>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveDeliverer(order.id!)}
                                className="btn-small btn-danger"
                                style={{
                                  width: '100%',
                                  padding: '0.6rem',
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  color: '#f87171',
                                  border: '1px solid rgba(239, 68, 68, 0.2)',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  marginTop: '0.25rem'
                                }}
                              >
                                🚫 Retirar Entregador (Voltar ao Balcão)
                              </button>
                            </>
                          )}

                          {isDelivery && !hasDeliverer && isAuthorizedCancel && (
                            <button
                              type="button"
                              onClick={() => { if (order.id) { setCancelOrderId(order.id); setCancelOrderSeq(order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt)); } }}
                              className="btn-small btn-danger"
                              style={{
                                width: '100%',
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
                        {isDelivery ? <DeliveryTimer order={order} /> : <OrderTimer order={order} />}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Fila do Caixa */}
          {filter === 'cashier' && isAuthorized('cashier') && (() => {
            const todayStr = getBusinessDay(new Date().toISOString());
            let todayOrders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'merged' && o.status !== 'abandoned' && o.status !== 'building_cart' && o.status !== 'awaiting_payment' && !(!o.paymentMethod && !o.paymentVerificationToken));

            // Lógica de filtragem por tempo estendido / específico
            if (timeFilterHours === 'all_day') {
              todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === todayStr);
            } else if (timeFilterHours === 'yesterday') {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = getBusinessDay(yesterday.toISOString());
              todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === yesterdayStr);
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
                todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === specificDateValue);
              } else {
                todayOrders = [];
              }
            }

            // Pedidos pagos de hoje (tanto finalizados quanto ativos pagos online)
            const paidTodayOrders = todayOrders.filter(o => 
              o.status === 'completed' || 
              ['pix', 'credito', 'credito_mp', 'google_pay'].includes(o.paymentMethod || '')
            );
            const totalPaidTodayValue = paidTodayOrders.reduce((sum, o) => sum + o.total, 0);

            // Pedidos não pagos de hoje (ativos com métodos físicos ou pagar no final)
            const unpaidTodayOrders = todayOrders.filter(o => 
              o.status !== 'completed' && 
              !['pix', 'credito', 'credito_mp', 'google_pay'].includes(o.paymentMethod || '')
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
                          <option value="yesterday">Ontem</option>
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
                                        {order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'debito' ? '💳 Débito' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : order.paymentMethod === 'cartao' ? '💳 Cartões ou Pix' : '💴 Outro'}
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
                    Pedidos com pagamento físico (dinheiro ou cartão na entrega/retirada) que aguardam baixa manual, e pedidos com <strong style={{ color: '#f59e0b' }}>Pix gerado mas não confirmado</strong> (QR Code escaneado, aguardando confirmação do banco).
                  </p>
                  <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    {cashierEvaluationOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', padding: '1.5rem', gridColumn: '1 / -1', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                        Nenhum pedido aguardando avaliação no momento.
                      </p>
                    ) : (
                      cashierEvaluationOrders.map((order) => (
                        <div key={order.id} className="order-item" style={{
                          background: order.status === 'awaiting_payment' ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.02)',
                          border: order.status === 'awaiting_payment' ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(255,255,255,0.05)',
                          padding: '1.25rem',
                          borderRadius: '16px'
                        }}>
                          {order.status === 'awaiting_payment' && (
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                              background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                              border: '1px solid rgba(245,158,11,0.3)', borderRadius: '20px',
                              padding: '0.2rem 0.65rem', fontSize: '0.75rem', fontWeight: 700,
                              marginBottom: '0.6rem'
                            }}>
                              ⏳ PIX gerado — aguardando confirmação do pagamento
                            </div>
                          )}
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
                              <div>Método: <strong style={{ color: 'var(--primary-gold)' }}>{order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : order.paymentMethod === 'debito' ? '💳 Débito' : order.paymentMethod === 'debito_point' ? '💴 Débito Maquininha' : order.paymentMethod === 'credito_point' ? '💳 Crédito Maquininha' : order.paymentMethod === 'pix' ? '🟢 Pix (aguardando confirmação)' : order.paymentMethod === 'cartao' ? '💳 Cartões ou Pix (Baixa Manual)' : '💴 Cartão (maquininha)'}</strong></div>
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
                          <button 
                            type="button" 
                            onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))} 
                            className="btn-small" 
                            style={{ 
                              width: '100%', 
                              padding: '0.6rem', 
                              background: 'rgba(245, 158, 11, 0.1)', 
                              color: 'var(--primary-gold)', 
                              border: '1px solid rgba(245, 158, 11, 0.2)', 
                              borderRadius: '8px', 
                              cursor: 'pointer', 
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.4rem',
                              marginBottom: '0.5rem'
                            }}
                          >
                            <Printer size={14} /> Imprimir Recibo
                          </button>
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

                {/* Seção 3: Últimas Vendas Realizadas (Reimpressão) */}
                <div className="staff-section cashier-card" style={{ border: 'none', background: 'transparent', padding: 0, marginTop: '2rem' }}>
                  <div className="section-title">
                    <CheckCircle className="section-icon text-emerald" size={24} />
                    <h3 style={{ fontSize: '1.4rem' }}>Últimas Vendas Realizadas (Reimprimir)</h3>
                  </div>
                  <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: '0.25rem 0 1rem 0' }}>
                    Histórico dos pedidos aprovados recentemente. Utilize para reimprimir o comprovante caso a bobina da maquininha tenha acabado ou ocorrido erro de impressão.
                  </p>
                  <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    {paidTodayOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', padding: '1.5rem', gridColumn: '1 / -1', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                        Nenhuma venda aprovada hoje ainda.
                      </p>
                    ) : (
                      (() => {
                        const caixaGroupedItems: any[] = [];
                        paidTodayOrders.forEach(o => {
                          if (o.orderType === 'dine_in_table' && o.tableNumber) {
                            if (!caixaGroupedItems.find(g => g.type === 'table' && g.tableNumber === o.tableNumber)) {
                              const tableOrders = paidTodayOrders.filter(x => x.orderType === 'dine_in_table' && x.tableNumber === o.tableNumber);
                              caixaGroupedItems.push({
                                type: 'table',
                                tableNumber: o.tableNumber,
                                orders: tableOrders,
                                total: tableOrders.reduce((sum, x) => sum + x.total, 0),
                                createdAt: o.createdAt,
                                id: `table-${o.tableNumber}`
                              });
                            }
                          } else {
                            caixaGroupedItems.push({
                              type: 'standalone',
                              order: o,
                              createdAt: o.createdAt,
                              id: o.id
                            });
                          }
                        });

                        return caixaGroupedItems.slice(0, 20).map((item) => {
                          if (item.type === 'table') {
                            const tOrders = item.orders;
                            return (
                              <div key={item.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                                <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <strong style={{ fontSize: '1.15rem' }}>Conta da Mesa {item.tableNumber}</strong>
                                    <button 
                                      onClick={() => setViewingReceiptDetails({ title: `Detalhes da Conta (Mesa ${item.tableNumber})`, orders: item.orders })} 
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationColor: 'var(--primary-gold)' }}
                                      title="Clique para ver os detalhes dos pedidos"
                                    >
                                      <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.1rem' }}>
                                        R$ {item.total.toFixed(2).replace('.', ',')}
                                      </span>
                                    </button>
                                  </div>
                                  <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                                    {tOrders.length} pedido(s) unificados
                                  </span>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <span>
                                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Pagamento(s): {
                                        [...new Set(tOrders.flatMap((o: any) => o.payments ? o.payments.map((p: any) => p.method) : [o.paymentMethod]).filter(Boolean))]
                                        .map(m => m === 'dinheiro' ? 'Dinheiro' : m === 'debito' ? 'Débito' : m === 'credito' ? 'Crédito' : m === 'pix' ? 'PIX' : m)
                                        .join(', ')
                                      }
                                    </span>
                                    {(() => {
                                      const onlinePayment = tOrders.flatMap((o: any) => o.payments || []).find((p: any) => p.id && ['pix', 'credito', 'credito_mp', 'google_pay'].includes(p.method));
                                      if (onlinePayment) {
                                        return (
                                          <div style={{ color: '#10b981', padding: '0.4rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '4px', border: '1px dashed rgba(16,185,129,0.3)' }}>
                                            ✅ <strong>Pedido já pago pelo cliente em seu próprio dispositivo.</strong><br/>
                                            ID Transação: {onlinePayment.id}
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                </div>
                                
                                <div className="order-actions" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                  <button 
                                    type="button" 
                                    onClick={() => printPaymentReceipt(tOrders, true, item.tableNumber).catch(err => alert("Erro ao imprimir: " + err.message))} 
                                    className="btn-small" 
                                    style={{ 
                                      width: '100%', 
                                      padding: '0.6rem', 
                                      background: 'rgba(16, 185, 129, 0.1)', 
                                      color: 'var(--emerald-400, #34d399)', 
                                      border: '1px solid rgba(16, 185, 129, 0.2)', 
                                      borderRadius: '8px', 
                                      cursor: 'pointer', 
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '0.4rem'
                                    }}
                                  >
                                    <CreditCard size={14} /> Via do Cliente (Cartão)
                                  </button>
                                  <button 
                                    type="button" 
                                    onClick={() => printTableBill(item.tableNumber, tOrders).catch(err => alert("Erro ao imprimir: " + err.message))} 
                                    className="btn-small" 
                                    style={{ 
                                      width: '100%', 
                                      padding: '0.6rem', 
                                      background: 'rgba(245, 158, 11, 0.05)', 
                                      color: 'var(--primary-gold)', 
                                      border: '1px solid rgba(245, 158, 11, 0.1)', 
                                      borderRadius: '8px', 
                                      cursor: 'pointer', 
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '0.4rem'
                                    }}
                                  >
                                    <Printer size={14} /> Reimprimir Conta (Itens)
                                  </button>
                                </div>
                              </div>
                            );
                          } else {
                            const order = item.order;
                            return (
                              <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                                <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                                    <button 
                                      onClick={() => setViewingReceiptDetails({ title: `Detalhes do Pedido ${order.dailySeq ? `#${order.dailySeq}` : ''}`, orders: [order] })} 
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationColor: 'var(--primary-gold)' }}
                                      title="Clique para ver os detalhes do pedido"
                                    >
                                      <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.1rem' }}>
                                        R$ {order.total.toFixed(2).replace('.', ',')}
                                      </span>
                                    </button>
                                  </div>
                                  <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                                    {order.clientName}
                                  </span>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <span>
                                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Pagamento: {order.paymentMethod === 'dinheiro' ? 'Dinheiro' : order.paymentMethod === 'debito' ? 'Débito' : order.paymentMethod === 'credito' ? 'Crédito' : order.paymentMethod === 'pix' ? 'PIX' : order.paymentMethod}
                                    </span>
                                    {(() => {
                                      const onlinePayment = (order.payments || []).find((p: any) => p.id && ['pix', 'credito', 'credito_mp', 'google_pay'].includes(p.method));
                                      if (onlinePayment) {
                                        return (
                                          <div style={{ color: '#10b981', padding: '0.4rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '4px', border: '1px dashed rgba(16,185,129,0.3)' }}>
                                            ✅ <strong>Pedido já pago pelo cliente em seu próprio dispositivo.</strong><br/>
                                            ID Transação: {onlinePayment.id}
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                </div>
                                
                                <div className="order-actions" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                  <button 
                                    type="button" 
                                    onClick={() => printPaymentReceipt([order], false).catch(err => alert("Erro ao imprimir: " + err.message))} 
                                    className="btn-small" 
                                    style={{ 
                                      width: '100%', 
                                      padding: '0.6rem', 
                                      background: 'rgba(16, 185, 129, 0.1)', 
                                      color: 'var(--emerald-400, #34d399)', 
                                      border: '1px solid rgba(16, 185, 129, 0.2)', 
                                      borderRadius: '8px', 
                                      cursor: 'pointer', 
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '0.4rem'
                                    }}
                                  >
                                    <CreditCard size={14} /> Via do Cliente (Cartão)
                                  </button>
                                  <button 
                                    type="button" 
                                    onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))} 
                                    className="btn-small" 
                                    style={{ 
                                      width: '100%', 
                                      padding: '0.6rem', 
                                      background: 'rgba(245, 158, 11, 0.05)', 
                                      color: 'var(--primary-gold)', 
                                      border: '1px solid rgba(245, 158, 11, 0.1)', 
                                      borderRadius: '8px', 
                                      cursor: 'pointer', 
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '0.4rem'
                                    }}
                                  >
                                    <Printer size={14} /> Reimprimir Pedido (Itens)
                                  </button>
                                </div>
                              </div>
                            );
                          }
                        });
                      })()
                    )}
                  </div>
                </div>

              </div>
            );
          })()}

          {/* Transações Mercado Pago */}
          {filter === 'mercadopago' && (() => {
            const todayStr = getBusinessDay(new Date().toISOString());
            let todayOrders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'awaiting_payment' && !(!o.paymentMethod && !o.paymentVerificationToken));

            if (timeFilterHours === 'all_day') {
              todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === todayStr);
            } else if (timeFilterHours === 'yesterday') {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = getBusinessDay(yesterday.toISOString());
              todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === yesterdayStr);
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
                todayOrders = todayOrders.filter(o => getBusinessDay(o.createdAt) === specificDateValue);
              } else {
                todayOrders = [];
              }
            }

            // Pedidos processados via integração Mercado Pago (Maquininha ou Online)
            const paidOrders = todayOrders.filter(o => {
              const isFinishedOrApproved = o.status === 'completed' || o.pointPaymentStatus === 'approved';
              const isMpIntegration = ['pix', 'credito', 'debito', 'maq_pix', 'maq_credito', 'maq_debito', 'google_pay'].includes(o.paymentMethod || '');
              return isFinishedOrApproved && isMpIntegration;
            });

            // Agrupar mesas fechadas
            const closedTablesMap: { [table: string]: { total: number; orderIds: string[]; orders: any[] } } = {};
            const standaloneOrders: any[] = [];

            paidOrders.forEach(o => {
              if (o.orderType === 'dine_in_table' && o.tableNumber && o.status === 'completed') {
                if (!closedTablesMap[o.tableNumber]) {
                  closedTablesMap[o.tableNumber] = { total: 0, orderIds: [], orders: [] };
                }
                closedTablesMap[o.tableNumber].total += o.total;
                closedTablesMap[o.tableNumber].orderIds.push(o.id || '');
                closedTablesMap[o.tableNumber].orders.push(o);
              } else {
                standaloneOrders.push(o);
              }
            });

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', width: '100%', padding: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <CreditCard size={28} className="text-gold" style={{ color: 'var(--primary-gold)' }} />
                    <h2 style={{ fontSize: '1.8rem', margin: 0, color: '#fff' }}>Transações Mercado Pago</h2>
                  </div>
                  
                  {/* Filtro de Tempo */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <select
                      value={timeFilterHours}
                      onChange={(e) => setTimeFilterHours(e.target.value)}
                      style={{ 
                        padding: '0.4rem 0.6rem', 
                        borderRadius: '8px', 
                        border: '1px solid rgba(255,255,255,0.1)', 
                        background: '#0b0f19', 
                        color: '#fff', 
                        fontSize: '0.85rem',
                        cursor: 'pointer'
                      }}
                    >
                      <option style={{ background: '#0b0f19' }} value="all_day">Hoje (Dia todo)</option>
                      <option style={{ background: '#0b0f19' }} value="yesterday">Ontem</option>
                      <option style={{ background: '#0b0f19' }} value="1">Última 1 hora</option>
                      <option style={{ background: '#0b0f19' }} value="2">Últimas 2 horas</option>
                      <option style={{ background: '#0b0f19' }} value="3">Últimas 3 horas</option>
                      <option style={{ background: '#0b0f19' }} value="4">Últimas 4 horas</option>
                      <option style={{ background: '#0b0f19' }} value="3_days">Últimos 3 dias</option>
                      <option style={{ background: '#0b0f19' }} value="7_days">Últimos 7 dias</option>
                      <option style={{ background: '#0b0f19' }} value="30_days">Últimos 30 dias</option>
                      <option style={{ background: '#0b0f19' }} value="specific_date">Data específica...</option>
                    </select>

                    {timeFilterHours === 'specific_date' && (
                      <input
                        type="date"
                        value={specificDateValue}
                        onChange={(e) => setSpecificDateValue(e.target.value)}
                        style={{
                          padding: '0.4rem 0.6rem',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: 'rgba(255,255,255,0.05)',
                          color: '#fff',
                          fontSize: '0.85rem',
                          outline: 'none'
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Mesas Fechadas */}
                <div className="staff-section" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                  <div className="section-title">
                    <CheckCircle className="section-icon text-emerald" size={24} />
                    <h3 style={{ fontSize: '1.4rem' }}>Contas de Mesas Fechadas</h3>
                  </div>
                  <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    {Object.keys(closedTablesMap).length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', padding: '1.5rem', gridColumn: '1 / -1', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                        Nenhuma mesa foi fechada/paga no período selecionado.
                      </p>
                    ) : (
                      Object.entries(closedTablesMap).map(([tableNum, tableData]) => {
                        const mpIdOrder = tableData.orders.find(o => o.pointPaymentIntentId || o.mercadoPagoPaymentId || o.mercadoPagoOrderId);
                        const transactionId = mpIdOrder ? (mpIdOrder.pointPaymentIntentId || mpIdOrder.mercadoPagoPaymentId || mpIdOrder.mercadoPagoOrderId) : null;
                        
                        return (
                        <div key={tableNum} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                          <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start', gap: '1rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0, flex: 1 }}>
                                <strong style={{ fontSize: '1.2rem', color: '#fff' }}>Mesa {tableNum}</strong>
                                {transactionId && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>Transação: {transactionId}</span>
                                )}
                              </div>
                              <button 
                                onClick={() => setViewingReceiptDetails({ title: `Detalhes da Conta (Mesa ${tableNum})`, orders: tableData.orders })} 
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationColor: 'var(--primary-gold)', flexShrink: 0 }}
                                title="Clique para ver os detalhes dos pedidos"
                              >
                                <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.2rem' }}>
                                  R$ {tableData.total.toFixed(2).replace('.', ',')}
                                </span>
                              </button>
                            </div>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                              {tableData.orders.length} pedidos vinculados
                            </span>
                          </div>
                          
                          <div className="order-actions" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <button 
                              type="button" 
                              onClick={() => printPaymentReceipt(tableData.orders, true, tableNum)} 
                              className="btn-small" 
                              style={{ 
                                width: '100%', 
                                padding: '0.6rem', 
                                background: 'rgba(16, 185, 129, 0.1)', 
                                color: 'var(--emerald-400, #34d399)', 
                                border: '1px solid rgba(16, 185, 129, 0.2)', 
                                borderRadius: '8px', 
                                cursor: 'pointer', 
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.4rem'
                              }}
                            >
                              <CreditCard size={14} /> Via do Cliente (Cartão)
                            </button>
                            <button 
                              type="button" 
                              onClick={() => printTableBill(tableNum, tableData.orders)} 
                              className="btn-small" 
                              style={{ 
                                width: '100%', 
                                padding: '0.6rem', 
                                background: 'rgba(245, 158, 11, 0.05)', 
                                color: 'var(--primary-gold)', 
                                border: '1px solid rgba(245, 158, 11, 0.1)', 
                                borderRadius: '8px', 
                                cursor: 'pointer', 
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.4rem'
                              }}
                            >
                              <Printer size={14} /> Reimprimir Conta (Itens)
                            </button>
                            {transactionId && <FeeBreakdown transactionId={transactionId} token={storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock'} />}
                          </div>
                        </div>
                      )})
                    )}
                  </div>
                </div>

                {/* Vendas Avulsas (Balcão / Delivery) */}
                <div className="staff-section" style={{ border: 'none', background: 'transparent', padding: 0, marginTop: '2rem' }}>
                  <div className="section-title">
                    <CheckCircle className="section-icon text-emerald" size={24} />
                    <h3 style={{ fontSize: '1.4rem' }}>Vendas Avulsas Pagas</h3>
                  </div>
                  <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    {standaloneOrders.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', padding: '1.5rem', gridColumn: '1 / -1', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                        Nenhuma venda avulsa paga no período selecionado.
                      </p>
                    ) : (
                      standaloneOrders.slice(0, 30).map((order) => (
                        <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                          <div className="order-meta" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start', gap: '1rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0, flex: 1 }}>
                                <strong style={{ fontSize: '1.15rem' }}>{formatOrderHeader(order)}</strong>
                                {(order.pointPaymentIntentId || order.mercadoPagoPaymentId || order.mercadoPagoOrderId) && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                                    Transação: {order.pointPaymentIntentId || order.mercadoPagoPaymentId || order.mercadoPagoOrderId}
                                  </span>
                                )}
                              </div>
                              <button 
                                onClick={() => setViewingReceiptDetails({ title: `Detalhes do Pedido ${order.dailySeq ? `#${order.dailySeq}` : ''}`, orders: [order] })} 
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationColor: 'var(--primary-gold)', flexShrink: 0 }}
                                title="Clique para ver os detalhes do pedido"
                              >
                                <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.1rem' }}>
                                  R$ {order.total.toFixed(2).replace('.', ',')}
                                </span>
                              </button>
                            </div>
                            <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                              {order.clientName}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                              {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Pagamento: {order.paymentMethod === 'dinheiro' ? 'Dinheiro' : order.paymentMethod === 'debito' ? 'Débito' : order.paymentMethod === 'credito' ? 'Crédito' : order.paymentMethod === 'pix' ? 'PIX' : order.paymentMethod}
                            </span>
                          </div>
                          
                          <div className="order-actions" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <button 
                              type="button" 
                              onClick={() => printPaymentReceipt([order], false).catch(err => alert("Erro ao imprimir: " + err.message))} 
                              className="btn-small" 
                              style={{ 
                                width: '100%', 
                                padding: '0.6rem', 
                                background: 'rgba(16, 185, 129, 0.1)', 
                                color: 'var(--emerald-400, #34d399)', 
                                border: '1px solid rgba(16, 185, 129, 0.2)', 
                                borderRadius: '8px', 
                                cursor: 'pointer', 
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.4rem'
                              }}
                            >
                              <CreditCard size={14} /> Via do Cliente (Cartão)
                            </button>
                            <button 
                              type="button" 
                              onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))} 
                              className="btn-small" 
                              style={{ 
                                width: '100%', 
                                padding: '0.6rem', 
                                background: 'rgba(245, 158, 11, 0.05)', 
                                color: 'var(--primary-gold)', 
                                border: '1px solid rgba(245, 158, 11, 0.1)', 
                                borderRadius: '8px', 
                                cursor: 'pointer', 
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.4rem'
                              }}
                            >
                              <Printer size={14} /> Reimprimir Pedido (Itens)
                            </button>
                            {(order.pointPaymentIntentId || order.mercadoPagoPaymentId || order.mercadoPagoOrderId) && (
                              <FeeBreakdown transactionId={order.pointPaymentIntentId || order.mercadoPagoPaymentId || order.mercadoPagoOrderId} token={storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock'} />
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
                  sortedDeliveryOrders.map((order) => (
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
                        <button 
                          type="button" 
                          onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))} 
                          className="btn-small" 
                          style={{ 
                            width: '100%', 
                            padding: '0.6rem', 
                            background: 'rgba(245, 158, 11, 0.1)', 
                            color: 'var(--primary-gold)', 
                            border: '1px solid rgba(245, 158, 11, 0.2)', 
                            borderRadius: '8px', 
                            cursor: 'pointer', 
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem'
                          }}
                        >
                          <Printer size={14} /> Imprimir Via Embalagem
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
        // --- Derivações do estado ---
        const allTableOrders = orders.filter(o =>
          o.status !== 'completed' &&
          o.status !== 'cancelled' &&
          o.orderType === 'dine_in_table' &&
          o.tableNumber === selectedCheckoutTable &&
          !['pix', 'credito', 'google_pay'].includes(o.paymentMethod || '')
        );

        // Lista de clientes únicos na mesa
        const clientsAtTable = Array.from(new Set(allTableOrders.map(o => o.clientName).filter(Boolean))) as string[];

        // Pedidos filtrados pelos clientes selecionados no checkout
        const filteredOrders = allTableOrders.filter(o =>
          checkoutSelectedClients.includes(o.clientName || '')
        );

        const tableTotal = filteredOrders.reduce((sum, o) => sum + o.total, 0);

        // Dispositivos Point disponíveis
        const pointDevices: {id: string; label: string}[] = [];
        if (storeConfig?.pointSmart2Id) pointDevices.push({ id: storeConfig.pointSmart2Id, label: 'Point Smart 2' });
        if (storeConfig?.pointPro3Id) pointDevices.push({ id: storeConfig.pointPro3Id, label: 'Point Pro 3' });
        if (storeConfig?.pointAir2Id) pointDevices.push({ id: storeConfig.pointAir2Id, label: 'Point Air 2' });
        if (storeConfig?.pointMiniNfc2Id) pointDevices.push({ id: storeConfig.pointMiniNfc2Id, label: 'Point Mini NFC 2' });
        if (pointDevices.length === 0) pointDevices.push({ id: 'MOCK_DEVICE', label: 'Simulador (Teste)' });

        const totalPaid = partialPayments.reduce((sum, p) => sum + p.amount, 0);
        const remainingBalance = Math.max(0, tableTotal - totalPaid);

        const isPointMethod = ['maq_pix', 'maq_debito', 'maq_credito'].includes(checkoutPaymentMethod);
        const canClose = remainingBalance === 0 || (!isPointMethod || pointPaymentStatus === 'approved');

        const handleTriggerPoint = async (deviceId: string, label: string, pMethodOverride?: string) => {
          const chargeAmount = partialPaymentInputAmount ? parseFloat(partialPaymentInputAmount.replace(',', '.')) : remainingBalance;
          if (isNaN(chargeAmount) || chargeAmount <= 0 || chargeAmount > remainingBalance) {
            alert('Valor inválido para a cobrança.');
            return;
          }

          setPointPaymentLoading(true);
          setPointPaymentError(null);
          setPointPaymentStatus('idle');
          setPointIntentId('');
          setPendingPointAmount(chargeAmount);
          setPendingPointMethod(pMethodOverride || checkoutPaymentMethod);
          try {
            let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
            if (!token || token === 'null' || token === 'undefined') token = 'mock';
            const pMethod = pMethodOverride || checkoutPaymentMethod;
            const pType = pMethod === 'maq_pix' ? 'pix'
              : pMethod === 'maq_debito' ? 'debito' : 'credito';
            const response = await fetch(`${API_BASE_URL}/api/pagamentos/create-point-order`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token,
                deviceId,
                amount: chargeAmount.toFixed(2),
                paymentType: pType,
                externalReference: 'CAIXA_' + Date.now(),
                devPercentage: storeConfig?.devPercentage || 0
              })
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message || 'Erro ao acionar maquininha.');
            setPointIntentId(result.intentId);
            setSelectedDeviceId(deviceId);
            setPointDeviceLabel(label);
            setPointPaymentStatus('pending');
          } catch (err: any) {
            setPointPaymentError(err.message || 'Erro ao acionar maquininha.');
          } finally {
            setPointPaymentLoading(false);
          }
        };

        return (
          <div
            className="lightbox-overlay animate-fade-in"
            onClick={() => {
              if (pointPaymentStatus !== 'pending') {
                setSelectedCheckoutTable(null);
                setCheckoutChangeFor('');
                setCheckoutSelectedClients([]);
                setPointPaymentStatus('idle');
                setPointIntentId('');
                setPointPaymentError(null);
                setPartialPayments([]);
                setPartialPaymentInputAmount('');
              }
            }}
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
                maxWidth: '560px',
                maxHeight: '92vh',
                overflowY: 'auto',
                boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                color: '#fff'
              }}
            >
              {/* Cabeçalho */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🍽️ Fechar Conta — Mesa {selectedCheckoutTable}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (pointPaymentStatus !== 'pending') {
                      setSelectedCheckoutTable(null);
                      setCheckoutChangeFor('');
                      setCheckoutSelectedClients([]);
                      setPointPaymentStatus('idle');
                      setPointIntentId('');
                      setPointPaymentError(null);
                    }
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: pointPaymentStatus === 'pending' ? 'not-allowed' : 'pointer', fontSize: '1.25rem' }}
                >
                  ✕
                </button>
              </div>

              {/* Seleção de Cliente (multi-select) */}
              {clientsAtTable.length > 0 && (
                <div>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem', letterSpacing: '0.06em' }}>Cobrar conta de (Seleção Múltipla):</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutSelectedClients(clientsAtTable);
                        setPointPaymentStatus('idle');
                        setPointIntentId('');
                        setPointPaymentError(null);
                      }}
                      style={{
                        padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                        border: checkoutSelectedClients.length === clientsAtTable.length ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.15)',
                        background: checkoutSelectedClients.length === clientsAtTable.length ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
                        color: checkoutSelectedClients.length === clientsAtTable.length ? 'var(--primary-gold)' : 'var(--text-secondary)'
                      }}
                    >🍽️ Mesa Completa</button>

                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutSelectedClients([]);
                        setPointPaymentStatus('idle');
                        setPointIntentId('');
                        setPointPaymentError(null);
                      }}
                      style={{
                        padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.15)',
                        background: checkoutSelectedClients.length === 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.03)',
                        color: checkoutSelectedClients.length === 0 ? '#f87171' : 'var(--text-secondary)'
                      }}
                    >Limpar Seleção</button>

                    {clientsAtTable.map(name => {
                      const isSelected = checkoutSelectedClients.includes(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setPointPaymentStatus('idle');
                            setPointIntentId('');
                            setPointPaymentError(null);
                            if (isSelected) {
                              setCheckoutSelectedClients(checkoutSelectedClients.filter(c => c !== name));
                            } else {
                              setCheckoutSelectedClients([...checkoutSelectedClients, name]);
                            }
                          }}
                          style={{
                            padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                            border: isSelected ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
                            background: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                            color: isSelected ? '#10b981' : 'var(--text-secondary)',
                            display: 'flex', alignItems: 'center', gap: '0.3rem'
                          }}
                        >
                          <span>{isSelected ? '✓' : '+'}</span>
                          <span>👤 {name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Botões de Impressão */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => printTableBill(selectedCheckoutTable, filteredOrders, checkoutSelectedClients.length === clientsAtTable.length ? undefined : checkoutSelectedClients.join(', '))}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  <Printer size={14} />
                  {checkoutSelectedClients.length === clientsAtTable.length ? 'Imprimir Conta da Mesa' : `Imprimir Conta (${checkoutSelectedClients.length} selecionados)`}
                </button>
                {checkoutSelectedClients.length !== clientsAtTable.length && (
                  <button
                    type="button"
                    onClick={() => printTableBill(selectedCheckoutTable, allTableOrders)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    <Printer size={14} /> Imprimir Mesa Completa
                  </button>
                )}
              </div>

              {/* Lista de Consumo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '12px' }}>
                {filteredOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', margin: 0, textAlign: 'center' }}>Nenhum item pendente.</p>
                ) : (
                  filteredOrders.map((order) => {
                    const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
                    return (
                      <div key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.5rem', marginBottom: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>
                          <span style={{ color: 'var(--primary-gold)' }}>Pedido #{seqNum} — {order.clientName}</span>
                          <span>R$ {order.total.toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '0.5rem' }}>
                          {order.items.map((item, idx) => (
                            <div key={idx}>{item.quantity}x {item.name} — R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</div>
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
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {checkoutSelectedClients.length === clientsAtTable.length ? 'Total da Mesa:' : `Total Selecionado (${checkoutSelectedClients.length} pessoas):`}
                </span>
                <strong style={{ fontSize: '1.3rem', color: 'var(--primary-gold)' }}>R$ {tableTotal.toFixed(2).replace('.', ',')}</strong>
              </div>

              {/* Pagamentos Parciais Cadastrados */}
              {partialPayments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Pagamentos registrados:</span>
                  {partialPayments.map((p, index) => {
                    const mLabel = p.method === 'dinheiro' ? 'Dinheiro' : p.method === 'maq_pix' ? 'Maq. Pix' : p.method === 'maq_debito' ? 'Maq. Débito' : 'Maq. Crédito';
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', marginTop: '4px', color: '#10b981' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{index + 1} {p.payerName ? `- ${p.payerName}` : ''} ✓ {mLabel}</span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                          <span>R$ {p.amount.toFixed(2).replace('.', ',')}</span>
                          {p.method === 'dinheiro' && (
                            <button type="button" onClick={() => setPartialPayments(prev => prev.filter(x => x.id !== p.id))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '0 6px' }}>✕</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 700, color: remainingBalance > 0 ? '#f59e0b' : '#10b981', marginTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.2)', paddingTop: '0.5rem' }}>
                    <span>Falta Pagar:</span>
                    <span>R$ {remainingBalance.toFixed(2).replace('.', ',')}</span>
                  </div>
                </div>
              )}

              {remainingBalance > 0 && (
                <>
                  {/* Valor a cobrar agora */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Nome e Valor a cobrar (R$):</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rachar em:</span>
                        <select 
                          style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.75rem', cursor: 'pointer' }}
                          onChange={(e) => {
                            const parts = parseInt(e.target.value);
                            if (parts > 1) {
                              setPartialPaymentInputAmount((tableTotal / parts).toFixed(2));
                            } else {
                              setPartialPaymentInputAmount('');
                            }
                          }}
                        >
                          <option value="1">Não rachar</option>
                          {Array.from({ length: 49 }, (_, i) => i + 2).map(num => (
                            <option key={num} value={num}>{num} pessoas</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Nome (opcional)"
                        value={partialPaymentInputName}
                        onChange={(e) => setPartialPaymentInputName(e.target.value)}
                        style={{ flex: 1, padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '1rem' }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder={remainingBalance.toFixed(2)}
                        value={partialPaymentInputAmount}
                        onChange={(e) => setPartialPaymentInputAmount(e.target.value)}
                        style={{ width: '110px', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '1rem', textAlign: 'center' }}
                      />
                    </div>
                  </div>

              {/* Formas de Recebimento (exclusivo do operador/caixa) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>Forma de Recebimento (deste valor)</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                  {(() => {
                    const visConfig = storeConfig?.paymentMethodsVisibility || {};
                    const isMethodAllowed = (id: string) => {
                      let key = id;
                      if (id === 'maq_pix') key = 'pix';
                      else if (id === 'maq_debito') key = 'debito_point';
                      else if (id === 'maq_credito') key = 'credito_point';
                      const vis = visConfig[key] || 'both';
                      return vis === 'staff' || vis === 'both';
                    };
                    const methods = [
                      ['dinheiro', '💵', 'Dinheiro'],
                      ['maq_pix', '🟡', 'Maq. Pix'],
                      ['maq_debito', '💳', 'Maq. Débito'],
                      ['maq_credito', '💳', 'Maq. Crédito'],
                    ] as [string, string, string][];
                    return methods.filter(([m]) => isMethodAllowed(m));
                  })().map(([method, icon, label]) => (
                    <button
                      key={method}
                      type="button"
                      disabled={pointPaymentStatus === 'pending'}
                      onClick={() => {
                        setCheckoutPaymentMethod(method);
                        if (method !== 'dinheiro') setCheckoutChangeFor('');
                        setPointPaymentStatus('idle');
                        setPointIntentId('');
                        setPointPaymentError(null);
                      }}
                      style={{
                        padding: '0.65rem 0.5rem',
                        borderRadius: '10px',
                        border: checkoutPaymentMethod === method ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.1)',
                        background: checkoutPaymentMethod === method ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
                        color: checkoutPaymentMethod === method ? 'var(--primary-gold)' : '#fff',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: pointPaymentStatus === 'pending' ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem'
                      }}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>

                {/* Campo de troco para dinheiro */}
                {checkoutPaymentMethod === 'dinheiro' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Valor entregue pelo cliente (Troco para):</label>
                    <input
                      type="text"
                      placeholder="Ex: 50"
                      value={checkoutChangeFor}
                      onChange={(e) => setCheckoutChangeFor(e.target.value.replace(/\D/g, ''))}
                      style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.85rem' }}
                    />
                    {checkoutChangeFor && parseFloat(checkoutChangeFor) > (partialPaymentInputAmount ? parseFloat(partialPaymentInputAmount) : remainingBalance) && (
                      <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '2px', fontWeight: 600 }}>
                        Troco a devolver: R$ {(parseFloat(checkoutChangeFor) - (partialPaymentInputAmount ? parseFloat(partialPaymentInputAmount) : remainingBalance)).toFixed(2).replace('.', ',')}
                      </div>
                    )}
                  </div>
                )}

                {/* Botão de Adicionar Pagamento em Dinheiro/Outros manuais */}
                {!isPointMethod && (
                  <button
                    type="button"
                    onClick={() => {
                      const chargeAmount = partialPaymentInputAmount ? parseFloat(partialPaymentInputAmount.replace(',', '.')) : remainingBalance;
                      if (isNaN(chargeAmount) || chargeAmount <= 0 || chargeAmount > remainingBalance) {
                        alert('Valor inválido para a cobrança.');
                        return;
                      }
                      setPartialPayments(prev => [
                        ...prev,
                        { method: checkoutPaymentMethod, amount: chargeAmount, id: Date.now().toString(), payerName: partialPaymentInputName }
                      ]);
                      setPartialPaymentInputAmount('');
                      setPartialPaymentInputName('');
                      setCheckoutChangeFor('');
                    }}
                    style={{
                      padding: '0.8rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                      border: 'none', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff',
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)', marginTop: '0.5rem'
                    }}
                  >
                    ✅ Registrar Pagamento ({checkoutPaymentMethod === 'dinheiro' ? 'Dinheiro' : 'Outro'})
                  </button>
                )}

                {/* Acionamento da Maquininha */}
                {isPointMethod && pointPaymentStatus === 'idle' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                    {pointDevices.length > 0 && (
                      <button
                        type="button"
                        disabled={pointPaymentLoading || remainingBalance <= 0}
                        onClick={() => handleTriggerPoint(pointDevices[0].id, pointDevices[0].label)}
                        style={{
                          padding: '0.8rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                          border: 'none', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff',
                          opacity: (pointPaymentLoading || remainingBalance <= 0) ? 0.5 : 1,
                          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                        }}
                      >
                        {pointPaymentLoading ? '⏳ Aguardando...' : `📲 Cobrar na Maquininha`}
                      </button>
                    )}
                    {pointPaymentError && (
                      <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: 0, textAlign: 'center' }}>⚠️ {pointPaymentError}</p>
                    )}
                  </div>
                )}

                {/* Status do pagamento na maquininha */}
                {isPointMethod && pointPaymentStatus === 'pending' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.4rem' }}>⏳</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--primary-gold)' }}>Aguardando pagamento na {pointDeviceLabel}...</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Siga as instruções na tela da maquininha. O sistema confirmará automaticamente.</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const intentId = pointIntentId;
                        const deviceId = selectedDeviceId;
                        setPointPaymentStatus('idle');
                        setPointIntentId('');
                        setPointPaymentError(null);
                        
                        if (intentId && deviceId) {
                          try {
                            let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
                            if (token === 'null' || token === 'undefined' || !token) token = 'mock';
                            
                            await fetch(`${API_BASE_URL}/api/pagamentos/cancel-point-order`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ token, deviceId, intentId })
                            });
                          } catch (err) {
                            console.error("Erro ao cancelar pagamento no Mercado Pago:", err);
                          }
                        }
                      }}
                      style={{
                        alignSelf: 'flex-start',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        color: '#f87171',
                        padding: '0.4rem 1rem',
                        borderRadius: '30px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      ❌ Cancelar Pagamento
                    </button>
                  </div>
                )}

                {isPointMethod && pointPaymentStatus === 'approved' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)' }}>
                    <span style={{ fontSize: '1.4rem' }}>✅</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#10b981' }}>Pagamento aprovado na {pointDeviceLabel}!</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Pagamento adicionado ao saldo.</div>
                    </div>
                  </div>
                )}

                {isPointMethod && pointPaymentStatus === 'rejected' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>❌</span>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#ef4444' }}>Pagamento recusado ou cancelado.</div>
                    </div>
                    {pointPaymentError && <p style={{ color: '#ef4444', fontSize: '0.78rem', margin: 0 }}>{pointPaymentError}</p>}
                    <button
                      type="button"
                      onClick={() => { setPointPaymentStatus('idle'); setPointIntentId(''); setPointPaymentError(null); }}
                      style={{ alignSelf: 'flex-start', padding: '0.35rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
                    >🔄 Tentar Novamente</button>
                  </div>
                )}
              </div>
            </>
          )}

              {/* Ações */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  disabled={pointPaymentStatus === 'pending'}
                  onClick={() => {
                    if (pointPaymentStatus !== 'pending') {
                      setSelectedCheckoutTable(null);
                      setCheckoutChangeFor('');
                      setCheckoutSelectedClients([]);
                      setPointPaymentStatus('idle');
                      setPointIntentId('');
                      setPointPaymentError(null);
                    }
                  }}
                  style={{ flex: 1, padding: '0.7rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', fontWeight: 600, cursor: pointPaymentStatus === 'pending' ? 'not-allowed' : 'pointer', opacity: pointPaymentStatus === 'pending' ? 0.5 : 1 }}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={!canClose || filteredOrders.length === 0}
                  onClick={() => handleManualTableCheckout(selectedCheckoutTable, filteredOrders)}
                  style={{
                    flex: 1.5, padding: '0.7rem', borderRadius: '10px', border: 'none',
                    background: canClose && filteredOrders.length > 0
                      ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                      : 'rgba(255,255,255,0.06)',
                    color: canClose && filteredOrders.length > 0 ? '#fff' : 'var(--text-secondary)',
                    fontWeight: 700,
                    cursor: canClose && filteredOrders.length > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  {remainingBalance > 0
                    ? `🔒 Faltam R$ ${remainingBalance.toFixed(2).replace('.', ',')}`
                    : '✅ Encerrar e Fechar Conta'}
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
                    {(() => {
                      const visConfig = storeConfig?.paymentMethodsVisibility || {};
                      const isMethodAllowed = (id: string) => {
                        let key = id;
                        if (id === 'debito' || id === 'credito') key = 'cartao';
                        const vis = visConfig[key] || 'both';
                        return vis === 'staff' || vis === 'both';
                      };
                      const methods = [
                        ['dinheiro', '💵 Dinheiro'],
                        ['debito', '💳 Débito'],
                        ['credito', '💳 Crédito'],
                        ['debito_point', '💴 Maq. Débito'],
                        ['credito_point', '💳 Maq. Crédito'],
                        ['pix', '🟡 Pix Manual']
                      ];
                      return methods.filter(([m]) => isMethodAllowed(m));
                    })().map(([method, label]) => (
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

      {/* Lightbox de Detalhes do Recibo (Itens do Pedido) */}
      {viewingReceiptDetails && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#0b0f19', borderRadius: '16px', width: '100%', maxWidth: '500px', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff' }}>{viewingReceiptDetails.title}</h3>
              <button 
                onClick={() => setViewingReceiptDetails(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {viewingReceiptDetails.orders.map((order, idx) => (
                <div key={order.id || idx} style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--primary-gold)', marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem' }}>
                    {order.orderType === 'dine_in_table' ? `Pedido na Mesa (Hora: ${new Date(order.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})})` : `Pedido ${order.dailySeq ? `#${order.dailySeq}` : ''}`}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.9rem' }}>
                    {order.items.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#ccc' }}>
                        <span>{item.quantity}x {item.name}</span>
                        <span>R$ {((item.price || 0) * item.quantity).toFixed(2).replace('.', ',')}</span>
                      </div>
                    ))}
                    {(order.deliveryFee ?? 0) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ccc' }}>
                        <span>Taxa de Entrega</span>
                        <span>R$ {order.deliveryFee?.toFixed(2).replace('.', ',')}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end', fontWeight: 600, color: '#fff' }}>
                    Subtotal: R$ {order.total.toFixed(2).replace('.', ',')}
                  </div>
                </div>
              ))}
              
              <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <span style={{ fontWeight: 600, color: 'var(--emerald-400, #34d399)' }}>Total Pago:</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--emerald-400, #34d399)' }}>
                  R$ {viewingReceiptDetails.orders.reduce((sum, o) => sum + o.total, 0).toFixed(2).replace('.', ',')}
                </span>
              </div>
              
              {(() => {
                const isAlreadyRefunded = viewingReceiptDetails.orders.some(o => o.refunded);
                const hasOnlinePayment = viewingReceiptDetails.orders.some(o => 
                  o.mercadoPagoPaymentId || o.mercadoPagoOrderId || o.stonePaymentId || 
                  (o.payments && o.payments.some((p: any) => p.id && ['pix', 'credito', 'credito_mp', 'google_pay'].includes(p.method)))
                );
                
                if (hasOnlinePayment) {
                  return (
                    <button
                      onClick={() => handleRefundReceipt(viewingReceiptDetails.orders)}
                      disabled={isAlreadyRefunded || refundLoading}
                      style={{
                        marginTop: '0.5rem',
                        width: '100%',
                        padding: '1rem',
                        background: isAlreadyRefunded ? 'rgba(255,255,255,0.05)' : 'rgba(239, 68, 68, 0.1)',
                        color: isAlreadyRefunded ? 'var(--text-secondary)' : '#ef4444',
                        border: `1px solid ${isAlreadyRefunded ? 'rgba(255,255,255,0.1)' : 'rgba(239, 68, 68, 0.2)'}`,
                        borderRadius: '12px',
                        cursor: isAlreadyRefunded || refundLoading ? 'not-allowed' : 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s'
                      }}
                    >
                      {refundLoading ? 'Processando Estorno...' : isAlreadyRefunded ? '✅ Pagamento Estornado' : 'Estornar Pagamento Online'}
                    </button>
                  );
                }
                return null;
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox do Detalhamento das Estatísticas de Pedidos */}
      {viewingStatsDetailType && (() => {
        const todayStr = getBusinessDay(new Date().toISOString());
        let filteredOrders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'awaiting_payment' && !(!o.paymentMethod && !o.paymentVerificationToken));

        // Aplicar a mesma lógica de filtros temporais
        if (timeFilterHours === 'all_day') {
          filteredOrders = filteredOrders.filter(o => getBusinessDay(o.createdAt) === todayStr);
        } else if (timeFilterHours === 'yesterday') {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = getBusinessDay(yesterday.toISOString());
          filteredOrders = filteredOrders.filter(o => getBusinessDay(o.createdAt) === yesterdayStr);
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
            filteredOrders = filteredOrders.filter(o => getBusinessDay(o.createdAt) === specificDateValue);
          } else {
            filteredOrders = [];
          }
        }

        // Sub-filtrar dependendo do card clicado
        if (viewingStatsDetailType === 'paid') {
          filteredOrders = filteredOrders.filter(o => 
            o.status === 'completed' || 
            ['pix', 'credito', 'credito_mp', 'google_pay'].includes(o.paymentMethod || '')
          );
        } else if (viewingStatsDetailType === 'unpaid') {
          filteredOrders = filteredOrders.filter(o => 
            o.status !== 'completed' && 
            !['pix', 'credito', 'credito_mp', 'google_pay'].includes(o.paymentMethod || '')
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
                            <button
                              type="button"
                              onClick={() => printOrder(order).catch(err => alert("Erro ao imprimir: " + err.message))}
                              title="Imprimir Cupom"
                              style={{
                                background: 'rgba(245, 158, 11, 0.1)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                borderRadius: '8px',
                                padding: '0.35rem 0.6rem',
                                color: 'var(--primary-gold)',
                                fontWeight: 700,
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                                marginLeft: '0.75rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                transition: 'background 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)'}
                            >
                              <Printer size={12} /> Imprimir
                            </button>
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

                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <span>Cliente: <strong style={{ color: '#fff' }}>{order.clientName}</strong></span>
                            <span>•</span>
                            <span>Tipo: <strong style={{ color: '#fff' }}>{getOrderTypeLabel(order)}</strong></span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }}>
                            {order.createdAt.substring(11, 16)} - Pagamento(s): {
                              order.payments && order.payments.length > 0 
                              ? order.payments.map(p => p.method.toUpperCase()).join(', ') 
                              : (order.paymentMethod ? order.paymentMethod.toUpperCase() : 'Não informado')
                            }
                            {['pix', 'credito', 'credito_mp', 'google_pay'].includes(order.paymentMethod || '') && order.payments && order.payments.length > 0 && order.payments[0].id && (
                              <div style={{ fontSize: '0.8rem', color: '#10b981', marginTop: '0.2rem', padding: '0.2rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '4px' }}>
                                ✅ Pedido já pago pelo cliente em seu próprio dispositivo.<br/>
                                <strong>ID Transação:</strong> {order.payments[0].id}
                              </div>
                            )}
                          </div>
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

const DeliveryTimer = ({ order }: { order: OrderDocument }) => {
  const [elapsedWait, setElapsedWait] = useState('');
  const [elapsedRoute, setElapsedRoute] = useState('');

  useEffect(() => {
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

    const updateTimers = () => {
      // 1. Waiting for deliverer timer (no balcão)
      const waitStart = order.kitchenFinishedAt ? new Date(order.kitchenFinishedAt).getTime() : null;
      if (waitStart) {
        const waitEnd = order.dispatchedAt ? new Date(order.dispatchedAt).getTime() : Date.now();
        const diffWait = Math.max(0, waitEnd - waitStart);
        setElapsedWait(formatDuration(diffWait));
      } else {
        setElapsedWait('--:--');
      }

      // 2. Out for delivery timer (em rota)
      if (order.dispatchedAt) {
        const routeStart = new Date(order.dispatchedAt).getTime();
        const routeEnd = order.deliveredAt ? new Date(order.deliveredAt).getTime() : Date.now();
        const diffRoute = Math.max(0, routeEnd - routeStart);
        setElapsedRoute(formatDuration(diffRoute));
      } else {
        setElapsedRoute('--:--');
      }
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);
    return () => clearInterval(interval);
  }, [order.kitchenFinishedAt, order.dispatchedAt, order.deliveredAt, order.status]);

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
        <span>Tempo no Balcão:</span>
        <strong style={{ color: order.dispatchedAt ? '#10b981' : 'var(--primary-gold)', fontFamily: 'monospace', fontSize: '0.95rem' }}>
          {order.dispatchedAt ? '✅ ' : '⏱️ '}{elapsedWait}
        </strong>
      </div>
      {order.status === 'delivering' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Tempo em Rota:</span>
          <strong style={{ color: 'var(--primary-gold)', fontFamily: 'monospace', fontSize: '0.95rem' }}>
            ⏱️ {elapsedRoute}
          </strong>
        </div>
      )}
    </div>
  );
};

