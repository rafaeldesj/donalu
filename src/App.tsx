import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthButton } from './components/common/AuthButton';
import { ClientDashboard } from './pages/client/ClientDashboard';
import { StaffDashboard } from './pages/staff/StaffDashboard';
import { AdminDashboard } from './pages/manager/AdminDashboard';
import { UserManagement } from './pages/manager/UserManagement';
import { DeliveryActive } from './pages/delivery/DeliveryActive';
import { DeliveryHistory } from './pages/delivery/DeliveryHistory';
import { OrderTracking } from './pages/client/OrderTracking';
import { ShieldCheck, ChefHat, CreditCard, Bell, ShoppingBag, Heart, FileText, Users, Navigation, CheckCircle, Clock } from 'lucide-react';
import logoDonalu from './assets/logo_donalu.png';

const MainLayout = () => {
  const { user, userData, logout } = useAuth();
  const [activeView, setActiveView] = useState<string>('menu');
  const [isVisitor, setIsVisitor] = useState<boolean>(false);

  const role = userData?.role || 'client';
  const staff = userData?.staffFunctions;

  // Atualiza a visualização inicial ativa baseando-se no papel
  useEffect(() => {
    if (user && userData) {
      if (userData.role === 'staff') {
        if (userData.staffFunctions?.cook) setActiveView('cozinha');
        else if (userData.staffFunctions?.attendant) setActiveView('atendimento');
        else if (userData.staffFunctions?.cashier) setActiveView('caixa');
        else if (userData.staffFunctions?.delivery) setActiveView('entrega_andamento');
      } else if (['manager', 'owner', 'developer'].includes(userData.role)) {
        setActiveView('admin');
      } else {
        setActiveView('menu');
      }
    }
  }, [user, userData]);

  if (!user && !isVisitor) {
    return (
      <div className="login-page-layout">
        <header className="app-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
          <img src={logoDonalu} alt="Dona Lu Pastelaria" style={{ width: '90px', height: '90px', borderRadius: '50%', border: '2px solid var(--primary-gold)', boxShadow: '0 4px 15px rgba(201, 28, 28, 0.4)' }} />
          <h1 className="logo-title" style={{ marginTop: '0.5rem', marginBottom: 0 }}>Dona Lu Pastelaria</h1>
          <p className="subtitle" style={{ margin: 0 }}>Pastéis com borda crocante e irresistível!</p>
        </header>
        <div className="login-card-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
          <AuthButton />
          <button 
            type="button" 
            onClick={() => setIsVisitor(true)} 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--primary-gold)', 
              cursor: 'pointer', 
              fontSize: '0.95rem', 
              textDecoration: 'underline',
              fontWeight: 600,
              padding: '0.5rem',
              transition: 'color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--primary-gold)'}
          >
            Entrar como Visitante (Apenas Visualizar Cardápio)
          </button>
        </div>
        <footer className="app-footer">
          <p style={{ margin: 0 }}>📍 © 2026 Dona Lu Pastelaria • Rua Jícara, 239 - Campo Grande | 📞 (21) 3439-5241</p>
          <p style={{ margin: 0 }}> Desenvolvedor Rafael Jorge (21) 99565-5031</p>
        </footer>
      </div>
    );
  }

  // Lista dinâmica de botões de navegação conforme o nível de privilégio do usuário
  const menuItems = [];
  const isOnlyDelivery = role === 'staff' && staff?.delivery;

  if (isOnlyDelivery) {
    menuItems.push({ id: 'entrega_andamento', label: 'Entrega em Andamento', icon: Navigation });
    menuItems.push({ id: 'entrega_finalizada', label: 'Entregas Finalizadas', icon: CheckCircle });
  } else {
    // Se for cliente, desenvolvedor, owner ou gerente
    if (['client', 'developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'menu', label: 'Cardápio Digital', icon: ShoppingBag });
    }

    // Acompanhe seu pedido visível apenas para clientes logados
    if (role === 'client' && user) {
      menuItems.push({ id: 'tracking', label: 'Acompanhe seu pedido', icon: Clock });
    }

    // Fidelidade visível apenas para clientes e developers logados
    if (['client', 'developer'].includes(role) && user) {
      menuItems.push({ id: 'fidelidade', label: 'Cartão Fidelidade', icon: Heart });
    }

    // Fila da cozinha (Cozinheiro, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.cook)) {
      menuItems.push({ id: 'cozinha', label: 'Fila Cozinha', icon: ChefHat });
    }

    // Fila de atendimento (Atendente, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.attendant)) {
      menuItems.push({ id: 'atendimento', label: 'Balcão de Entrega', icon: Bell });
    }

    // Fila de caixa (Caixa, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.cashier)) {
      menuItems.push({ id: 'caixa', label: 'Fila Caixa', icon: CreditCard });
    }

    // Fila de entregas (Entregador, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.delivery)) {
      menuItems.push({ id: 'entrega_andamento', label: 'Entrega em Andamento', icon: Navigation });
      menuItems.push({ id: 'entrega_finalizada', label: 'Entregas Finalizadas', icon: CheckCircle });
    }

    // Painel Administrativo (admin, owner, dev)
    if (['developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'admin', label: 'Painel Admin', icon: FileText });
    }

    // Painel de Gestão de Usuários (admin, owner, dev)
    if (['developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'users', label: 'Usuários', icon: Users });
    }
  }

  const getRoleLabel = (r: string) => {
    switch (r) {
      case 'developer': return 'Developer';
      case 'owner': return 'Proprietário';
      case 'manager': return 'Gerente';
      case 'staff': {
        const subroles: string[] = [];
        if (userData?.staffFunctions?.cook) subroles.push('Cozinha');
        if (userData?.staffFunctions?.attendant) subroles.push('Atendimento');
        if (userData?.staffFunctions?.cashier) subroles.push('Caixa');
        if (userData?.staffFunctions?.delivery) subroles.push('Entrega');
        return subroles.length > 0 ? `Colaborador [${subroles.join(', ')}]` : 'Colaborador';
      }
      case 'client':
      default:
        return 'Cliente';
    }
  };

  return (
    <div className="main-grid-layout">
      {/* 1. Header (Topo) */}
      <header className="site-header">
        <div className="header-brand">
          <img src={logoDonalu} alt="Logo" style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1px solid var(--primary-gold)' }} />
          <span className="brand-text">Dona Lu Pastelaria</span>
        </div>
        <div className="header-user-status">
          <span className="welcome-msg">Olá, <strong>{user ? (user.displayName || user.email) : 'Visitante'}</strong></span>
          {userData?.role && (
            <span className="role-badge">
              <ShieldCheck size={12} style={{ marginRight: '4px' }} />
              {getRoleLabel(userData.role)}
            </span>
          )}
          {user ? (
            <button onClick={logout} className="logout-action-btn">Sair</button>
          ) : (
            <button onClick={() => setIsVisitor(false)} className="logout-action-btn" style={{ background: 'var(--primary-gold)', color: '#0b0f19', fontWeight: 600 }}>Entrar</button>
          )}
        </div>
      </header>

      {/* Seção Central */}
      <div className="middle-content-area">
        {/* 2. Left Navigation (Navegação Esquerda) */}
        <aside className="left-navigation-sidebar">
          <div className="menu-group-label">Painéis de Acesso</div>
          <nav className="sidebar-nav-menu">
            {menuItems.map((item) => {
              const IconComponent = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-menu-item ${activeView === item.id ? 'active' : ''}`}
                  onClick={() => setActiveView(item.id)}
                >
                  <IconComponent size={18} className="nav-icon" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 3. Content (Área de Conteúdo Direita) */}
        <main className="content-area-main">
          {activeView === 'menu' && <ClientDashboard showOnly="menu" isVisitor={isVisitor} onLoginRequired={() => setIsVisitor(false)} />}
          {activeView === 'tracking' && <OrderTracking />}
          {activeView === 'fidelidade' && <ClientDashboard showOnly="loyalty" isVisitor={isVisitor} onLoginRequired={() => setIsVisitor(false)} />}
          {activeView === 'cozinha' && <StaffDashboard filter="cook" />}
          {activeView === 'atendimento' && <StaffDashboard filter="attendant" />}
          {activeView === 'caixa' && <StaffDashboard filter="cashier" />}
          {activeView === 'entrega_andamento' && <DeliveryActive />}
          {activeView === 'entrega_finalizada' && <DeliveryHistory />}
          {activeView === 'admin' && <AdminDashboard />}
          {activeView === 'users' && <UserManagement />}
        </main>
      </div>

      {/* 4. Footer (Rodapé) */}
      <footer className="site-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <p style={{ margin: 0 }}>📍 © 2026 Dona Lu Pastelaria • Rua Jícara, 239 - Campo Grande | 📞 (21) 3439-5241</p>
        <p style={{ margin: 0 }}> Desenvolvedor Rafael Jorge (21) 99565-5031</p>
      </footer>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}

export default App;
