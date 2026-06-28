import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { TrendingUp, Users, DollarSign, ShieldAlert, Cpu } from 'lucide-react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';

export const AdminDashboard = () => {
  const { userData } = useAuth();
  
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);

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
  const inPrepCount = orders.filter(o => o.status === 'preparing').length;

  const mockStats = [
    { id: 1, label: 'Faturamento Total Real', val: `R$ ${billingToday.toFixed(2).replace('.', ',')}`, icon: DollarSign, color: '#f59e0b' },
    { id: 2, label: 'Vendas Finalizadas', val: `${completedOrders.length} pedidos`, icon: TrendingUp, color: '#10b981' },
    { id: 3, label: 'Fila de Preparação', val: `${pendingPrepCount} pendentes / ${inPrepCount} preparando`, icon: Users, color: '#3b82f6' },
  ];

  if (loading) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '250px', margin: '2rem auto' }}>
        <span className="spinner"></span>
        <span>Carregando estatísticas...</span>
      </div>
    );
  }

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
            <div key={stat.id} className="stat-card">
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
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum pedido efetuado ainda.</td>
                  </tr>
                ) : (
                  orders.slice(0, 5).map((order) => (
                    <tr key={order.id}>
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
                            order.status === 'completed' ? '#05966920' : 
                            order.status === 'ready' ? '#0284c720' : 
                            order.status === 'preparing' ? '#d9770620' : 
                            order.status === 'cancelled' ? '#ef444420' : '#4b556320', 
                          color: 
                            order.status === 'completed' ? '#10b981' : 
                            order.status === 'ready' ? '#3b82f6' : 
                            order.status === 'preparing' ? 'var(--primary-gold)' : 
                            order.status === 'cancelled' ? '#f87171' : 'var(--text-secondary)',
                          fontSize: '0.7rem',
                          padding: '0.1rem 0.5rem'
                        }}>
                          {order.status === 'cancelled' ? 'CANCELADO' : order.status.toUpperCase()}
                        </span>
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
                <ShieldAlert size={18} style={{ marginRight: '8px' }} /> Visão do Proprietário (Owner)
              </h3>
              <p>Você tem acesso total aos relatórios financeiros de fechamento de caixa e faturamento mensal.</p>
              <button type="button" className="setup-btn" style={{ background: 'var(--primary-gold)', color: '#000', width: '100%', padding: '0.6rem' }}>
                Gerar Fechamento Mensal
              </button>
            </div>
          )}

          {userData?.role === 'manager' && (
            <div>
              <h3>Controle do Gerente (Manager)</h3>
              <p>Acesso liberado para gerenciar escala de horários de funcionários e estoque de insumos.</p>
              <button type="button" className="setup-btn" style={{ width: '100%', padding: '0.6rem' }}>
                Gerenciar Estoque de Insumos
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default AdminDashboard;
