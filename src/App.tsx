import { useState, useEffect, lazy, Suspense } from 'react';
import type { OrderItem } from './types/order';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthButton } from './components/common/AuthButton';
import { DeliveryMap } from './components/DeliveryMap';
import { ShieldCheck, ChefHat, CreditCard, Bell, ShoppingCart, Heart, FileText, Users, Navigation, CheckCircle, Clock, Map, Settings, Menu, ChevronDown } from 'lucide-react';
import logoDonalu from './assets/logo_donalu.png';
import logoDonaluMobile from './assets/logo_donalu_mobile.png';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './config/firebase';

// Lazy-loaded components for code-splitting performance
const ClientDashboard = lazy(() => import('./pages/client/ClientDashboard'));
const StaffDashboard = lazy(() => import('./pages/staff/StaffDashboard'));
const AdminDashboard = lazy(() => import('./pages/manager/AdminDashboard'));
const UserManagement = lazy(() => import('./pages/manager/UserManagement'));
const DeliveryActive = lazy(() => import('./pages/delivery/DeliveryActive'));
const DeliveryHistory = lazy(() => import('./pages/delivery/DeliveryHistory'));
const OrderTracking = lazy(() => import('./pages/client/OrderTracking'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

// Premium feedback state for lazy loading
const ViewLoader = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '1.25rem', padding: '2rem' }} className="animate-fade-in">
    <div className="spinner" style={{ width: '42px', height: '42px', borderWidth: '3.5px', borderColor: 'rgba(245, 158, 11, 0.1)', borderTopColor: 'var(--primary-gold)' }} />
    <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 600, letterSpacing: '0.02em' }}>Carregando painel...</span>
  </div>
);

