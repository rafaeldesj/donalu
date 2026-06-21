import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ChefHat, CreditCard, Bell, Play, Check, Navigation } from 'lucide-react';
import { collection, query, onSnapshot, doc, updateDoc, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';

interface StaffDashboardProps {
  filter?: 'cook' | 'attendant' | 'cashier';
}

export const StaffDashboard = ({ filter }: StaffDashboardProps) => {
  const { userData } = useAuth();
  const staff = userData?.staffFunctions;

  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

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

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const orderDocRef = doc(db, 'orders', orderId);
      await updateDoc(orderDocRef, { status: newStatus });
    } catch (error) {
      console.error("Erro ao atualizar status do pedido:", error);
    }
  };

  // Filtragem de pedidos
  const kitchenOrders = orders.filter(o => o.status === 'pending' || o.status === 'preparing');
  const attendingOrders = orders.filter(o => o.status === 'ready');
  const cashierOrders = orders.filter(o => o.status === 'ready');

  const hasAnyFunction = staff && (staff.cook || staff.attendant || staff.cashier);

  if (loadingOrders) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '250px', margin: '2rem auto' }}>
        <span className="spinner"></span>
        <span>Carregando fila de pedidos...</span>
      </div>
    );
  }

  // Verifica se o usuário tem a função específica liberada
  const isAuthorized = (f?: string) => {
    if (userData?.role === 'developer' || userData?.role === 'owner' || userData?.role === 'manager') return true;
    if (!f) return false;
    if (f === 'cook') return staff?.cook;
    if (f === 'attendant') return staff?.attendant;
    if (f === 'cashier') return staff?.cashier;
    return false;
  };

  return (
    <div className="dashboard-layout animate-fade-in">
      {!hasAnyFunction && userData?.role === 'staff' ? (
        <div className="alert-box" style={{ textAlign: 'center', padding: '2rem' }}>
          <h3>Nenhuma função atribuída ao seu perfil!</h3>
          <p>Solicite ao Administrador para ativar suas permissões (Cozinheiro, Caixa ou Atendente) via checkbox no Firestore.</p>
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
                      <div className="order-meta">
                        <strong>Pedido #{order.id?.slice(-4).toUpperCase()}</strong>
                        <span className="order-badge-status" style={{ backgroundColor: order.status === 'preparing' ? '#d9770615' : 'rgba(255,255,255,0.05)', color: order.status === 'preparing' ? 'var(--primary-gold)' : 'var(--text-secondary)' }}>
                          {order.status === 'preparing' ? 'Preparando' : 'Pendente'}
                        </span>
                      </div>
                      <div style={{ margin: '1rem 0' }}>
                        {order.items.map((item, index) => (
                          <p key={index} className="order-desc" style={{ fontSize: '1.05rem' }}>{item.quantity}x <strong>{item.name}</strong></p>
                        ))}
                      </div>
                      {order.address && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '8px', marginBottom: '1rem' }}>
                          Entrega: {order.address.street}, {order.address.number}
                        </div>
                      )}
                      <div className="order-actions">
                        {order.status === 'pending' ? (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'preparing')} className="btn-small btn-primary" style={{ width: '100%', padding: '0.6rem' }}>
                            <Play size={14} /> Começar Preparo
                          </button>
                        ) : (
                          <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'ready')} className="btn-small btn-success" style={{ width: '100%', padding: '0.6rem' }}>
                            <Check size={14} /> Concluído (Enviar ao Balcão)
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
                      <div className="order-meta">
                        <strong>Pedido #{order.id?.slice(-4).toUpperCase()}</strong>
                        <span className="order-badge-status" style={{ backgroundColor: '#10b98115', color: '#10b981' }}>Pronto</span>
                      </div>
                      <div style={{ margin: '1rem 0' }}>
                        {order.items.map((item, index) => (
                          <p key={index} className="order-desc">{item.quantity}x {item.name}</p>
                        ))}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.8rem' }}>
                        <strong>Cliente:</strong> {order.clientName}
                      </div>
                      {order.address && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'rgba(59, 130, 246, 0.05)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)', marginBottom: '1rem' }}>
                          <Navigation size={12} style={{ display: 'inline', marginRight: '4px' }} />
                          {order.address.street}, {order.address.number} ({order.address.neighborhood})
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Fila do Caixa */}
          {filter === 'cashier' && isAuthorized('cashier') && (
            <div className="staff-section cashier-card" style={{ border: 'none', background: 'transparent', padding: 0 }}>
              <div className="section-title">
                <CreditCard className="section-icon text-emerald" size={24} />
                <h3 style={{ fontSize: '1.4rem' }}>Fila do Caixa ({cashierOrders.length} aguardando)</h3>
              </div>
              <div className="orders-queue" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
                {cashierOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', padding: '1rem', gridColumn: '1 / -1', textAlign: 'center' }}>Sem recebimentos pendentes.</p>
                ) : (
                  cashierOrders.map((order) => (
                    <div key={order.id} className="order-item" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px' }}>
                      <div className="order-meta">
                        <strong>Pedido #{order.id?.slice(-4).toUpperCase()}</strong>
                        <span style={{ fontWeight: 700, color: 'var(--primary-gold)', fontSize: '1.1rem' }}>
                          R$ {order.total.toFixed(2).replace('.', ',')}
                        </span>
                      </div>
                      <p className="order-desc" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: '0.5rem 0' }}>
                        Cliente: {order.clientName}
                      </p>
                      <button type="button" onClick={() => order.id && updateOrderStatus(order.id, 'completed')} className="btn-small btn-success" style={{ width: '100%', marginTop: '0.75rem', padding: '0.6rem' }}>
                        Confirmar Pagamento e Finalizar
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default StaffDashboard;
