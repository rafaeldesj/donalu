import { useEffect, useState } from 'react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { OrderDocument } from '../../types/order';
import { CheckCircle, Calendar, MapPin, DollarSign } from 'lucide-react';

export const DeliveryHistory = () => {
  const { user, userData } = useAuth();
  const [historyOrders, setHistoryOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // Escuta os pedidos finalizados atribuídos a este entregador
  useEffect(() => {
    if (!user) return;

    // Filtra pedidos finalizados onde o entregador atual fez a entrega
    const q = query(
      collection(db, 'orders'),
      where('status', '==', 'completed'),
      where('deliveryUid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        } as OrderDocument);
      });
      
      // Ordena por data decrescente (mais recentes primeiro)
      fetched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setHistoryOrders(fetched);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao carregar histórico de entregas:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const totalEarnings = historyOrders.reduce((sum, order) => sum + order.total, 0);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Carregando histórico...</div>;
  }

  return (
    <div className="dashboard-layout animate-fade-in">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Entregas Finalizadas 📋</h2>
          <p>Confira seu histórico de entregas concluídas e recebimentos.</p>
        </div>
        
        {/* Painel de faturamento do entregador */}
        <div style={{
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.15)',
          borderRadius: '12px',
          padding: '0.75rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <div style={{ background: '#10b98120', padding: '0.5rem', borderRadius: '8px', color: '#10b981' }}>
            <DollarSign size={20} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Total Recebido</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#34d399' }}>
              R$ {totalEarnings.toFixed(2).replace('.', ',')}
            </div>
          </div>
        </div>
      </div>

      <div className="admin-card-box">
        <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle size={20} style={{ color: '#10b981' }} /> Registro de Conclusões ({historyOrders.length} entregas)
        </h3>

        {historyOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            Nenhuma entrega finalizada encontrada em seu histórico. Comece sua primeira entrega agora!
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Pedido ID</th>
                  <th>Cliente</th>
                  <th>Endereço</th>
                  <th style={{ textAlign: 'right' }}>Total Pago</th>
                </tr>
              </thead>
              <tbody>
                {historyOrders.map((order) => (
                  <tr key={order.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <Calendar size={14} style={{ color: 'var(--primary-gold)' }} />
                        {formatDate(order.createdAt)}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
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
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                        <MapPin size={14} style={{ flexShrink: 0, color: '#3b82f6' }} />
                        {order.address?.street}, {order.address?.number} ({order.address?.neighborhood})
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#34d399' }}>
                      R$ {order.total.toFixed(2).replace('.', ',')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeliveryHistory;