const MainLayout = () => {
  const { user, userData, logout } = useAuth();
  const [activeView, setActiveView] = useState<string>('menu');
  const [isVisitor, setIsVisitor] = useState<boolean>(false);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Real-time store configurations and status
  const [storeConfig, setStoreConfig] = useState<any>(null);
  const [storeStatus, setStoreStatus] = useState<{ status: 'open' | 'closing_soon' | 'closed'; label: string }>({ status: 'closed', label: 'Fechado' });

  // Listen to store configurations in real-time
  useEffect(() => {
    const docRef = doc(db, 'settings', 'store_config');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setStoreConfig(docSnap.data());
      }
    }, (err) => {
      console.error("Erro ao escutar store_config no MainLayout:", err);
    });
    return () => unsubscribe();
  }, []);

  // Recalculate status every 30 seconds
  useEffect(() => {
    const checkStatus = () => {
      if (!storeConfig) {
        setStoreStatus({ status: 'closed', label: 'Fechado' });
        return;
      }
      if (storeConfig.isOpen === false) {
        setStoreStatus({ status: 'closed', label: 'Fechado' });
        return;
      }

      // Se for dev, proprietário ou gerente, e a loja estiver marcada como ABERTA nas configurações,
      // pulamos a verificação de horário e exibimos como Aberta para permitir testes e funcionamento.
      const isPrivilegedUser = userData && ['developer', 'owner', 'manager'].includes(userData.role);
      if (isPrivilegedUser) {
        setStoreStatus({ status: 'open', label: 'Em funcionamento' });
        return;
      }

      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTimeInMinutes = currentHours * 60 + currentMinutes;

      const [openH, openM] = (storeConfig.openingTime || '18:00').split(':').map(Number);
      const [closeH, closeM] = (storeConfig.closingTime || '23:30').split(':').map(Number);

      const openTimeInMinutes = openH * 60 + openM;
      let closeTimeInMinutes = closeH * 60 + closeM;

      // Handle next day closing time
      const closesNextDay = closeTimeInMinutes < openTimeInMinutes;

      let isOpen = false;
      let minutesToClose = 9999;

      if (closesNextDay) {
        if (currentTimeInMinutes >= openTimeInMinutes) {
          isOpen = true;
          minutesToClose = (24 * 60 - currentTimeInMinutes) + closeTimeInMinutes;
        } else if (currentTimeInMinutes < closeTimeInMinutes) {
          isOpen = true;
          minutesToClose = closeTimeInMinutes - currentTimeInMinutes;
        }
      } else {
        if (currentTimeInMinutes >= openTimeInMinutes && currentTimeInMinutes < closeTimeInMinutes) {
          isOpen = true;
          minutesToClose = closeTimeInMinutes - currentTimeInMinutes;
        }
      }

      if (!isOpen) {
        setStoreStatus({ status: 'closed', label: 'Fechado' });
      } else if (minutesToClose <= 30) {
        setStoreStatus({ status: 'closing_soon', label: 'Fecharemos em breve' });
      } else {
        setStoreStatus({ status: 'open', label: 'Em funcionamento' });
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [storeConfig, userData]);

  const handleCartClick = () => {
    setActiveView('menu');
    setTimeout(() => {
      const element = document.getElementById('cart-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
  };

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

  const isProfileIncomplete = !!user && (!userData || !userData.phoneNumber);

  if ((!user || isProfileIncomplete) && !isVisitor) {
    return (
      <div className="login-page-layout">
        <header className="app-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
          <img 
            src={logoDonalu} 
            alt="Dona Lu Pastelaria" 
            decoding="async" 
            className="logo-desktop"
            style={{ width: '90px', height: '90px', borderRadius: '50%', border: '2px solid var(--primary-gold)', boxShadow: '0 4px 15px rgba(201, 28, 28, 0.4)' }} 
          />
          <img 
            src={logoDonaluMobile} 
            alt="Dona Lu Pastelaria" 
            decoding="async" 
            className="logo-mobile"
            style={{ width: '120px', height: '120px', borderRadius: '50%', border: '2px solid var(--primary-gold)', boxShadow: '0 4px 15px rgba(201, 28, 28, 0.4)' }} 
          />
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
  const menuItems: any[] = [];
  const isOnlyDelivery = role === 'staff' && staff?.delivery;

  if (isOnlyDelivery) {
    menuItems.push({ id: 'entrega_andamento', label: 'Entrega em Andamento', icon: Navigation });
    menuItems.push({ id: 'entrega_finalizada', label: 'Entregas Finalizadas', icon: CheckCircle });
  } else {
    // Se for cliente, desenvolvedor, owner ou gerente
    if (['client', 'developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'menu', label: 'Cardápio Digital', icon: ShoppingCart });
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

    // Teste de mapa — apenas developer
    if (role === 'developer') {
      menuItems.push({ id: 'teste_mapa', label: 'Localização dos Entregadores', icon: Map });
    }

    // Configurações — visível para todos os usuários logados
    if (user) {
      menuItems.push({ id: 'configuracoes', label: 'Configurações', icon: Settings });
    }
  }

  const menuGroups = [
  { label: 'Cardápio / Cliente', ids: ['menu', 'tracking', 'fidelidade'] },
  { label: 'Operações de Entrega', ids: ['entrega_andamento', 'entrega_finalizada'] },
  { label: 'Painéis de Trabalho', ids: ['cozinha', 'atendimento', 'caixa', 'admin', 'teste_mapa'] },
  { label: 'Configurações', ids: ['users', 'configuracoes'] },
];
const getRoleLabel = (r: string): React.ReactNode => {
    switch (r) {
      case 'developer': return (
        <>
          <span className="role-label-desktop">Desenvolvedor</span>
          <span className="role-label-mobile">Dev</span>
        </>
      );
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
          <img src={logoDonalu} alt="Logo" decoding="async" style={{ width: '32px', height: '32px', borderRadius: '50%', border: '1px solid var(--primary-gold)' }} />
          <span className="brand-text">Dona Lu Pastelaria</span>
          <div className={`store-status-container status-${storeStatus.status}`} title={storeStatus.label}>
            <span className={`status-dot status-${storeStatus.status}`}></span>
            <span className="store-status-text">{storeStatus.label}</span>
          </div>
        </div>
        <div className="header-user-status">
          {['client', 'developer', 'owner', 'manager'].includes(role) && (
            <button 
              onClick={handleCartClick} 
              className={`header-cart-btn ${cart.length > 0 ? 'has-items' : ''}`}
              title="Ir para o Carrinho"
            >
              <ShoppingCart size={18} />
              {cart.length > 0 && (
                <span className="cart-count-badge">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </button>
          )}
          <span className="welcome-msg">Olá, <strong>{user ? (user.displayName?.split(' ')[0] || user.email?.split('@')[0]) : 'Visitante'}</strong></span>
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
          {/* Mobile toggle button */}
          <button 
            type="button" 
            className="mobile-menu-toggle-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Menu size={16} />
              <span>Navegação / Menu</span>
            </div>
            <ChevronDown 
              size={16} 
              style={{ 
                transform: mobileMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease-in-out'
              }} 
            />
          </button>

          {/* Sidebar content (collapsible wrapper) */}
          <div className={`sidebar-collapsible-wrapper ${mobileMenuOpen ? 'open' : ''}`}>
            {menuGroups.map((group) => {
              const groupItems = menuItems.filter((item) => group.ids.includes(item.id));
              if (groupItems.length === 0) return null;
              return (
                <div key={group.label} className="sidebar-group-container">
                  <div className="menu-group-label">{group.label}</div>
                  <nav className="sidebar-nav-menu">
                    {groupItems.map((item) => {
                      const IconComponent = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`nav-menu-item ${activeView === item.id ? 'active' : ''}`}
                          onClick={() => {
                            setActiveView(item.id);
                            setMobileMenuOpen(false); // Close on click
                          }}
                        >
                          <IconComponent size={18} className="nav-icon" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </nav>
                </div>
              );
            })}
          </div>
        </aside>

        {/* 3. Content (Área de Conteúdo Direita) */}
        <main className="content-area-main">
          <Suspense fallback={<ViewLoader />}>
            {activeView === 'menu' && <ClientDashboard showOnly="menu" isVisitor={isVisitor} onLoginRequired={() => setIsVisitor(false)} onNavigate={setActiveView} cart={cart} setCart={setCart} />}
            {activeView === 'tracking' && <OrderTracking />}
            {activeView === 'fidelidade' && <ClientDashboard showOnly="loyalty" isVisitor={isVisitor} onLoginRequired={() => setIsVisitor(false)} onNavigate={setActiveView} cart={cart} setCart={setCart} />}
            {activeView === 'cozinha' && <StaffDashboard filter="cook" />}
            {activeView === 'atendimento' && <StaffDashboard filter="attendant" />}
            {activeView === 'caixa' && <StaffDashboard filter="cashier" />}
            {activeView === 'entrega_andamento' && <DeliveryActive />}
            {activeView === 'entrega_finalizada' && <DeliveryHistory />}
            {activeView === 'admin' && <AdminDashboard />}
            {activeView === 'users' && <UserManagement />}
            {activeView === 'configuracoes' && <SettingsPage />}
            {activeView === 'teste_mapa' && (
              <div style={{ maxWidth: '680px', margin: '0 auto' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ margin: '0 0 0.25rem', color: 'var(--text-primary)' }}>🗺️ Localização dos Entregadores</h2>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Valide aqui a busca de endereço e a geolocalização antes de integrar ao pedido.</p>
                </div>
                <DeliveryMap onAddressSelect={(addr) => console.log('Endereço selecionado:', addr)} />
              </div>
            )}
          </Suspense>
          
          {/* Mobile Footer (visible only on mobile, scrolls with content) */}
          <footer className="mobile-only-footer">
            <p>📍 © 2026 Dona Lu • R. Jícara, 239 - CG | 📞 (21) 3439-5241</p>
            <p>Dev Rafael Jorge (21) 99565-5031</p>
          </footer>
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
