import { useEffect, useState } from 'react';
import { collection, query, onSnapshot, doc, setDoc, where, updateDoc, deleteDoc, addDoc, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';
import type { UserDocument } from '../../types/user';
import { useAuth } from '../../hooks/useAuth';
import { Users, AlertCircle, ShoppingBag, ShieldAlert, ArrowRightLeft, Lock, Unlock } from 'lucide-react';

export const TableMap = () => {
  const [activeTablesCount, setActiveTablesCount] = useState<number>(99);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [allClients, setAllClients] = useState<UserDocument[]>([]);
  const [activeOrders, setActiveOrders] = useState<OrderDocument[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  
  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('todas'); // 'todas' | 'livres' | 'ocupadas' | 'reservadas'
  const [rangeStart, setRangeStart] = useState<string>('');
  const [rangeEnd, setRangeEnd] = useState<string>('');

  // Selected table details modal
  const [selectedTable, setSelectedTable] = useState<number | null>(null);

  // Reservation form state inside modal
  const [isReserving, setIsReserving] = useState<boolean>(false);
  const [reserveName, setReserveName] = useState<string>('');
  const [reserveClientUid, setReserveClientUid] = useState<string>('');

  // Manually sitting client form state
  const [addUserUid, setAddUserUid] = useState<string>('');

  // State for inline expanded client order details
  const [expandedClientKey, setExpandedClientKey] = useState<string | null>(null);



  // 1. Escuta a configuração de mesas ativa
  useEffect(() => {
    const docRef = doc(db, 'settings', 'tables_config');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setActiveTablesCount(docSnap.data().activeTablesCount || 99);
      } else {
        setActiveTablesCount(99);
      }
      setLoadingConfig(false);
    }, (err) => {
      console.error("Erro ao escutar tables_config:", err);
      setLoadingConfig(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. Escuta todos os usuários com mesas vinculadas
  useEffect(() => {
    const q = query(
      collection(db, 'users'), 
      where('tableNumber', '!=', null)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: UserDocument[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as UserDocument);
      });
      setUsers(list);
    }, (err) => {
      console.error("Erro ao escutar usuários vinculados:", err);
    });

    return () => unsubscribe();
  }, []);

  // 3. Escuta todos os clientes cadastrados para a reserva e vínculo manual
  useEffect(() => {
    const q = query(
      collection(db, 'users'), 
      where('role', '==', 'client')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: UserDocument[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as UserDocument);
      });
      setAllClients(list);
    }, (err) => {
      console.error("Erro ao escutar clientes cadastrados:", err);
    });

    return () => unsubscribe();
  }, []);

  // 4. Escuta todas as reservas ativas
  useEffect(() => {
    const q = collection(db, 'reservations');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((d) => {
        list.push(d.data());
      });
      setReservations(list);
    }, (err) => {
      console.error("Erro ao escutar reservas:", err);
    });

    return () => unsubscribe();
  }, []);

  // 5. Escuta todos os pedidos ativos de mesa (dine_in_table)
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('orderType', '==', 'dine_in_table')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: OrderDocument[] = [];
      snapshot.forEach((d) => {
        const order = { id: d.id, ...d.data() } as OrderDocument;
        if (order.status !== 'completed' && order.status !== 'cancelled') {
          list.push(order);
        }
      });
      setActiveOrders(list);
    }, (err) => {
      console.error("Erro ao escutar pedidos ativos de mesa:", err);
    });

    return () => unsubscribe();
  }, []);

  // Atualiza no banco quantas mesas estamos trabalhando hoje
  const handleUpdateActiveTables = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    if (isNaN(val) || val < 1) return;
    
    // Limit to 99 for performance and sanity
    const finalVal = Math.min(val, 99);
    
    setActiveTablesCount(finalVal);
    try {
      await setDoc(doc(db, 'settings', 'tables_config'), {
        activeTablesCount: finalVal,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Erro ao salvar quantidade de mesas:", err);
    }
  };

  const { userData } = useAuth();

  const handleApproveCashierOrder = async (order: OrderDocument) => {
    if (!order.id) return;
    try {
      const orderDocRef = doc(db, 'orders', order.id);
      await updateDoc(orderDocRef, {
        status: 'pending',
        kitchenEnteredAt: new Date().toISOString()
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

  const handleReproveCashierOrder = async (order: OrderDocument) => {
    if (!order.id) return;
    if (window.confirm(`Deseja realmente reprovar a baixa do Pedido #${order.id.slice(-4).toUpperCase()}?`)) {
      try {
        const orderDocRef = doc(db, 'orders', order.id);
        await updateDoc(orderDocRef, {
          status: 'pending',
          paymentMethod: null,
          changeFor: null
        });
        alert('Pedido reprovado com sucesso. O cliente poderá selecionar um novo método de pagamento no app.');
      } catch (err) {
        console.error('Erro ao reprovar pedido no caixa:', err);
        alert('Erro ao reprovar pedido. Tente novamente.');
      }
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

  const handleCancelOrderFromMap = async (orderId?: string) => {
    if (!orderId) return;
    const reason = window.prompt("Informe o motivo do cancelamento deste pedido:", "Cancelado pela gerência via Mapa de Mesas");
    if (reason === null) return; // cancelou o prompt
    if (!reason.trim()) {
      alert("Por favor, informe o motivo do cancelamento.");
      return;
    }

    try {
      const order = activeOrders.find(o => o.id === orderId);
      const orderDocRef = doc(db, 'orders', orderId);
      await updateDoc(orderDocRef, {
        status: 'cancelled',
        cancelReason: reason,
        cancelledAt: new Date().toISOString(),
        cancelledBy: userData?.name || userData?.email || 'Gerente',
      });

      if (order) {
        const otherActive = activeOrders.some(o => 
          o.id !== orderId && 
          o.orderType === 'dine_in_table' && 
          o.tableNumber === order.tableNumber && 
          !['completed', 'cancelled'].includes(o.status)
        );
        
        if (!otherActive && order.tableNumber) {
          const usersRef = collection(db, 'users');
          const q = query(usersRef, where('tableNumber', '==', order.tableNumber));
          const querySnapshot = await getDocs(q);
          const batchPromises = querySnapshot.docs.map((userDoc: any) => 
            updateDoc(doc(db, 'users', userDoc.id), {
              tableNumber: null,
              updatedAt: new Date().toISOString()
            })
          );
          await Promise.all(batchPromises);
        }
      }

      alert('Pedido cancelado com sucesso!');
    } catch (error) {
      console.error("Erro ao cancelar o pedido:", error);
      alert('Ocorreu um erro ao cancelar o pedido.');
    }
  };

  // Executa a reserva da mesa
  const handleConfirmReservation = async () => {
    if (!selectedTable) return;
    try {
      let linkedName = reserveName.trim();
      
      // Se selecionou cliente registrado, pega o nome dele
      if (reserveClientUid) {
        const client = allClients.find(c => c.uid === reserveClientUid);
        if (client && !linkedName) {
          linkedName = client.name;
        }
      }

      await setDoc(doc(db, 'reservations', String(selectedTable)), {
        tableNumber: String(selectedTable),
        reserved: true,
        clientName: linkedName || 'Reserva Geral',
        clientUid: reserveClientUid || null,
        reservedAt: new Date().toISOString()
      });

      // Se havia algum cliente sentado na mesa, desvincula ele para limpar o login
      const linkedUsers = users.filter(u => u.tableNumber === String(selectedTable));
      for (const u of linkedUsers) {
        // Se a reserva é para esse cliente específico, não o desvincula!
        if (u.uid === reserveClientUid) continue;
        await updateDoc(doc(db, 'users', u.uid), {
          tableNumber: null,
          updatedAt: new Date().toISOString()
        });
      }

      setIsReserving(false);
      setReserveName('');
      setReserveClientUid('');
      alert(`Mesa ${selectedTable} reservada com sucesso!`);
    } catch (err) {
      console.error("Erro ao reservar mesa:", err);
      alert("Erro ao salvar a reserva da mesa. Verifique a implantação das regras.");
    }
  };

  // Cancela/remove a reserva de uma mesa
  const handleCancelReservation = async (tableNum: number) => {
    if (window.confirm(`Deseja realmente remover a reserva da Mesa ${tableNum}?`)) {
      try {
        await deleteDoc(doc(db, 'reservations', String(tableNum)));
        alert(`Reserva da Mesa ${tableNum} removida com sucesso!`);
      } catch (err) {
        console.error("Erro ao remover reserva:", err);
        alert("Erro ao remover reserva.");
      }
    }
  };

  // Libera a mesa (torna ela livre, desvinculando clientes e pedidos ativos)
  const handleFreeTable = async (tableNum: number) => {
    if (window.confirm(`Deseja realmente liberar a Mesa ${tableNum}? Isso desvinculará todos os smartphones de clientes e pedidos ativos associados a esta mesa.`)) {
      try {
        // 1. Desvincular clientes vinculados no banco
        const linkedUsers = users.filter(u => u.tableNumber === String(tableNum));
        const userPromises = linkedUsers.map(u => 
          updateDoc(doc(db, 'users', u.uid), {
            tableNumber: null,
            updatedAt: new Date().toISOString()
          })
        );
        await Promise.all(userPromises);

        // 2. Desvincular pedidos ativos no banco
        const tableOrders = activeOrders.filter(o => o.tableNumber === String(tableNum));
        const orderPromises = tableOrders.map(o => {
          if (!o.id) return Promise.resolve();
          return updateDoc(doc(db, 'orders', o.id), {
            tableNumber: null
          });
        });
        await Promise.all(orderPromises);

        alert(`Mesa ${tableNum} liberada com sucesso!`);
        setSelectedTable(null);
      } catch (err) {
        console.error("Erro ao liberar mesa:", err);
        alert("Erro ao liberar a mesa.");
      }
    }
  };

  // Senta um cliente cadastrado na mesa manualmente
  const handleLinkUser = async () => {
    if (!selectedTable || !addUserUid) return;
    try {
      const client = allClients.find(c => c.uid === addUserUid);
      if (!client) return;

      // Verifica se a mesa possui reserva de outra pessoa
      const res = reservations.find(r => r.tableNumber === String(selectedTable));
      if (res && res.clientUid !== addUserUid) {
        alert(`Não é possível sentar o cliente aqui pois esta mesa está reservada para "${res.clientName}".`);
        return;
      }

      await updateDoc(doc(db, 'users', addUserUid), {
        tableNumber: String(selectedTable),
        updatedAt: new Date().toISOString()
      });

      setAddUserUid('');
      alert(`Cliente ${client.name} sentado na Mesa ${selectedTable} com sucesso!`);
    } catch (err) {
      console.error("Erro ao vincular cliente à mesa:", err);
      alert("Erro ao sentar cliente na mesa. Verifique a implantação das regras.");
    }
  };

  // Desvincula um cliente individual da mesa
  const handleUnlinkUser = async (userUid: string, userName: string) => {
    if (window.confirm(`Deseja realmente desvincular o cliente ${userName} desta mesa?`)) {
      try {
        await updateDoc(doc(db, 'users', userUid), {
          tableNumber: null,
          updatedAt: new Date().toISOString()
        });
        alert(`Cliente ${userName} removido da mesa.`);
      } catch (err) {
        console.error("Erro ao desvincular cliente:", err);
        alert("Erro ao desvincular cliente.");
      }
    }
  };

  // Transfere os clientes e pedidos ativos para outra mesa
  const handleTransferTable = async (sourceTable: number) => {
    const input = window.prompt(`Para qual mesa deseja transferir os clientes da Mesa ${sourceTable}? (Digite o número da mesa de 1 a ${activeTablesCount})`);
    if (input === null) return;
    
    const cleaned = input.trim();
    const targetTableNum = parseInt(cleaned);
    if (isNaN(targetTableNum) || targetTableNum < 1 || targetTableNum > activeTablesCount) {
      alert(`Por favor, digite um número de mesa válido de 1 a ${activeTablesCount}.`);
      return;
    }

    if (targetTableNum === sourceTable) {
      alert("A mesa de destino não pode ser a mesma mesa de origem.");
      return;
    }

    // Verifica se a mesa de destino possui alguma reserva
    const targetRes = reservations.find(r => r.tableNumber === String(targetTableNum));
    if (targetRes) {
      const confirmTransfer = window.confirm(`A Mesa de destino (${targetTableNum}) está reservada para "${targetRes.clientName}". Deseja prosseguir com a transferência mesmo assim?`);
      if (!confirmTransfer) return;
    }

    try {
      // 1. Transferir usuários vinculados
      const linkedUsers = users.filter(u => u.tableNumber === String(sourceTable));
      const userPromises = linkedUsers.map(u => 
        updateDoc(doc(db, 'users', u.uid), {
          tableNumber: String(targetTableNum),
          updatedAt: new Date().toISOString()
        })
      );
      await Promise.all(userPromises);

      // 2. Transferir pedidos ativos
      const tableOrders = activeOrders.filter(o => o.tableNumber === String(sourceTable));
      const orderPromises = tableOrders.map(o => {
        if (!o.id) return Promise.resolve();
        return updateDoc(doc(db, 'orders', o.id), {
          tableNumber: String(targetTableNum)
        });
      });
      await Promise.all(orderPromises);

      alert(`Clientes e pedidos transferidos com sucesso da Mesa ${sourceTable} para a Mesa ${targetTableNum}!`);
      setSelectedTable(null);
    } catch (err) {
      console.error("Erro ao transferir mesa:", err);
      alert("Erro ao concluir a transferência de mesa.");
    }
  };

  // Processa as mesas para renderização
  const tables = Array.from({ length: activeTablesCount }, (_, i) => i + 1);

  // Mapeia mesas e seus status
  const tablesWithState = tables.map((num) => {
    const tableStr = String(num);
    const linkedUsers = users.filter((u) => u.tableNumber === tableStr);
    const tableOrders = activeOrders.filter((o) => o.tableNumber === tableStr);
    
    // Uma mesa está reservada se houver registro de reserva
    const reservation = reservations.find(r => r.tableNumber === tableStr);
    const isReserved = !!reservation;
    
    // Uma mesa está ocupada se não estiver reservada e contiver clientes ou pedidos ativos
    const isOccupied = !isReserved && (linkedUsers.length > 0 || tableOrders.length > 0);

    return {
      number: num,
      isOccupied,
      isReserved,
      reservation,
      users: linkedUsers,
      orders: tableOrders,
    };
  });

  // Filtra as mesas com base nos filtros
  const filteredTables = tablesWithState.filter((t) => {
    // Filtro de Status
    if (filterStatus === 'livres' && (t.isOccupied || t.isReserved)) return false;
    if (filterStatus === 'ocupadas' && !t.isOccupied) return false;
    if (filterStatus === 'reservadas' && !t.isReserved) return false;

    // Filtro de Range
    const start = rangeStart ? parseInt(rangeStart) : null;
    const end = rangeEnd ? parseInt(rangeEnd) : null;

    if (start !== null && t.number < start) return false;
    if (end !== null && t.number > end) return false;

    return true;
  });

  const getOrderStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'pending': return { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' };
      case 'preparing': return { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' };
      case 'ready': return { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' };
      case 'delivering':
      case 'aguardando_caixa':
      case 'pendente_pagamento':
        return { bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981' };
      default: return { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' };
    }
  };

  const getOrderStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'preparing': return 'Preparando';
      case 'ready': return 'Pronto';
      case 'delivering': return 'Entregue na Mesa';
      case 'aguardando_caixa': return 'Fechando Conta';
      case 'pendente_pagamento': return 'Aguardando Pagamento';
      default: return status;
    }
  };

  const selectedTableData = selectedTable 
    ? tablesWithState.find(t => t.number === selectedTable) 
    : null;

  return (
    <div className="dashboard-layout animate-fade-in" style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#fff' }}>
            🪑 Mapa de Mesas
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Acompanhe a ocupação, reservas e os pedidos das mesas do salão em tempo real.
          </p>
        </div>
        
        {/* Pergunta de Configuração */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.8rem', 
          background: 'rgba(255,255,255,0.02)', 
          padding: '0.6rem 1rem', 
          borderRadius: '12px', 
          border: '1px solid rgba(255,255,255,0.05)' 
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Com quais mesas estamos trabalhando hoje?
          </span>
          {loadingConfig ? (
            <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
          ) : (
            <input 
              type="number" 
              value={activeTablesCount} 
              onChange={handleUpdateActiveTables}
              min={1} 
              max={99} 
              style={{ 
                width: '65px', 
                padding: '0.35rem 0.5rem', 
                borderRadius: '8px', 
                border: '1px solid rgba(245, 158, 11, 0.3)', 
                background: '#0b0f19', 
                color: 'var(--primary-gold)', 
                fontWeight: 700, 
                textAlign: 'center',
                fontSize: '0.9rem'
              }} 
            />
          )}
        </div>
      </div>

      {/* Barra de Filtros */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        flexWrap: 'wrap', 
        gap: '1rem', 
        background: 'rgba(255,255,255,0.01)', 
        border: '1px solid rgba(255,255,255,0.04)', 
        padding: '1rem', 
        borderRadius: '16px', 
        marginBottom: '2rem' 
      }}>
        {/* Status */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['todas', 'livres', 'ocupadas', 'reservadas'].map(status => {
            const count = status === 'todas' 
              ? tablesWithState.length 
              : status === 'livres' 
                ? tablesWithState.filter(t => !t.isOccupied && !t.isReserved).length 
                : status === 'ocupadas'
                  ? tablesWithState.filter(t => t.isOccupied).length
                  : tablesWithState.filter(t => t.isReserved).length;

            return (
              <button
                key={status}
                type="button"
                onClick={() => setFilterStatus(status)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: filterStatus === status ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)',
                  background: filterStatus === status ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                  color: filterStatus === status ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <span>
                  {status === 'todas' ? 'Todas' : status === 'livres' ? 'Livres' : status === 'ocupadas' ? 'Ocupadas' : 'Reservadas'}
                </span>
                <span style={{ 
                  fontSize: '0.75rem', 
                  background: filterStatus === status ? 'var(--primary-gold)' : 'rgba(255,255,255,0.1)', 
                  color: filterStatus === status ? '#0b0f19' : 'var(--text-primary)', 
                  padding: '1px 6px', 
                  borderRadius: '10px',
                  fontWeight: 700
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Filtrar Intervalo:</span>
          <input 
            type="number" 
            placeholder="De"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            min={1}
            max={activeTablesCount}
            style={{ width: '60px', padding: '0.45rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}
          />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>até</span>
          <input 
            type="number" 
            placeholder="Até"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            min={1}
            max={activeTablesCount}
            style={{ width: '60px', padding: '0.45rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}
          />
          {(rangeStart || rangeEnd) && (
            <button 
              type="button" 
              onClick={() => { setRangeStart(''); setRangeEnd(''); }}
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'underline' }}
            >
              Limpar Filtro
            </button>
          )}
        </div>
      </div>

      {/* Grid de Mesas */}
      {filteredTables.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '20px' }}>
          <AlertCircle size={36} style={{ color: 'var(--text-secondary)', marginBottom: '0.8rem' }} />
          <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Nenhuma mesa encontrada</h3>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Ajuste os filtros ou o intervalo das mesas.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1.2rem' }}>
          {filteredTables.map((table) => {
            const ordersCount = table.orders.length;

            let cardBg = 'rgba(16, 185, 129, 0.02)';
            let borderColor = 'rgba(16, 185, 129, 0.15)';
            let circleColor = '#10b981';
            let statusText = 'Livre';
            let statusColor = '#10b981';

            if (table.isReserved) {
              cardBg = 'rgba(139, 92, 246, 0.03)';
              borderColor = 'rgba(139, 92, 246, 0.25)';
              circleColor = '#8b5cf6';
              statusText = 'Reservada';
              statusColor = '#a78bfa';
            } else if (table.isOccupied) {
              const hasUnpaid = table.orders.length > 0;
              if (hasUnpaid) {
                cardBg = 'rgba(239, 68, 68, 0.03)';
                borderColor = 'rgba(239, 68, 68, 0.25)';
                circleColor = '#ef4444';
                statusText = 'Ocupada';
                statusColor = '#ef4444';
              } else {
                cardBg = 'rgba(59, 130, 246, 0.03)';
                borderColor = 'rgba(59, 130, 246, 0.25)';
                circleColor = '#3b82f6';
                statusText = 'Pago';
                statusColor = '#60a5fa';
              }
            }

            return (
              <div 
                key={table.number}
                onClick={() => { setSelectedTable(table.number); setIsReserving(false); setAddUserUid(''); }}
                style={{
                  background: cardBg,
                  border: borderColor,
                  borderRadius: '16px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.6rem',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.2s',
                  boxShadow: table.isOccupied ? '0 4px 20px rgba(59, 130, 246, 0.05)' : table.isReserved ? '0 4px 20px rgba(139, 92, 246, 0.05)' : 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.borderColor = table.isReserved 
                    ? '#8b5cf6' 
                    : table.isOccupied 
                      ? (table.orders.length > 0 ? '#ef4444' : '#3b82f6') 
                      : '#10b981';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = borderColor;
                }}
              >
                {/* Ícone ou Desenho de Mesa Mini */}
                <div style={{
                  width: '50px',
                  height: '50px',
                  borderRadius: '50%',
                  background: circleColor,
                  color: '#0b0f19',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.15)'
                }}>
                  {table.number}
                </div>

                {/* Status */}
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: statusColor,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {statusText}
                </span>

                {/* Cliente / Detalhes Rápidos */}
                {table.isReserved && (
                  <div style={{ width: '100%', textAlign: 'center', marginTop: '0.2rem' }}>
                    <div style={{ 
                      fontSize: '0.8rem', 
                      color: '#a78bfa', 
                      fontWeight: 600, 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis',
                      maxWidth: '120px'
                    }}>
                      🔒 {table.reservation?.clientName || 'Reservado'}
                    </div>
                  </div>
                )}

                {!table.isReserved && table.isOccupied && (
                  <div style={{ width: '100%', textAlign: 'center', marginTop: '0.2rem' }}>
                    <div 
                      style={{ 
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%'
                      }}
                    >
                      {table.users.length > 0 ? (
                        table.users.map((u) => {
                          const clientHasUnpaid = table.orders.some(o => o.clientUid === u.uid);
                          const clientOrders = table.orders.filter(o => o.clientUid === u.uid);
                          const isExpanded = expandedClientKey === u.uid;

                          return (
                            <div 
                              key={u.uid}
                              style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}
                            >
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation(); // impede abertura do modal principal da mesa
                                  setExpandedClientKey(isExpanded ? null : u.uid);
                                }}
                                style={{ 
                                  fontSize: '0.78rem', 
                                  color: '#fff', 
                                  fontWeight: 600, 
                                  whiteSpace: 'nowrap', 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis',
                                  maxWidth: '120px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  cursor: 'pointer',
                                  padding: '2px 6px',
                                  borderRadius: '6px',
                                  background: isExpanded ? 'rgba(255,255,255,0.08)' : 'transparent',
                                  border: isExpanded ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent'
                                }}
                                title={`${u.name} (Clique para gerenciar pedido)`}
                              >
                                <span>👤 {u.name}</span>
                                {!clientHasUnpaid && (
                                  <span style={{ 
                                    color: '#10b981', 
                                    fontWeight: 800, 
                                    fontSize: '0.75rem',
                                    textTransform: 'uppercase'
                                  }}>
                                    pg
                                  </span>
                                )}
                              </div>

                              {/* Card do Caixa flutuante para este cliente específico */}
                              {isExpanded && clientOrders.length > 0 && (
                                <div 
                                  onClick={(e) => e.stopPropagation()} // evita fechar ao interagir com o card
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    width: '280px',
                                    background: '#151d30',
                                    border: '1px solid rgba(255, 255, 255, 0.12)',
                                    borderRadius: '12px',
                                    padding: '0.85rem',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                                    zIndex: 1000,
                                    marginTop: '6px',
                                    textAlign: 'left',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                  }}
                                >
                                  {/* Botão de Fechar Pop-up */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.4rem' }}>
                                    <span style={{ fontWeight: 800, color: '#fff', fontSize: '0.82rem' }}>GERENCIAR PEDIDO</span>
                                    <button 
                                      onClick={() => setExpandedClientKey(null)}
                                      style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                      ✕
                                    </button>
                                  </div>

                                  {clientOrders.map((order) => (
                                    <div key={order.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      {/* Cabeçalho do Pedido */}
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>
                                          Pedido #{order.dailySeq || '---'}
                                        </span>
                                        <span style={{ fontWeight: 800, color: 'var(--primary-gold)', fontSize: '0.88rem' }}>
                                          R$ {order.total.toFixed(2).replace('.', ',')}
                                        </span>
                                      </div>

                                      {/* Detalhes de Contato e Pagamento */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                                        {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                                        <div>Método: <strong style={{ color: 'var(--primary-gold)' }}>{order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : '💴 Cartão (maquininha)'}</strong></div>
                                        {order.paymentMethod === 'dinheiro' && order.changeFor && (
                                          <div style={{ color: '#ef4444' }}>Troco para: R$ {order.changeFor.toFixed(2).replace('.', ',')}</div>
                                        )}
                                      </div>

                                      {/* Itens do Pedido */}
                                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.4rem', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        {order.items.map((item, idx) => (
                                          <div key={idx} style={{ fontSize: '0.78rem', color: '#e5e7eb' }}>
                                            <strong style={{ color: 'var(--primary-gold)' }}>{item.quantity}x</strong> {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}
                                          </div>
                                        ))}
                                        {(order.serviceFee ?? 0) > 0 && (
                                          <div style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontStyle: 'italic', marginTop: '2px' }}>
                                            🪑 Taxa de Serviço (10%): R$ {order.serviceFee?.toFixed(2).replace('.', ',')}
                                          </div>
                                        )}
                                        {order.orderType === 'dine_in_table' && (order.serviceFee ?? 0) === 0 && (
                                          <div style={{ fontSize: '0.75rem', color: '#ef4444', fontStyle: 'italic', marginTop: '2px' }}>
                                            🪑 Taxa de Serviço (10%): Isento/Não cobrado
                                          </div>
                                        )}
                                      </div>

                                      {/* Botões de Ação */}
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem' }}>
                                        <button
                                          type="button"
                                          onClick={() => handleApproveCashierOrder(order)}
                                          style={{ padding: '0.45rem', background: '#10b981', color: '#0b0f19', border: 'none', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                                        >
                                          ✓ Aprovar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleReproveCashierOrder(order)}
                                          style={{ padding: '0.45rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                                        >
                                          ✗ Reprovar
                                        </button>
                                      </div>

                                      {/* Ações adicionais de Taxa de Serviço */}
                                      {order.orderType === 'dine_in_table' && (
                                        <div style={{ width: '100%', marginTop: '0.2rem' }}>
                                          {(order.serviceFee ?? 0) > 0 ? (
                                            <button
                                              type="button"
                                              onClick={() => handleWaiveServiceFee(order)}
                                              style={{ width: '100%', padding: '0.4rem', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--primary-gold)', border: '1px dashed var(--primary-gold)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                                            >
                                              Isentar 10%
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => handleRestoreServiceFee(order)}
                                              style={{ width: '100%', padding: '0.4rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px dashed #10b981', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                                            >
                                              Cobrar 10%
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        table.orders[0] && (() => {
                          const fallbackKey = `${table.number}_fallback`;
                          const isExpanded = expandedClientKey === fallbackKey;
                          return (
                            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                              <div 
                                onClick={(e) => {
                                  e.stopPropagation(); // impede abertura do modal
                                  setExpandedClientKey(isExpanded ? null : fallbackKey);
                                }}
                                style={{ 
                                  fontSize: '0.78rem', 
                                  color: '#fff', 
                                  fontWeight: 600, 
                                  whiteSpace: 'nowrap', 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis',
                                  maxWidth: '120px',
                                  cursor: 'pointer',
                                  padding: '2px 6px',
                                  borderRadius: '6px',
                                  background: isExpanded ? 'rgba(255,255,255,0.08)' : 'transparent',
                                  border: isExpanded ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent'
                                }}
                                title={`${table.orders[0].clientName} (Clique para gerenciar pedido)`}
                              >
                                👤 {table.orders[0].clientName}
                              </div>

                              {/* Card do Caixa flutuante para pedido sem login vinculado */}
                              {isExpanded && (
                                <div 
                                  onClick={(e) => e.stopPropagation()} // evita fechar ao interagir com o card
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    width: '280px',
                                    background: '#151d30',
                                    border: '1px solid rgba(255, 255, 255, 0.12)',
                                    borderRadius: '12px',
                                    padding: '0.85rem',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
                                    zIndex: 1000,
                                    marginTop: '6px',
                                    textAlign: 'left',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                  }}
                                >
                                  {/* Botão de Fechar Pop-up */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.4rem' }}>
                                    <span style={{ fontWeight: 800, color: '#fff', fontSize: '0.82rem' }}>GERENCIAR PEDIDO</span>
                                    <button 
                                      onClick={() => setExpandedClientKey(null)}
                                      style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                      ✕
                                    </button>
                                  </div>

                                  {table.orders.map((order) => (
                                    <div key={order.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      {/* Cabeçalho do Pedido */}
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.85rem' }}>
                                          Pedido #{order.dailySeq || '---'}
                                        </span>
                                        <span style={{ fontWeight: 800, color: 'var(--primary-gold)', fontSize: '0.88rem' }}>
                                          R$ {order.total.toFixed(2).replace('.', ',')}
                                        </span>
                                      </div>

                                      {/* Detalhes de Contato e Pagamento */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        <div>Nome: <strong style={{ color: '#fff' }}>{order.clientName}</strong></div>
                                        {order.clientPhone && <div>Celular: <strong style={{ color: '#fff' }}>{order.clientPhone}</strong></div>}
                                        <div>Método: <strong style={{ color: 'var(--primary-gold)' }}>{order.paymentMethod === 'dinheiro' ? '💵 Dinheiro' : order.paymentMethod === 'pagar_final' ? '🍽️ Pagar no Final' : '💴 Cartão (maquininha)'}</strong></div>
                                        {order.paymentMethod === 'dinheiro' && order.changeFor && (
                                          <div style={{ color: '#ef4444' }}>Troco para: R$ {order.changeFor.toFixed(2).replace('.', ',')}</div>
                                        )}
                                      </div>

                                      {/* Itens do Pedido */}
                                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.4rem', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        {order.items.map((item, idx) => (
                                          <div key={idx} style={{ fontSize: '0.78rem', color: '#e5e7eb' }}>
                                            <strong style={{ color: 'var(--primary-gold)' }}>{item.quantity}x</strong> {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}
                                          </div>
                                        ))}
                                        {(order.serviceFee ?? 0) > 0 && (
                                          <div style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontStyle: 'italic', marginTop: '2px' }}>
                                            🪑 Taxa de Serviço (10%): R$ {order.serviceFee?.toFixed(2).replace('.', ',')}
                                          </div>
                                        )}
                                        {order.orderType === 'dine_in_table' && (order.serviceFee ?? 0) === 0 && (
                                          <div style={{ fontSize: '0.75rem', color: '#ef4444', fontStyle: 'italic', marginTop: '2px' }}>
                                            🪑 Taxa de Serviço (10%): Isento/Não cobrado
                                          </div>
                                        )}
                                      </div>

                                      {/* Botões de Ação */}
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem' }}>
                                        <button
                                          type="button"
                                          onClick={() => handleApproveCashierOrder(order)}
                                          style={{ padding: '0.45rem', background: '#10b981', color: '#0b0f19', border: 'none', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                                        >
                                          ✓ Aprovar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleReproveCashierOrder(order)}
                                          style={{ padding: '0.45rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                                        >
                                          ✗ Reprovar
                                        </button>
                                      </div>

                                      {/* Ações adicionais de Taxa de Serviço */}
                                      {order.orderType === 'dine_in_table' && (
                                        <div style={{ width: '100%', marginTop: '0.2rem' }}>
                                          {(order.serviceFee ?? 0) > 0 ? (
                                            <button
                                              type="button"
                                              onClick={() => handleWaiveServiceFee(order)}
                                              style={{ width: '100%', padding: '0.4rem', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--primary-gold)', border: '1px dashed var(--primary-gold)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                                            >
                                              Isentar 10%
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => handleRestoreServiceFee(order)}
                                              style={{ width: '100%', padding: '0.4rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px dashed #10b981', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                                            >
                                              Cobrar 10%
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </div>
                    {ordersCount > 0 && (
                      <span style={{ 
                        fontSize: '0.75rem', 
                        background: 'rgba(255,255,255,0.08)', 
                        padding: '1px 6px', 
                        borderRadius: '10px', 
                        color: 'var(--text-secondary)',
                        display: 'inline-block',
                        marginTop: '0.2rem'
                      }}>
                        {ordersCount} {ordersCount === 1 ? 'pedido' : 'pedidos'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox / Modal de Detalhes da Mesa */}
      {selectedTableData && (
        <div 
          className="lightbox-overlay"
          onClick={() => { setSelectedTable(null); setIsReserving(false); setAddUserUid(''); }}
          style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: selectedTableData.isReserved ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              padding: '1.75rem',
              width: '90%',
              maxWidth: '500px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.8)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem'
            }}
          >
            {/* Cabeçalho Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: selectedTableData.isReserved ? '#8b5cf6' : selectedTableData.isOccupied ? 'var(--primary-gold)' : '#10b981',
                  color: '#0b0f19',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '1rem'
                }}>
                  {selectedTableData.number}
                </div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>
                  Detalhes da Mesa {selectedTableData.number} 
                  {selectedTableData.isReserved && <span style={{ color: '#a78bfa', fontSize: '0.85rem', marginLeft: '0.5rem' }}>(Reservada)</span>}
                </h3>
              </div>
              <button 
                type="button" 
                onClick={() => { setSelectedTable(null); setIsReserving(false); setAddUserUid(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem', fontWeight: 300 }}
              >
                ✕
              </button>
            </div>

            {/* Caso esteja em modo formulário de reserva */}
            {isReserving ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                <h4 style={{ margin: 0, color: 'var(--primary-gold)', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Lock size={15} /> Reservar Mesa {selectedTable}
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Nome da Reserva / Cliente:</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Família Silva" 
                    value={reserveName}
                    onChange={(e) => setReserveName(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.9rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Vincular a uma Conta Cadastrada (Opcional):</label>
                  <select 
                    value={reserveClientUid}
                    onChange={(e) => setReserveClientUid(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.9rem' }}
                  >
                    <option value="">-- Não vincular (qualquer login será impedido) --</option>
                    {allClients.map(c => (
                      <option key={c.uid} value={c.uid}>{c.name} {c.phoneNumber ? `(${c.phoneNumber})` : ''}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    * Se vinculado, somente o smartphone deste cliente específico conseguirá ocupar a mesa ao escanear o QR Code.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button 
                    type="button" 
                    onClick={() => setIsReserving(false)}
                    style={{ padding: '0.45rem 1rem', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Voltar
                  </button>
                  <button 
                    type="button" 
                    onClick={handleConfirmReservation}
                    style={{ padding: '0.45rem 1rem', borderRadius: '8px', border: 'none', background: 'var(--primary-gold)', color: '#0b0f19', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Confirmar Reserva
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Visualização Normal: Exibe detalhes da reserva ou ocupação */}
                {selectedTableData.isReserved && (
                  <div style={{
                    background: 'rgba(139, 92, 246, 0.08)',
                    borderLeft: '4px solid #8b5cf6',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    color: '#a78bfa'
                  }}>
                    🔒 <strong>Mesa Reservada:</strong> {selectedTableData.reservation?.clientName || 'Reserva Geral'}
                    {selectedTableData.reservation?.clientUid && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                        Vinculado ao cliente ID: {selectedTableData.reservation.clientUid.slice(-6).toUpperCase()}
                      </div>
                    )}
                  </div>
                )}

                {/* Ocupantes / Clientes Sentados */}
                {!selectedTableData.isReserved && (
                  <div>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Users size={14} /> Clientes Vinculados (Sentados)
                    </h4>
                    {selectedTableData.users.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '0.5rem' }}>
                        Nenhum smartphone de cliente conectado a esta mesa no momento.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.5rem' }}>
                        {selectedTableData.users.map((u) => (
                          <div key={u.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>{u.name}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              {u.phoneNumber && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{u.phoneNumber}</span>}
                              <button 
                                type="button" 
                                onClick={() => handleUnlinkUser(u.uid, u.name)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}
                                title={`Remover ${u.name} da Mesa`}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Vínculo Manual de Clientes (Permite sentar um ou vários clientes) */}
                    <div style={{ 
                      marginTop: '0.75rem', 
                      background: 'rgba(255,255,255,0.01)', 
                      border: '1px dashed rgba(255,255,255,0.08)', 
                      padding: '0.75rem', 
                      borderRadius: '12px' 
                    }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                        Sentar Cliente na Mesa (Manual):
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <select 
                          value={addUserUid}
                          onChange={(e) => setAddUserUid(e.target.value)}
                          style={{ flex: 1, padding: '0.4rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0b0f19', color: '#fff', fontSize: '0.85rem' }}
                        >
                          <option value="">-- Selecione o cliente --</option>
                          {allClients
                            .filter(c => c.tableNumber !== String(selectedTable))
                            .map(c => (
                              <option key={c.uid} value={c.uid}>
                                {c.name} {c.tableNumber ? `(Mesa ${c.tableNumber})` : ''}
                              </option>
                            ))
                          }
                        </select>
                        <button
                          type="button"
                          onClick={handleLinkUser}
                          disabled={!addUserUid}
                          style={{
                            padding: '0.4rem 0.8rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: addUserUid ? 'var(--primary-gold)' : 'rgba(255,255,255,0.05)',
                            color: addUserUid ? '#0b0f19' : 'var(--text-secondary)',
                            fontWeight: 700,
                            cursor: addUserUid ? 'pointer' : 'not-allowed',
                            fontSize: '0.85rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          + Sentar
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pedidos Ativos */}
                {!selectedTableData.isReserved && (
                  <div>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <ShoppingBag size={14} /> Pedidos Ativos na Mesa
                    </h4>
                    {selectedTableData.orders.length === 0 ? (
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        Nenhum pedido pendente ou em preparo para esta mesa.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '150px', overflowY: 'auto' }}>
                        {selectedTableData.orders.map((o) => {
                          const badge = getOrderStatusBadgeColor(o.status);
                          return (
                            <div key={o.id} style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '0.75rem', background: 'rgba(0,0,0,0.1)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>
                                  Pedido #{o.id?.slice(-4).toUpperCase()} (R$ {o.total.toFixed(2).replace('.', ',')})
                                </span>
                                <span style={{ 
                                  fontSize: '0.7rem', 
                                  padding: '2px 8px', 
                                  borderRadius: '8px', 
                                  backgroundColor: badge.bg, 
                                  color: badge.color,
                                  fontWeight: 700
                                }}>
                                  {getOrderStatusLabel(o.status)}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                  {o.items.map((item, idx) => (
                                    <div key={idx}>{item.quantity}x {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</div>
                                  ))}
                                </div>
                                {(userData?.role === 'developer' || userData?.role === 'owner' || userData?.role === 'manager') && (
                                  <button
                                    type="button"
                                    onClick={() => handleCancelOrderFromMap(o.id)}
                                    style={{
                                      padding: '2px 8px',
                                      background: '#dc2626',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      marginLeft: '10px'
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Ações / Botões Administrativos */}
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '0.6rem', 
                  borderTop: '1px solid rgba(255,255,255,0.06)', 
                  paddingTop: '1rem', 
                  marginTop: '0.5rem' 
                }}>
                  {/* Linha de botões de controle */}
                  <div style={{ display: 'flex', gap: '0.5rem', width: '100%', flexWrap: 'wrap' }}>
                    
                    {/* Botão Trocar de Mesa: somente se ocupada */}
                    {selectedTableData.isOccupied && (
                      <button
                        type="button"
                        onClick={() => handleTransferTable(selectedTableData.number)}
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          color: 'var(--primary-gold)',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                          minWidth: '130px'
                        }}
                      >
                        <ArrowRightLeft size={13} /> Transferir Mesa
                      </button>
                    )}

                    {/* Botão Reservar / Cancelar Reserva */}
                    {selectedTableData.isReserved ? (
                      <button
                        type="button"
                        onClick={() => handleCancelReservation(selectedTableData.number)}
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          background: 'rgba(139, 92, 246, 0.1)',
                          border: '1px solid rgba(139, 92, 246, 0.25)',
                          color: '#a78bfa',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                          minWidth: '130px'
                        }}
                      >
                        <Unlock size={13} /> Remover Reserva
                      </button>
                    ) : (
                      !selectedTableData.isOccupied && (
                        <button
                          type="button"
                          onClick={() => setIsReserving(true)}
                          style={{
                            flex: 1,
                            padding: '0.55rem 0.75rem',
                            borderRadius: '8px',
                            background: 'rgba(139, 92, 246, 0.1)',
                            border: '1px solid rgba(139, 92, 246, 0.25)',
                            color: '#a78bfa',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            minWidth: '130px'
                          }}
                        >
                          <Lock size={13} /> Reservar Mesa
                        </button>
                      )
                    )}

                    {/* Botão Liberar Mesa: se ocupada */}
                    {selectedTableData.isOccupied && (
                      <button
                        type="button"
                        onClick={() => handleFreeTable(selectedTableData.number)}
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem',
                          minWidth: '130px'
                        }}
                      >
                        <ShieldAlert size={13} /> Liberar Mesa
                      </button>
                    )}
                  </div>

                  {/* Linha de Fechamento */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                    <button 
                      type="button" 
                      onClick={() => { setSelectedTable(null); setIsReserving(false); setAddUserUid(''); }}
                      style={{
                        padding: '0.5rem 1.5rem',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.05)',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.85rem'
                      }}
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default TableMap;
