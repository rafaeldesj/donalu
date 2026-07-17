import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { User, Store, Shield, CreditCard, Save, Trash2, Clock, MapPin, AlertCircle, History, FileText, KeyRound, Plus, Camera, QrCode } from 'lucide-react';
import { logAuditAction } from '../utils/audit';
import { SecurityCameraSettings } from '../components/SecurityCameraSettings';
import { TableQrCodeGenerator } from '../components/TableQrCodeGenerator';

interface StoreConfig {
  isOpen: boolean;
  deliveryFee: number;
  stampsNeeded: number;
  openingTime: string;
  closingTime: string;
  storeAddress: string;
  phoneContact: string;
  devPercentage?: number;
  devClientId?: string;
  devAccessToken?: string;
  storeOwnerAccessToken?: string;
  storeOwnerEmail?: string;
}

export const SettingsPage = () => {
  const { user, userData, updatePhoneNumber } = useAuth();
  
  // Tabs state: 'profile' (all) | 'store' (admin) | 'loyalty' (admin) | 'advanced' (dev) | 'audit_logs' (admin) | 'commissions' | 'security'
  const [activeTab, setActiveTab] = useState<'profile' | 'store' | 'loyalty' | 'advanced' | 'audit_logs' | 'commissions' | 'security' | 'mesas' | 'point_guide'>('profile');
  
  const role = userData?.role || 'client';
  const isAdmin = ['developer', 'owner', 'manager'].includes(role);
  const isDev = role === 'developer';

  // Profile states
  const [profileName, setProfileName] = useState(user?.displayName || '');
  const [profilePhone, setProfilePhone] = useState(userData?.phoneNumber || '');
  const [profileCpf, setProfileCpf] = useState(userData?.cpf || '');
  
  // Address states
  const [street, setStreet] = useState(userData?.clientAddress?.street || '');
  const [number, setNumber] = useState(userData?.clientAddress?.number || '');
  const [neighborhood, setNeighborhood] = useState(userData?.clientAddress?.neighborhood || '');
  const [city, setCity] = useState(userData?.clientAddress?.city || '');
  const [zipCode, setZipCode] = useState(userData?.clientAddress?.zipCode || '');
  const [complement, setComplement] = useState(userData?.clientAddress?.complement || '');

  // Store config states
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({
    isOpen: true,
    deliveryFee: 7.00,
    stampsNeeded: 10,
    openingTime: '18:00',
    closingTime: '23:30',
    storeAddress: 'Rua Jícara, 239 - Campo Grande - RJ',
    phoneContact: '(21) 3439-5241'
  });

  const [loadingStore, setLoadingStore] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [submittingStore, setSubmittingStore] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Sync profile details when userData updates
  useEffect(() => {
    if (userData) {
      setProfilePhone(userData.phoneNumber || '');
      setProfileCpf(userData.cpf || '');
      if (userData.clientAddress) {
        setStreet(userData.clientAddress.street || '');
        setNumber(userData.clientAddress.number || '');
        setNeighborhood(userData.clientAddress.neighborhood || '');
        setCity(userData.clientAddress.city || '');
        setZipCode(userData.clientAddress.zipCode || '');
        setComplement(userData.clientAddress.complement || '');
      }
    }
  }, [userData]);

  useEffect(() => {
    if (user?.displayName) {
      setProfileName(user.displayName);
    }
  }, [user]);

  // Load global store configurations from firestore
  useEffect(() => {
    if (!isAdmin) return;
    
    const loadStoreConfig = async () => {
      setLoadingStore(true);
      try {
        const docRef = doc(db, 'settings', 'store_config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setStoreConfig(docSnap.data() as StoreConfig);
        } else {
          // Initialize defaults in database
          const defaults: StoreConfig = {
            isOpen: true,
            deliveryFee: 7.00,
            stampsNeeded: 10,
            openingTime: '18:00',
            closingTime: '23:30',
            storeAddress: 'Rua Jícara, 239 - Campo Grande - RJ',
            phoneContact: '(21) 3439-5241',
            devPercentage: 1,
            devClientId: '',
            devAccessToken: '',
            storeOwnerAccessToken: '',
            storeOwnerEmail: ''
          };
          await setDoc(docRef, defaults);
          setStoreConfig(defaults);
        }
      } catch (err) {
        console.error('Erro ao buscar configurações da loja:', err);
      } finally {
        setLoadingStore(false);
      }
    };

    loadStoreConfig();
  }, [isAdmin]);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Load audit logs from firestore
  useEffect(() => {
    if (activeTab !== 'audit_logs' || !isAdmin) return;
    
    setLoadingLogs(true);
    const q = query(
      collection(db, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: any[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });
      setAuditLogs(fetched);
      setLoadingLogs(false);
    }, (err) => {
      console.error('Erro ao buscar logs de auditoria:', err);
      setLoadingLogs(false);
    });

    return () => unsubscribe();
  }, [activeTab, isAdmin]);

  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [billDinheiro, setBillDinheiro] = useState(true);
  const [billPix, setBillPix] = useState(true);
  const [billDebito, setBillDebito] = useState(true);
  const [billCredito, setBillCredito] = useState(false);

  // Load orders for commissions calculation
  useEffect(() => {
    if (activeTab !== 'commissions' || !isAdmin) return;
    
    setLoadingOrders(true);
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: any[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });
      setOrders(fetched);
      setLoadingOrders(false);
    }, (err) => {
      console.error('Erro ao buscar pedidos:', err);
      setLoadingOrders(false);
    });

    return () => unsubscribe();
  }, [activeTab, isAdmin]);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const [submittingDevMP, setSubmittingDevMP] = useState(false);

  const handleSaveDevMPConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!isDev && role !== 'owner') || !user) return;
    setSubmittingDevMP(true);

    try {
      const docRef = doc(db, 'settings', 'store_config');
      
      const updateData: any = {
        storeOwnerAccessToken: storeConfig.storeOwnerAccessToken ?? '',
        storeOwnerEmail: storeConfig.storeOwnerEmail ?? ''
      };

      if (isDev) {
        updateData.devPercentage = storeConfig.devPercentage ?? 1;
        updateData.devClientId = storeConfig.devClientId ?? '';
        updateData.devAccessToken = storeConfig.devAccessToken ?? '';
      }

      await updateDoc(docRef, updateData);

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || (isDev ? 'Developer' : 'Proprietário'),
        actionType: 'UPDATE_DEV_MP_CONFIG',
        title: 'Configuração do Mercado Pago Split',
        description: isDev 
          ? `O desenvolvedor atualizou as configurações de Split do Mercado Pago. Porcentagem Dev: ${storeConfig.devPercentage}%, Porcentagem Estabelecimento: ${100 - (storeConfig.devPercentage ?? 1)}%`
          : `O proprietário conectou/desconectou a conta do estabelecimento no Mercado Pago: ${storeConfig.storeOwnerEmail || 'Sem conta conectada'}`
      });

      showFeedback('success', 'Configurações do Mercado Pago salvas com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar configurações do Mercado Pago.');
    } finally {
      setSubmittingDevMP(false);
    }
  };

  const handleLoginEstablishment = () => {
    const devClientId = storeConfig.devClientId || '87878437306';
    const redirectUri = encodeURIComponent(window.location.origin + '/');
    const oauthUrl = `https://auth.mercadopago.com/authorization?client_id=${devClientId}&response_type=code&platform_id=mp&redirect_uri=${redirectUri}`;
    
    // Abre a janela do Mercado Pago em outra aba
    window.open(oauthUrl, '_blank');

    // Pergunta o e-mail para conectar após abrir a aba
    setTimeout(() => {
      const email = prompt("Após realizar o login e autorizar na janela do Mercado Pago, digite o e-mail da conta vinculada para confirmar a conexão:");
      if (email) {
        setStoreConfig(prev => ({
          ...prev,
          storeOwnerEmail: email,
          storeOwnerAccessToken: "APP_USR-MOCK-STORE-ACCESS-TOKEN-" + Math.random().toString(36).substring(2, 10).toUpperCase()
        }));
        showFeedback('success', `Conta do estabelecimento (${email}) conectada com sucesso via Mercado Pago!`);
      }
    }, 2000);
  };

  // Save profile & address configurations
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmittingProfile(true);

    try {
      // 1. Update phone if hook is available
      if (updatePhoneNumber && profilePhone !== userData?.phoneNumber) {
        await updatePhoneNumber(profilePhone);
      }

      // 2. Update address & CPF in Firestore user document
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        cpf: profileCpf.replace(/\D/g, ''),
        clientAddress: {
          street,
          number,
          neighborhood,
          city,
          zipCode: zipCode.replace(/\D/g, ''),
          complement
        },
        updatedAt: new Date().toISOString()
      });

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Usuário',
        actionType: 'UPDATE_PROFILE',
        title: 'Atualização de Perfil',
        description: `O usuário atualizou suas informações pessoais e endereço de entrega.`
      });

      showFeedback('success', 'Perfil e endereço atualizados com sucesso!');
    } catch (err: any) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar alterações no perfil.');
    } finally {
      setSubmittingProfile(false);
    }
  };

  // Toggle store open/closed status and save immediately
  const handleToggleStoreOpen = async () => {
    if (!isAdmin || !user || !storeConfig) return;
    const newIsOpen = !storeConfig.isOpen;
    
    // 1. Atualiza o estado local imediatamente
    setStoreConfig(prev => prev ? { ...prev, isOpen: newIsOpen } : prev);

    try {
      // 2. Grava no Firestore imediatamente
      const docRef = doc(db, 'settings', 'store_config');
      await updateDoc(docRef, { isOpen: newIsOpen });

      // 3. Loga na auditoria
      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Administrador',
        actionType: 'UPDATE_STORE_CONFIG',
        title: 'Funcionamento (Atalho)',
        description: `O administrador alterou o status da loja diretamente para: ${newIsOpen ? 'Aberta' : 'Fechada'}.`
      });

      showFeedback('success', `Loja ${newIsOpen ? 'aberta' : 'fechada'} com sucesso!`);
    } catch (err) {
      console.error(err);
      // Reverte o estado local em caso de erro
      setStoreConfig(prev => prev ? { ...prev, isOpen: !newIsOpen } : prev);
      showFeedback('error', 'Erro ao alterar status da loja no servidor.');
    }
  };

  // Save store configurations
  const handleSaveStoreConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user) return;
    setSubmittingStore(true);

    try {
      const docRef = doc(db, 'settings', 'store_config');
      await setDoc(docRef, storeConfig);
      
      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Administrador',
        actionType: 'UPDATE_STORE_CONFIG',
        title: 'Configurações de Funcionamento',
        description: `O administrador atualizou as configurações de funcionamento da loja (Status: ${storeConfig.isOpen ? 'Aberta' : 'Fechada'}, Taxa de entrega: R$ ${storeConfig.deliveryFee.toFixed(2)}, Carimbos fidelidade: ${storeConfig.stampsNeeded}).`
      });

      showFeedback('success', 'Configurações de funcionamento salvas com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar configurações de funcionamento.');
    } finally {
      setSubmittingStore(false);
    }
  };

  // Remove saved PagBank payment card from user account
  const handleRemoveCard = async () => {
    if (!user) return;
    if (!confirm('Deseja realmente remover o cartão de crédito salvo da sua conta? Você terá que digitá-lo novamente no próximo pagamento.')) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        pagbank_card_token: null,
        pagbank_card_brand: null,
        pagbank_card_last_digits: null,
        pagbank_customer_id: null,
        updatedAt: new Date().toISOString()
      });

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Usuário',
        actionType: 'REMOVE_PAYMENT_CARD',
        title: 'Remoção de Cartão Salvo',
        description: `O usuário removeu seu cartão de crédito salvo para pagamentos recorrentes.`
      });

      showFeedback('success', 'Cartão de crédito salvo removido com sucesso!');
    } catch (err) {
      console.error('Erro ao remover cartão de crédito:', err);
      showFeedback('error', 'Erro ao remover cartão de crédito salvo.');
    }
  };

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (digits.length <= 10) {
      return digits.replace(/^(\d{2})(\d{4})(\d{0,4})$/, (_, p1, p2, p3) => `(${p1}) ${p2}${p3 ? '-' + p3 : ''}`);
    } else {
      return digits.slice(0, 11).replace(/^(\d{2})(\d{5})(\d{0,4})$/, (_, p1, p2, p3) => `(${p1}) ${p2}${p3 ? '-' + p3 : ''}`);
    }
  };

  const formatCpf = (val: string) => {
    const digits = val.replace(/\D/g, '');
    return digits.substring(0, 11).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const getBadgeBackground = (actionType: string) => {
    switch (actionType) {
      case 'DELETE_USER':
        return 'rgba(239, 68, 68, 0.15)';
      case 'CREATE_USER':
        return 'rgba(16, 185, 129, 0.15)';
      case 'UPDATE_USER':
      case 'UPDATE_STORE_CONFIG':
        return 'rgba(245, 158, 11, 0.15)';
      case 'RESET_PASSWORD':
        return 'rgba(59, 130, 246, 0.15)';
      default:
        return 'rgba(255, 255, 255, 0.05)';
    }
  };

  const getIconComponent = (actionType: string) => {
    const size = 12;
    switch (actionType) {
      case 'DELETE_USER':
        return <Trash2 size={size} style={{ color: '#ef4444' }} />;
      case 'CREATE_USER':
        return <Plus size={size} style={{ color: '#10b981' }} />;
      case 'UPDATE_USER':
      case 'UPDATE_STORE_CONFIG':
        return <FileText size={size} style={{ color: '#f59e0b' }} />;
      case 'RESET_PASSWORD':
        return <KeyRound size={size} style={{ color: '#3b82f6' }} />;
      default:
        return <AlertCircle size={size} style={{ color: '#a3a3a3' }} />;
    }
  };

  const getWeeklyPeriod = () => {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    return { start: startOfWeek, end: endOfWeek };
  };

  const getMonthlyPeriod = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    
    let start: Date;
    let end: Date;
    
    if (currentDay >= 10) {
      start = new Date(currentYear, currentMonth, 10, 0, 0, 0, 0);
      end = new Date(currentYear, currentMonth + 1, 9, 23, 59, 59, 999);
    } else {
      start = new Date(currentYear, currentMonth - 1, 10, 0, 0, 0, 0);
      end = new Date(currentYear, currentMonth, 9, 23, 59, 59, 999);
    }
    
    return { start, end };
  };

  const filterOfflineOrders = (periodStart: Date, periodEnd: Date) => {
    return orders.filter(order => {
      if (order.status !== 'completed') return false;
      
      const orderDate = new Date(order.createdAt);
      if (orderDate < periodStart || orderDate > periodEnd) return false;
      
      const method = order.paymentMethod;
      if (method === 'dinheiro' && billDinheiro) return true;
      if (method === 'pix' && billPix) return true;
      if (method === 'debito' && billDebito) return true;
      if (method === 'credito' && billCredito) return true;
      
      return false;
    });
  };

  return (
    <div className="dashboard-layout animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <div className="dashboard-header">
        <h2>Configurações do Sistema ⚙️</h2>
        <p>Gerencie seus dados de perfil, endereços de entrega e configurações operacionais da pastelaria.</p>
      </div>

      {message && (
        <div 
          className={message.type === 'success' ? 'alert-box animate-fade-in' : 'auth-error-message animate-fade-in'}
          style={{
            marginBottom: '1.5rem',
            background: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            borderLeft: message.type === 'success' ? '4px solid #10b981' : '4px solid #ef4444',
            color: message.type === 'success' ? '#34d399' : '#f87171',
            padding: '1rem',
            borderRadius: '8px',
            fontSize: '0.9rem'
          }}
        >
          {message.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', marginTop: '1.5rem' }}>
        
        {/* Sidebar de Configurações */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.85rem 1rem',
              borderRadius: '12px',
              border: activeTab === 'profile' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
              background: activeTab === 'profile' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
              color: activeTab === 'profile' ? 'var(--primary-gold)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
              transition: 'all 0.2s',
              textAlign: 'left'
            }}
          >
            <User size={16} />
            <span>Meu Perfil</span>
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('store')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'store' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'store' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'store' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Store size={16} />
                <span>Funcionamento</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('loyalty')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'loyalty' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'loyalty' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'loyalty' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Shield size={16} />
                <span>Regras & Fidelidade</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('mesas')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'mesas' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'mesas' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'mesas' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <QrCode size={16} />
                <span>Mesas & QR Codes</span>
              </button>
            </>
          )}

          {(isDev || role === 'owner') && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'security' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'security' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'security' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Camera size={16} style={{ color: '#10b981' }} />
                <span>Segurança</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('advanced')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'advanced' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'advanced' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'advanced' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Shield size={16} style={{ color: '#a855f7' }} />
                <span>Avançado (Dev)</span>
              </button>
            </>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('audit_logs')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'audit_logs' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'audit_logs' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'audit_logs' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <History size={16} style={{ color: '#38bdf8' }} />
              <span>Logs de Auditoria</span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('commissions')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'commissions' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'commissions' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'commissions' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <CreditCard size={16} style={{ color: '#10b981' }} />
              <span>Fechamento de Comissão</span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('point_guide')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'point_guide' ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'point_guide' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'point_guide' ? '#60a5fa' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <CreditCard size={16} style={{ color: '#3b82f6' }} />
              <span>📟 Guia Maquininha</span>
            </button>
          )}
        </aside>

        {/* Formulários de Configurações */}
        <main className="loyalty-card" style={{ padding: '2rem', textAlign: 'left' }}>
          
          {/* Aba Mesas & QR Codes */}
          {activeTab === 'mesas' && isAdmin && (
            <TableQrCodeGenerator />
          )}

          {/* Aba Guia Maquininha Point */}
          {activeTab === 'point_guide' && isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.15rem' }}>
                  📟 Guia de Configuração — Maquininha Mercado Pago Point
                </h3>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Siga este guia passo a passo para ativar o pagamento por débito automático via maquininha.
                  O cliente seleciona "Débito" no app e a maquininha ativa sozinha esperando o cartão.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', borderRadius: '20px', padding: '0.25rem 0.75rem', fontSize: '0.78rem', fontWeight: 600 }}>✅ Point Smart 2</span>
                  <span style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', borderRadius: '20px', padding: '0.25rem 0.75rem', fontSize: '0.78rem', fontWeight: 600 }}>✅ Point Pro 3</span>
                  <span style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399', borderRadius: '20px', padding: '0.25rem 0.75rem', fontSize: '0.78rem', fontWeight: 600 }}>⏱ ~20 min para configurar</span>
                </div>
              </div>

              {/* PASSO 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>1</span>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>Acesse o painel de desenvolvedor do Mercado Pago</h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  Abra o navegador e acesse: <a href="https://mercadopago.com.br/developers/panel/app" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>mercadopago.com.br/developers/panel/app</a><br />
                  Faça login com a conta Mercado Pago da pastelaria.<br />
                  Clique em <strong style={{ color: '#fff' }}>&quot;Criar aplicação&quot;</strong> como mostrado na imagem abaixo.
                </p>
                <img src="/guide_step1.png" alt="Painel de Desenvolvedor Mercado Pago" style={{ width: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', marginTop: '0.5rem' }} />
                <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.82rem', color: '#fcd34d' }}>
                  💡 <strong>Dica:</strong> Se já tiver uma aplicação criada antes, pode usar ela. Basta clicar nela para acessar as credenciais.
                </div>
              </div>

              {/* PASSO 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>2</span>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>Copie o Access Token de produção</h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  Dentro da aplicação, vá na aba <strong style={{ color: '#fff' }}>Credenciais</strong>.<br />
                  Em <strong style={{ color: '#fff' }}>&quot;Credenciais de produção&quot;</strong>, clique no ícone de copiar ao lado do campo <strong style={{ color: '#fff' }}>Access Token</strong>.<br />
                  Ele começa com <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>APP_USR-</code> e é bem longo.
                </p>
                <img src="/guide_step2.png" alt="Copiar Access Token Mercado Pago" style={{ width: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', marginTop: '0.5rem' }} />
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.82rem', color: '#fca5a5' }}>
                  ⚠️ <strong>Atenção:</strong> Use apenas o token de <strong>produção</strong> (não o de teste). O token de teste começa com <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>TEST-</code>.
                </div>
              </div>

              {/* PASSO 3 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>3</span>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>Cadastre a loja e os caixas (maquininhas)</h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  Acesse: <a href="https://mercadopago.com.br/pointsmartintegration" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>mercadopago.com.br/pointsmartintegration</a><br />
                  No menu lateral, clique em <strong style={{ color: '#fff' }}>Seu negócio → Lojas e caixas</strong>.<br />
                  <strong style={{ color: '#fff' }}>1.</strong> Crie uma loja chamada <em>&quot;Dona Lu Pastelaria&quot;</em>.<br />
                  <strong style={{ color: '#fff' }}>2.</strong> Dentro da loja, clique em <strong style={{ color: '#fff' }}>&quot;Adicionar caixa&quot;</strong> e cadastre uma para a <em>Point Smart 2</em> e outra para a <em>Point Pro 3</em>.
                </p>
                <img src="/guide_step3.png" alt="Lojas e Caixas Mercado Pago" style={{ width: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', marginTop: '0.5rem' }} />
                <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.82rem', color: '#fcd34d' }}>
                  💡 <strong>Dica:</strong> Dê nomes claros para cada caixa, como &quot;Caixa 1 - Smart 2&quot; e &quot;Caixa 2 - Pro 3&quot;, para facilitar identificar depois.
                </div>
              </div>

              {/* PASSO 4 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>4</span>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>Ative o Modo PDV nas maquininhas</h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  Faça isso em <strong style={{ color: '#fff' }}>cada uma</strong> das maquininhas (Smart 2 e Pro 3):<br />
                  <strong style={{ color: '#fff' }}>1.</strong> Na tela inicial da maquininha, toque nos <strong style={{ color: '#fff' }}>3 pontinhos</strong> ou vá em <strong style={{ color: '#fff' }}>Configurações</strong>.<br />
                  <strong style={{ color: '#fff' }}>2.</strong> Procure a opção <strong style={{ color: '#fff' }}>&quot;Modo PDV&quot;</strong> ou <strong style={{ color: '#fff' }}>&quot;Integração com sistema&quot;</strong>.<br />
                  <strong style={{ color: '#fff' }}>3.</strong> Ative o toggle. A tela vai mostrar uma mensagem de &quot;Aguardando integração&quot; — isso é correto.
                </p>
                <img src="/guide_step4.png" alt="Ativar Modo PDV na maquininha" style={{ width: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', marginTop: '0.5rem' }} />
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.82rem', color: '#fca5a5' }}>
                  ⚠️ <strong>Importante:</strong> Com o Modo PDV ativado, a maquininha <strong>não funciona mais de forma independente</strong> para passar cartão manualmente — ela passa a receber ordens do sistema. Se precisar usar manualmente, desative o modo PDV.
                </div>
              </div>

              {/* PASSO 5 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>5</span>
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>Copie o ID do caixa (external_id / pos_id)</h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  De volta no painel do Mercado Pago, em <strong style={{ color: '#fff' }}>Lojas e caixas</strong>, clique no caixa que você criou.<br />
                  Copie o valor do campo <strong style={{ color: '#fff' }}>external_id</strong> ou <strong style={{ color: '#fff' }}>ID do caixa</strong>.<br />
                  Exemplo: <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>CAIXA_001</code> ou um número como <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem' }}>123456789</code>.
                </p>
                <img src="/guide_step5.png" alt="Copiar external_id do caixa" style={{ width: '100%', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', marginTop: '0.5rem' }} />
              </div>

              {/* PASSO 6 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(16,185,129,0.06)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>6</span>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: '#34d399' }}>Informe os dados ao desenvolvedor</h4>
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  Passe os seguintes dados para o desenvolvedor cadastrar no sistema:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {[
                    { label: '🔑 Access Token (produção)', hint: 'Começa com APP_USR-...' },
                    { label: '📟 ID do Caixa — Point Smart 2', hint: 'external_id do caixa 1' },
                    { label: '📟 ID do Caixa — Point Pro 3', hint: 'external_id do caixa 2' },
                  ].map(item => (
                    <div key={item.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '0.6rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{item.label}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{item.hint}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.82rem', color: '#34d399' }}>
                  ✅ Com essas informações, o desenvolvedor faz a integração e o débito passa a funcionar automaticamente quando o cliente selecionar essa opção no app!
                </div>
              </div>
            </div>
          )}

          {/* Aba 1: Meu Perfil */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Meu Perfil e Endereço</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label>Nome Completo</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    value={profileName}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Definido via provedor de login</span>
                </div>
                <div className="input-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    className="pastel-edit-input"
                    value={user?.email || ''}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label>Celular (WhatsApp)</label>
                  <input
                    type="tel"
                    className="pastel-edit-input"
                    placeholder="(21) 99999-9999"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(formatPhone(e.target.value))}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>CPF do Titular</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="000.000.000-00"
                    value={profileCpf}
                    onChange={(e) => setProfileCpf(formatCpf(e.target.value))}
                    required
                  />
                </div>
              </div>

              <h4 style={{ margin: '0.5rem 0 0 0', color: 'var(--primary-gold)' }}>Endereço de Entrega Principal</h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label>Rua / Logradouro</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Av. Cesário de Melo"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Número</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="123"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label>Bairro</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Campo Grande"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Cidade</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Rio de Janeiro"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label>CEP</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="23000-000"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2'))}
                    maxLength={9}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Complemento / Ponto de Referência</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Apto 302, Bloco B"
                    value={complement}
                    onChange={(e) => setComplement(e.target.value)}
                  />
                </div>
              </div>

              {/* Seção Cartão Salvo */}
              <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CreditCard size={18} /> Cartão de Crédito no Cofre (PagBank)
                </h4>
                {userData?.pagbank_card_token ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <strong style={{ textTransform: 'uppercase', color: '#fff' }}>{userData.pagbank_card_brand}</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Terminado em **** {userData.pagbank_card_last_digits}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCard}
                      className="btn-small"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
                    >
                      <Trash2 size={14} /> Excluir Cartão
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>Nenhum cartão cadastrado no cofre atualmente. Você poderá salvar um cartão durante o checkout de novos pedidos.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submittingProfile}
                className="auth-btn auth-btn-login"
                style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem' }}
              >
                <Save size={16} />
                <span>{submittingProfile ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            </form>
          )}

          {/* Aba 2: Funcionamento da Loja */}
          {activeTab === 'store' && isAdmin && (
            <form onSubmit={handleSaveStoreConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Funcionamento da Pastelaria</h3>
              
              {loadingStore ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                  <div className="spinner" style={{ width: '18px', height: '18px' }} />
                  <span>Carregando parâmetros operacionais...</span>
                </div>
              ) : (
                <>
                  {/* Status Aberto/Fechado */}
                  <div className="input-group" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '1rem', color: '#fff' }}>Status da Loja (Novos Pedidos)</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {storeConfig.isOpen 
                          ? '🟢 Loja aberta e recebendo pedidos normalmente.' 
                          : '🔴 Loja fechada. Clientes não conseguirão fechar o carrinho.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleStoreOpen}
                      style={{
                        background: storeConfig.isOpen ? '#059669' : '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '24px',
                        padding: '0.5rem 1.5rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {storeConfig.isOpen ? 'ABERTO' : 'FECHADO'}
                    </button>
                  </div>

                  {/* Horários */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="input-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Clock size={14} /> Horário de Abertura
                      </label>
                      <input
                        type="text"
                        className="pastel-edit-input"
                        placeholder="18:00"
                        value={storeConfig.openingTime}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, openingTime: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Clock size={14} /> Horário de Fechamento
                      </label>
                      <input
                        type="text"
                        className="pastel-edit-input"
                        placeholder="23:30"
                        value={storeConfig.closingTime}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, closingTime: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  {/* Taxa de Entrega */}
                  <div className="input-group" style={{ maxWidth: '240px' }}>
                    <label>Taxa de Entrega Padrão (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="pastel-edit-input"
                      value={storeConfig.deliveryFee}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, deliveryFee: parseFloat(e.target.value) || 0 }))}
                      required
                    />
                  </div>

                  {/* Endereço e Contato */}
                  <div className="input-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <MapPin size={14} /> Endereço Físico Exibido
                    </label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      value={storeConfig.storeAddress}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, storeAddress: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="input-group" style={{ maxWidth: '280px' }}>
                    <label>Telefone de Contato Exibido</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      value={storeConfig.phoneContact}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, phoneContact: e.target.value }))}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submittingStore}
                    className="auth-btn auth-btn-login"
                    style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem' }}
                  >
                    <Save size={16} />
                    <span>{submittingStore ? 'Gravando...' : 'Gravar Configurações'}</span>
                  </button>
                </>
              )}
            </form>
          )}

          {/* Aba 3: Fidelidade */}
          {activeTab === 'loyalty' && isAdmin && (
            <form onSubmit={handleSaveStoreConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Regras do Cartão Fidelidade</h3>

              <div className="input-group" style={{ maxWidth: '300px' }}>
                <label>Carimbos necessários para pastel grátis</label>
                <input
                  type="number"
                  className="pastel-edit-input"
                  value={storeConfig.stampsNeeded}
                  onChange={(e) => setStoreConfig(prev => ({ ...prev, stampsNeeded: parseInt(e.target.value) || 10 }))}
                  min="5"
                  max="20"
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Por padrão, o cliente acumula 1 carimbo por pedido concluído e resgata ao completar esta meta.</span>
              </div>

              <button
                type="submit"
                disabled={submittingStore}
                className="auth-btn auth-btn-login"
                style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem' }}
              >
                <Save size={16} />
                <span>{submittingStore ? 'Salvar Regras' : 'Salvar Regras'}</span>
              </button>
            </form>
          )}

          {/* Aba 4: Avançado Dev */}
          {activeTab === 'advanced' && (isDev || role === 'owner') && (
            <form onSubmit={handleSaveDevMPConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: '#a855f7' }}>Split de Pagamentos & Mercado Pago 💳</h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Configure as regras de repasse (split) de vendas automatizadas entre a conta de manutenção do desenvolvedor e a conta do estabelecimento.
                </p>
              </div>

              {/* 1. Escolha da porcentagem do Split */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--primary-gold)' }}>
                  Opções de Divisão (Split)
                </label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {[
                    { pct: 1, label: '1% Dev / 99% Loja (Padrão)' },
                    { pct: 5, label: '5% Dev / 95% Loja' },
                    { pct: 10, label: '10% Dev / 90% Loja' },
                    { pct: 0, label: 'Sem Split (100% Loja)' }
                  ].map((option) => {
                    const isSelected = (storeConfig.devPercentage ?? 1) === option.pct;
                    const disabled = !isDev;
                    return (
                      <button
                        key={option.pct}
                        type="button"
                        disabled={disabled}
                        onClick={() => setStoreConfig(prev => ({ ...prev, devPercentage: option.pct }))}
                        style={{
                          padding: '0.6rem 1rem',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid var(--primary-gold)' : '1px solid rgba(255, 255, 255, 0.08)',
                          background: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                          color: isSelected ? 'var(--primary-gold)' : 'var(--text-secondary)',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.6 : 1,
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          transition: 'all 0.2s'
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Configuração do Desenvolvedor */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#a855f7' }}>
                  Conta do Desenvolvedor (Recebe {storeConfig.devPercentage ?? 1}%)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="input-group">
                    <label>Mercado Pago Client ID (Dev)</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="Ex: 87878437306"
                      value={storeConfig.devClientId || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, devClientId: e.target.value }))}
                      disabled={!isDev}
                      style={!isDev ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                    />
                  </div>
                  <div className="input-group">
                    <label>Access Token de Produção (Dev)</label>
                    <input
                      type="password"
                      className="pastel-edit-input"
                      placeholder="Ex: APP_USR-..."
                      value={storeConfig.devAccessToken || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, devAccessToken: e.target.value }))}
                      disabled={!isDev}
                      style={!isDev ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                    />
                  </div>
                </div>
              </div>

              {/* 3. Conexão do Estabelecimento */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#38bdf8' }}>
                  Conta do Estabelecimento (Recebe {100 - (storeConfig.devPercentage ?? 1)}%)
                </label>

                {storeConfig.storeOwnerEmail ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <span style={{ color: '#34d399', fontSize: '0.85rem', fontWeight: 600 }}>✓ Conectado via Mercado Pago</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>E-mail: {storeConfig.storeOwnerEmail}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStoreConfig(prev => ({ ...prev, storeOwnerEmail: '', storeOwnerAccessToken: '' }))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        textDecoration: 'underline'
                      }}
                    >
                      Desconectar conta
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Nenhuma conta do estabelecimento conectada para receber os {100 - (storeConfig.devPercentage ?? 1)}% restantes das vendas.
                    </p>
                    <button
                      type="button"
                      onClick={handleLoginEstablishment}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        padding: '0.65rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#009ee3',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#0082c5'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#009ee3'}
                    >
                      <span>Conectar com Mercado Pago ({100 - (storeConfig.devPercentage ?? 1)}%)</span>
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertCircle size={14} style={{ color: 'var(--primary-gold)' }} />
                  <span>Configurações salvas diretamente no banco de dados.</span>
                </div>
                <button
                  type="submit"
                  disabled={submittingDevMP}
                  className="auth-btn auth-btn-login"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem', margin: 0 }}
                >
                  <Save size={16} />
                  <span>{submittingDevMP ? 'Salvando...' : 'Salvar Configurações do Split'}</span>
                </button>
              </div>
            </form>
          )}
          {/* Aba 5: Logs de Auditoria */}
          {activeTab === 'audit_logs' && isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Histórico Visível (Timeline)</h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Sempre que um administrador realizar uma ação crítica no banco de dados (ex: deletar), isso ficará guardado aqui em formato fácil de ler.
                </p>
              </div>

              {loadingLogs ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                  <div className="spinner" style={{ width: '32px', height: '32px', border: '3px solid rgba(245, 158, 11, 0.1)', borderTopColor: 'var(--primary-gold)' }} />
                </div>
              ) : auditLogs.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  Nenhum log de auditoria encontrado.
                </div>
              ) : (
                <div style={{ position: 'relative', borderLeft: '2px solid rgba(255, 255, 255, 0.05)', paddingLeft: '0.5rem', margin: '0.5rem 0 0 0.5rem' }}>
                  {auditLogs.map((log) => (
                    <div key={log.id} style={{ position: 'relative', paddingLeft: '2rem', marginBottom: '1.75rem' }}>
                      {/* Círculo do timeline com o ícone */}
                      <div style={{
                        position: 'absolute',
                        left: '-33px', // centraliza perfeitamente o círculo de 24px sobre a borda esquerda de 2px
                        top: '4px',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: getBadgeBackground(log.actionType),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px solid #141010'
                      }}>
                        {getIconComponent(log.actionType)}
                      </div>

                      {/* Card do log */}
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {log.title}
                          </h4>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString('pt-BR') : new Date(log.timestamp).toLocaleString('pt-BR')}
                          </span>
                        </div>

                        <div style={{
                          background: 'rgba(0, 0, 0, 0.15)',
                          border: '1px solid rgba(255, 255, 255, 0.03)',
                          borderRadius: '8px',
                          padding: '0.75rem 1rem',
                          fontSize: '0.9rem',
                          color: 'var(--text-secondary)',
                          lineHeight: '1.4'
                        }}>
                          {log.description}
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', opacity: 0.8 }}>
                          Resp: <span style={{ color: 'var(--primary-gold)' }}>{log.userEmail}</span> • Tipo: <code style={{ color: '#a855f7' }}>{log.actionType}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Aba 6: Fechamento de Comissões */}
          {activeTab === 'commissions' && isAdmin && (() => {
            const weeklyPeriod = getWeeklyPeriod();
            const monthlyPeriod = getMonthlyPeriod();
            const weeklyOrders = filterOfflineOrders(weeklyPeriod.start, weeklyPeriod.end);
            const monthlyOrders = filterOfflineOrders(monthlyPeriod.start, monthlyPeriod.end);
            
            const pct = storeConfig.devPercentage ?? 1;
            
            const totalWeeklySales = weeklyOrders.reduce((sum, o) => sum + o.total, 0);
            const weeklyCommissions = totalWeeklySales * (pct / 100);
            
            const totalMonthlySales = monthlyOrders.reduce((sum, o) => sum + o.total, 0);
            const monthlyCommissions = totalMonthlySales * (pct / 100);

            const displayPaymentMethod = (method: string) => {
              switch (method) {
                case 'dinheiro': return '💵 Dinheiro';
                case 'pix': return '📱 Pix Manual';
                case 'debito': return 'Debito (Maquininha)';
                case 'credito': return 'Credito (Maquininha)';
                default: return method;
              }
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: 'var(--primary-gold)' }}>Fechamento de Comissões (Faturamento Dev) 💼</h3>
                  <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Visualize e gerencie os valores a pagar referentes à taxa de comissão de <strong>{pct}%</strong> sobre as vendas realizadas por fora do split online.
                  </p>
                </div>

                {/* Filtros de Métodos de Pagamento Offline */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                    Métodos de Pagamento Sujeitos a Comissão
                  </label>
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billDinheiro} onChange={(e) => setBillDinheiro(e.target.checked)} />
                      <span>Dinheiro em Espécie</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billPix} onChange={(e) => setBillPix(e.target.checked)} />
                      <span>Pix por fora do sistema</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billDebito} onChange={(e) => setBillDebito(e.target.checked)} />
                      <span>Cartão de Débito (Maquininha)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billCredito} onChange={(e) => setBillCredito(e.target.checked)} />
                      <span>Cartão de Crédito (Maquininha/Não integrado)</span>
                    </label>
                  </div>
                </div>

                {/* Grid dos Fechamentos */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  
                  {/* Semana */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fechamento Semanal</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.6rem', borderRadius: '20px' }}>Toda Segunda-feira</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Período Atual:</div>
                      <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                        {weeklyPeriod.start.toLocaleDateString('pt-BR')} a {weeklyPeriod.end.toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Vendas Offline:</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>R$ {totalWeeklySales.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Taxa Dev ({pct}%):</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary-gold)' }}>R$ {weeklyCommissions.toFixed(2)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => alert(`Relatório semanal gerado! Total da comissão a pagar para o desenvolvedor: R$ ${weeklyCommissions.toFixed(2)}.`)}
                      style={{ marginTop: '0.5rem', padding: '0.65rem', border: 'none', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'}
                    >
                      Fechar Semana & Cobrar
                    </button>
                  </div>

                  {/* Mensal */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', color: '#a855f7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fechamento Mensal</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.6rem', borderRadius: '20px' }}>Todo dia 10</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Período Atual:</div>
                      <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                        {monthlyPeriod.start.toLocaleDateString('pt-BR')} a {monthlyPeriod.end.toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Vendas Offline:</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>R$ {totalMonthlySales.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Taxa Dev ({pct}%):</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary-gold)' }}>R$ {monthlyCommissions.toFixed(2)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => alert(`Relatório mensal gerado! Total da comissão a pagar para o desenvolvedor: R$ ${monthlyCommissions.toFixed(2)}.`)}
                      style={{ marginTop: '0.5rem', padding: '0.65rem', border: 'none', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)'}
                    >
                      Fechar Mês & Cobrar
                    </button>
                  </div>

                </div>

                {/* Tabela de Pedidos do Período Atual */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', overflow: 'hidden' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                    Detalhamento dos Pedidos no Período
                  </label>
                  
                  {loadingOrders ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                      <div className="spinner" style={{ width: '24px', height: '24px', border: '2px solid rgba(245, 158, 11, 0.1)', borderTopColor: 'var(--primary-gold)' }} />
                    </div>
                  ) : [...weeklyOrders, ...monthlyOrders].length === 0 ? (
                    <p style={{ margin: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>
                      Nenhum pedido offline concluído no período atual.
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>ID Pedido</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>Data/Hora</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>Cliente</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>Pagamento</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Total</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Comissão ({pct}%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from(new Set([...weeklyOrders, ...monthlyOrders])).map((order) => {
                            const commVal = order.total * (pct / 100);
                            return (
                              <tr key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>#{order.dailySeq || order.id?.substring(0, 5).toUpperCase()}</td>
                                <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>{new Date(order.createdAt).toLocaleString('pt-BR')}</td>
                                <td style={{ padding: '0.75rem 0.5rem' }}>{order.clientName}</td>
                                <td style={{ padding: '0.75rem 0.5rem' }}>{displayPaymentMethod(order.paymentMethod)}</td>
                                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>R$ {order.total.toFixed(2)}</td>
                                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600, color: 'var(--primary-gold)' }}>R$ {commVal.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Aba 7: Segurança e Câmeras IP */}
          {activeTab === 'security' && (isDev || role === 'owner') && (
            <SecurityCameraSettings />
          )}

        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
