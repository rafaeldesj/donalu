import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { OrderItem } from './types/order';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthButton } from './components/common/AuthButton';
import { ShieldCheck, ChefHat, CreditCard, Bell, ShoppingCart, Heart, FileText, Users, Navigation, CheckCircle, Clock, Map, Settings, Menu, ChevronDown, Grid, Boxes, MessageCircle, ShoppingBag, Monitor } from 'lucide-react';
import logoDonalu from './assets/logo_donalu.png';
import logoDonaluMobile from './assets/logo_donalu_mobile.png';
import { doc, onSnapshot, collection, query, orderBy, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import entrouPedidoSound from './sounds/entrou-pedido.mp3';
import pedidoProntoSound from './sounds/pedido-pronto.mp3';
import olhaAMensagemSound from './sounds/olha-a-mensagem.mp3';
import buildingCartSound from './sounds/clientemontandocarrinho.mp3';
import { printOrder, getPrinterSettings } from './utils/printer';
import type { OrderDocument } from './types/order';
import { db } from './config/firebase';
import { VirtualAssistantBubble } from './components/VirtualAssistantBubble';
import { ClientSupportChat } from './components/ClientSupportChat';

// Lazy-loaded components for code-splitting performance
const ClientDashboard = lazy(() => import('./pages/client/ClientDashboard'));
const StaffDashboard = lazy(() => import('./pages/staff/StaffDashboard'));
const AdminDashboard = lazy(() => import('./pages/manager/AdminDashboard'));
const UserManagement = lazy(() => import('./pages/manager/UserManagement'));
const DeliveryActive = lazy(() => import('./pages/delivery/DeliveryActive'));
const DeliveryHistory = lazy(() => import('./pages/delivery/DeliveryHistory'));
const ManagerDeliveryActive = lazy(() => import('./pages/manager/ManagerDeliveryActive'));
const OrderTracking = lazy(() => import('./pages/client/OrderTracking'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TableMap = lazy(() => import('./pages/staff/TableMap'));
const StockControl = lazy(() => import('./pages/staff/StockControl'));
const SupportPanel = lazy(() => import('./pages/staff/SupportPanel'));
const RiderLocationMonitor = lazy(() => import('./pages/manager/RiderLocationMonitor'));
const SystemLogs = lazy(() => import('./pages/manager/SystemLogs'));
const PdvSales = lazy(() => import('./pages/staff/PdvSales'));
const OrderDisplayScreen = lazy(() => import('./pages/staff/OrderDisplayScreen'));

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

  const [pulseKitchenMenu, setPulseKitchenMenu] = useState(false);
  const [orders, setOrders] = useState<OrderDocument[]>([]);

  const pendingAudioRef = useRef<HTMLAudioElement | null>(null);
  const preparingAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingTimeoutRef = useRef<any>(null);
  const preparingTimeoutRef = useRef<any>(null);
  const watchdogIntervalRef = useRef<any>(null);
  const silentAudioCtxRef = useRef<AudioContext | null>(null);
  const buildingCartAudioRef = useRef<HTMLAudioElement | null>(null);

  const isPendingSoundPlayingRef = useRef(false);
  const isPreparingSoundPlayingRef = useRef(false);
  const messageAudioRef = useRef<HTMLAudioElement | null>(null);
  const messageTimeoutRef = useRef<any>(null);
  const isMessageSoundPlayingRef = useRef(false);

  const role = userData?.role || 'client';
  const staff = userData?.staffFunctions;
  const isStaff = ['developer', 'owner', 'manager', 'staff'].includes(role);

  // Pulse reset when kitchen view is active
  useEffect(() => {
    if (activeView === 'cozinha') {
      setPulseKitchenMenu(false);
    }
  }, [activeView]);

  // Keep silent AudioContext active to prevent browser tab sleep/freeze on audio
  useEffect(() => {
    if (!isStaff) return;
    try {
      if (!silentAudioCtxRef.current || silentAudioCtxRef.current.state === 'closed') {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start();
        silentAudioCtxRef.current = ctx;
      } else if (silentAudioCtxRef.current.state === 'suspended') {
        silentAudioCtxRef.current.resume();
      }
    } catch {
      // non-critical
    }
    return () => {
      if (silentAudioCtxRef.current && silentAudioCtxRef.current.state !== 'closed') {
        silentAudioCtxRef.current.close();
        silentAudioCtxRef.current = null;
      }
    };
  }, [isStaff]);

  // Global orders real-time listener for background printing and notifications
  useEffect(() => {
    if (!user || !isStaff) {
      if (pendingAudioRef.current) { pendingAudioRef.current.pause(); pendingAudioRef.current = null; }
      if (preparingAudioRef.current) { preparingAudioRef.current.pause(); preparingAudioRef.current = null; }
      if (pendingTimeoutRef.current) { clearTimeout(pendingTimeoutRef.current); pendingTimeoutRef.current = null; }
      if (preparingTimeoutRef.current) { clearTimeout(preparingTimeoutRef.current); preparingTimeoutRef.current = null; }
      isPendingSoundPlayingRef.current = false;
      isPreparingSoundPlayingRef.current = false;
      return;
    }

    const q = query(collection(db, 'orders'), orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      let newOrderDetected = false;

      snapshot.forEach((docSnap) => {
        const orderData = docSnap.data() as any;
        if (!orderData.isTest || role === 'developer') {
          fetched.push({ id: docSnap.id, ...orderData } as OrderDocument);
        }
      });

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const order = { id: change.doc.id, ...change.doc.data() } as any;
          if (order.isTest && role !== 'developer') return;
          const orderTime = new Date(order.createdAt).getTime();
          const nowTime = Date.now();
          if (nowTime - orderTime < 30000 && order.status === 'pending') {
            newOrderDetected = true;
            try {
              const printerSet = getPrinterSettings();
              if (printerSet.autoPrintOnNew) {
                printOrder(order).catch(err => console.error("Erro ao auto-imprimir:", err));
              }
            } catch (err) {
              console.error("Erro no auto-print:", err);
            }
          } else if (nowTime - orderTime < 30000 && order.status === 'building_cart') {
             // Play sound for initial cart creation
             if (!buildingCartAudioRef.current) {
                 buildingCartAudioRef.current = new Audio(buildingCartSound);
                 buildingCartAudioRef.current.loop = false;
                 buildingCartAudioRef.current.volume = 0.8;
             }
             if (buildingCartAudioRef.current) {
               buildingCartAudioRef.current.play().catch(() => {});
             }
          }
        } else if (change.type === 'modified') {
          const order = change.doc.data() as any;
          if (order.isTest && role !== 'developer') return;
          
          if (order.status === 'building_cart') {
            // Play sound for cart update
            if (!buildingCartAudioRef.current) {
                buildingCartAudioRef.current = new Audio(buildingCartSound);
                buildingCartAudioRef.current.loop = false;
                buildingCartAudioRef.current.volume = 0.8;
            }
            if (buildingCartAudioRef.current) {
               // Reset audio to start so it can trigger repeatedly if items are added quickly
               buildingCartAudioRef.current.currentTime = 0;
               buildingCartAudioRef.current.play().catch(() => {});
            }
          }
        }
      });

      if (newOrderDetected && activeView !== 'cozinha') {
        setPulseKitchenMenu(true);
      }

      setOrders(fetched);
    }, (error) => {
      console.error("Erro no background orders listener:", error);
    });

    return () => {
      unsubscribe();
    };
  }, [user, isStaff, activeView]);

  // Unified global background audio control loop for cook notifications
  useEffect(() => {
    if (!isStaff || orders.length === 0) return;

    const canCook = role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.cook);
    if (!canCook) return;

    const hasPending = orders.some(o => o.status === 'pending');
    const hasPreparing = orders.some(o => o.status === 'prepared');

    let volPending = 0.8;
    let volPreparing = 0.9;
    try {
      const savedVolPending = localStorage.getItem('donalu_volume_pending');
      const savedVolPreparing = localStorage.getItem('donalu_volume_preparing');
      if (savedVolPending !== null) volPending = parseFloat(savedVolPending);
      if (savedVolPreparing !== null) volPreparing = parseFloat(savedVolPreparing);
    } catch {}

    if (!pendingAudioRef.current) {
      pendingAudioRef.current = new Audio(entrouPedidoSound);
      pendingAudioRef.current.loop = false;
      pendingAudioRef.current.volume = volPending;
    } else {
      pendingAudioRef.current.volume = volPending;
    }

    if (!preparingAudioRef.current) {
      preparingAudioRef.current = new Audio(pedidoProntoSound);
      preparingAudioRef.current.loop = false;
      preparingAudioRef.current.volume = volPreparing;
    } else {
      preparingAudioRef.current.volume = volPreparing;
    }

    if (!hasPending) {
      if (pendingAudioRef.current) pendingAudioRef.current.pause();
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
      isPendingSoundPlayingRef.current = false;
    }

    if (!hasPreparing) {
      if (preparingAudioRef.current) preparingAudioRef.current.pause();
      if (preparingTimeoutRef.current) {
        clearTimeout(preparingTimeoutRef.current);
        preparingTimeoutRef.current = null;
      }
      isPreparingSoundPlayingRef.current = false;
    }

    const triggerPreparingSoundCycle = () => {
      if (!orders.some(o => o.status === 'prepared')) return;
      isPreparingSoundPlayingRef.current = true;

      if (pendingAudioRef.current) {
        pendingAudioRef.current.pause();
        isPendingSoundPlayingRef.current = false;
        if (pendingTimeoutRef.current) {
          clearTimeout(pendingTimeoutRef.current);
          pendingTimeoutRef.current = null;
        }
      }

      if (preparingAudioRef.current) {
        preparingAudioRef.current.play().catch(err => {
          console.warn("Autoplay preparado bloqueado:", err);
          handlePreparingSoundEnded();
        });
        preparingAudioRef.current.onended = handlePreparingSoundEnded;
      }
    };

    const handlePreparingSoundEnded = () => {
      isPreparingSoundPlayingRef.current = false;
      const stillHasPending = orders.some(o => o.status === 'pending');
      const stillHasPreparing = orders.some(o => o.status === 'prepared');

      if (stillHasPending) {
        triggerPendingSoundCycle();
      }
      if (stillHasPreparing) {
        if (preparingTimeoutRef.current) clearTimeout(preparingTimeoutRef.current);
        preparingTimeoutRef.current = setTimeout(triggerPreparingSoundCycle, 30000);
      }
    };

    const triggerPendingSoundCycle = () => {
      if (!orders.some(o => o.status === 'pending')) return;
      if (isPreparingSoundPlayingRef.current) return;
      isPendingSoundPlayingRef.current = true;

      if (pendingAudioRef.current) {
        pendingAudioRef.current.currentTime = 0;
        pendingAudioRef.current.play().catch(err => {
          console.warn("Autoplay novo pedido bloqueado:", err);
          handlePendingSoundEnded();
        });
        pendingAudioRef.current.onended = handlePendingSoundEnded;
      }
    };

    const handlePendingSoundEnded = () => {
      isPendingSoundPlayingRef.current = false;
      const stillHasPending = orders.some(o => o.status === 'pending');
      if (stillHasPending && !isPreparingSoundPlayingRef.current) {
        if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = setTimeout(triggerPendingSoundCycle, 15000);
      }
    };

    if (hasPreparing && preparingAudioRef.current && preparingAudioRef.current.paused && !preparingTimeoutRef.current) {
      triggerPreparingSoundCycle();
    }
    if (hasPending && !isPreparingSoundPlayingRef.current && !isPendingSoundPlayingRef.current && !pendingTimeoutRef.current) {
      triggerPendingSoundCycle();
    }

    if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current);
    watchdogIntervalRef.current = setInterval(() => {
      if (silentAudioCtxRef.current && silentAudioCtxRef.current.state === 'suspended') {
        silentAudioCtxRef.current.resume().catch(() => {});
      }
      const nowHasPending = orders.some(o => o.status === 'pending');
      const nowHasPreparing = orders.some(o => o.status === 'prepared');

      if (nowHasPending && !isPreparingSoundPlayingRef.current && !isPendingSoundPlayingRef.current && !pendingTimeoutRef.current) {
        triggerPendingSoundCycle();
      }
      if (nowHasPreparing && !isPreparingSoundPlayingRef.current && preparingAudioRef.current?.paused && !preparingTimeoutRef.current) {
        triggerPreparingSoundCycle();
      }
    }, 20000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (silentAudioCtxRef.current && silentAudioCtxRef.current.state === 'suspended') {
        silentAudioCtxRef.current.resume().catch(() => {});
      }
      const nowHasPending = orders.some(o => o.status === 'pending');
      const nowHasPreparing = orders.some(o => o.status === 'prepared');

      if (nowHasPreparing && !isPreparingSoundPlayingRef.current && preparingAudioRef.current?.paused && !preparingTimeoutRef.current) {
        triggerPreparingSoundCycle();
      }
      if (nowHasPending && !isPreparingSoundPlayingRef.current && !isPendingSoundPlayingRef.current && !pendingTimeoutRef.current) {
        triggerPendingSoundCycle();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }
    };
  }, [orders, isStaff, role, staff]);

  // Sync building_cart
  const [buildingCartOrderId, setBuildingCartOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return; // Apply for authenticated users (including staff testing/buying)

    const syncCartToFirestore = async () => {
      if (cart.length > 0) {
        const total = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
        
        if (!buildingCartOrderId) {
          const newRef = doc(collection(db, 'orders'));
          setBuildingCartOrderId(newRef.id);
          try {
            await setDoc(newRef, {
              clientUid: user.uid,
              clientName: userData?.name || 'Cliente',
              items: cart,
              total,
              status: 'building_cart',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          } catch(e) {
            console.error('Erro ao sincronizar montagem de carrinho', e);
          }
        } else {
          const ref = doc(db, 'orders', buildingCartOrderId);
          try {
            await updateDoc(ref, {
              items: cart,
              total,
              updatedAt: new Date().toISOString()
            });
          } catch(e) {
             // Se o documento já não existir ou algo do tipo
             setBuildingCartOrderId(null);
          }
        }
      } else if (cart.length === 0 && buildingCartOrderId) {
        const ref = doc(db, 'orders', buildingCartOrderId);
        setBuildingCartOrderId(null);
        try {
          await deleteDoc(ref);
        } catch(e) {}
      }
    };
    
    const timer = setTimeout(syncCartToFirestore, 600);
    return () => clearTimeout(timer);
  }, [cart, user, userData, buildingCartOrderId, isStaff]);

  // Support chat global status listener and audio notification
  const [supportChats, setSupportChats] = useState<any[]>([]);

  useEffect(() => {
    if (!user || !isStaff) {
      setSupportChats([]);
      return;
    }

    const q = collection(db, 'support_chats');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setSupportChats(list);
    }, (err) => {
      console.error("Erro ao escutar chats no App:", err);
    });

    return () => unsubscribe();
  }, [user, isStaff]);

  useEffect(() => {
    if (!isStaff || supportChats.length === 0) {
      if (messageAudioRef.current) {
        messageAudioRef.current.pause();
        messageAudioRef.current = null;
      }
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = null;
      }
      isMessageSoundPlayingRef.current = false;
      return;
    }

    const hasNewMessage = supportChats.some(chat => {
      const msgs = chat.messages || [];
      if (msgs.length === 0) return false;
      const lastMsg = msgs[msgs.length - 1];
      return chat.unreadByOperator === true && chat.isAnswered !== true && lastMsg?.sender === 'client';
    });

    if (!messageAudioRef.current) {
      messageAudioRef.current = new Audio(olhaAMensagemSound);
      messageAudioRef.current.loop = false;
      messageAudioRef.current.volume = 0.85;
    }

    if (!hasNewMessage) {
      if (messageAudioRef.current) messageAudioRef.current.pause();
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = null;
      }
      isMessageSoundPlayingRef.current = false;
      return;
    }

    const triggerMessageSoundCycle = () => {
      const stillHasNew = supportChats.some(chat => {
        const msgs = chat.messages || [];
        if (msgs.length === 0) return false;
        const lastMsg = msgs[msgs.length - 1];
        return chat.unreadByOperator === true && chat.isAnswered !== true && lastMsg?.sender === 'client';
      });

      if (!stillHasNew) return;
      isMessageSoundPlayingRef.current = true;

      if (messageAudioRef.current) {
        messageAudioRef.current.play().catch(err => {
          console.warn("Autoplay olha-a-mensagem bloqueado:", err);
          handleMessageSoundEnded();
        });
        messageAudioRef.current.onended = handleMessageSoundEnded;
      }
    };

    const handleMessageSoundEnded = () => {
      isMessageSoundPlayingRef.current = false;
      const stillHasNew = supportChats.some(chat => {
        const msgs = chat.messages || [];
        if (msgs.length === 0) return false;
        const lastMsg = msgs[msgs.length - 1];
        return chat.unreadByOperator === true && chat.isAnswered !== true && lastMsg?.sender === 'client';
      });

      if (stillHasNew) {
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = setTimeout(triggerMessageSoundCycle, 30000);
      }
    };

    if (!isMessageSoundPlayingRef.current) {
      triggerMessageSoundCycle();
    }

    return () => {
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = null;
      }
    };
  }, [supportChats, isStaff]);

  // Detect Mercado Pago OAuth redirect — store the code and navigate to settings
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mpCode = params.get('code');
    if (mpCode) {
      // Persist the code so SettingsPage can pick it up after navigation
      sessionStorage.setItem('mp_oauth_pending_code', mpCode);
      // Clean the URL so the code isn't reused on refresh
      window.history.replaceState({}, '', window.location.pathname);
      // Navigate to settings to complete the exchange
      setActiveView('configuracoes');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (storeConfig.isTemporarilyClosed === true) {
        setStoreStatus({ status: 'closed', label: 'Fechado hoje' });
        return;
      }

      // A verificação de horário agora é executada para todos os usuários para mostrar a situação real da loja no badge.
      // Usuários privilegiados (dev, owner, manager) ainda conseguem realizar pedidos de teste no cardápio mesmo com a loja fechada.

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

      // Verifica os dias da semana em que abre
      if (storeConfig.openDays && storeConfig.openDays.length > 0) {
        let businessDayIndex = now.getDay();
        if (closesNextDay && currentTimeInMinutes < closeTimeInMinutes) {
          businessDayIndex = (businessDayIndex - 1 + 7) % 7;
        }
        const isDayOpen = storeConfig.openDays.includes(businessDayIndex) || 
                          storeConfig.openDays.includes(businessDayIndex.toString());
        if (!isDayOpen) {
          setStoreStatus({ status: 'closed', label: 'Fechado hoje' });
          return;
        }
      }

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
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 120);
  };


  // Atualiza a visualização inicial ativa baseando-se no papel (apenas uma vez ao carregar/fazer login)
  const initialViewSet = useRef(false);
  useEffect(() => {
    if (!user) {
      initialViewSet.current = false;
      return;
    }
    if (userData && !initialViewSet.current) {
      initialViewSet.current = true;
      if (userData.role === 'staff') {
        if (userData.staffFunctions?.cook) setActiveView('cozinha');
        else if (userData.staffFunctions?.attendant) setActiveView('atendimento');
        else if (userData.staffFunctions?.cashier) setActiveView('caixa');
        else if (userData.staffFunctions?.delivery) setActiveView('entrega_andamento');
        else if (userData.staffFunctions?.display) setActiveView('mostrador');
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
  const isOnlyDelivery = role === 'staff' && staff?.delivery && !staff?.cook && !staff?.attendant && !staff?.cashier && !staff?.display;
  const isOnlyDisplay = role === 'staff' && staff?.display && !staff?.cook && !staff?.attendant && !staff?.cashier && !staff?.delivery;

  if (isOnlyDelivery) {
    menuItems.push({ id: 'entrega_andamento', label: 'Entrega em Andamento', icon: Navigation });
    menuItems.push({ id: 'entrega_finalizada', label: 'Entregas Finalizadas', icon: CheckCircle });
  } else if (isOnlyDisplay) {
    menuItems.push({ id: 'mostrador', label: 'Mostrador', icon: Monitor });
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

    // Atendimento (suporte) visível para clientes e equipe administrativa para testes
    if (['client', 'developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'suporte_virtual', label: 'Atendimento (suporte)', icon: MessageCircle });
    }

    // Fila da cozinha (Cozinheiro, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.cook)) {
      menuItems.push({ id: 'cozinha', label: 'Fila Cozinha', icon: ChefHat });
    }

    // Mostrador
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.display)) {
      menuItems.push({ id: 'mostrador', label: 'Mostrador', icon: Monitor });
    }

    // Fila de atendimento (Atendente, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.attendant)) {
      menuItems.push({ id: 'atendimento', label: 'Balcão de Entrega', icon: Bell });
    }

    // Fila de caixa (Caixa, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.cashier)) {
      menuItems.push({ id: 'caixa', label: 'Fila Caixa', icon: CreditCard });
    }

    // Operações de Venda (PDV)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && (staff?.cashier || staff?.attendant))) {
      menuItems.push({ id: 'pdv_vendas', label: 'PDV Vendas', icon: ShoppingBag });
    }

    // Fila de entregas (Entregador, admin, owner, dev)
    if (role === 'developer' || role === 'owner' || role === 'manager' || (role === 'staff' && staff?.delivery)) {
      menuItems.push({ id: 'entrega_andamento', label: 'Entrega em Andamento', icon: Navigation });
      menuItems.push({ id: 'entrega_finalizada', label: 'Entregas Finalizadas', icon: CheckCircle });
      menuItems.push({ id: 'teste_mapa', label: 'Localização dos Entregadores', icon: Map });
    }

    // Painel Administrativo (admin, owner, dev)
    if (['developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'admin', label: 'Painel Admin', icon: FileText });
    }

    // Mapa de Mesas (admin, owner, dev)
    if (['developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'mapa_mesas', label: 'Mapa de Mesas', icon: Grid });
    }

    // Painel de Gestão de Usuários (admin, owner, dev)
    if (['developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'users', label: 'Usuários', icon: Users });
    }

    // Registros / Auditoria (admin, owner, dev)
    if (['developer', 'owner', 'manager'].includes(role)) {
      menuItems.push({ id: 'registros', label: 'Registros', icon: FileText });
    }

    // Controle de Estoque — visível a todos, menos clientes e entregadores
    if (role !== 'client' && !(role === 'staff' && staff?.delivery)) {
      menuItems.push({ id: 'estoque', label: 'Controle de Estoque', icon: Boxes });
    }

    // Painel de Atendimento (Suporte & I.A.) — visível a todos, menos clientes e entregadores
    if (role !== 'client' && !(role === 'staff' && staff?.delivery)) {
      menuItems.push({ id: 'painel_atendimento', label: 'Suporte & I.A.', icon: MessageCircle });
    }

    // Configurações — visível para todos os usuários logados
    if (user) {
      menuItems.push({ id: 'configuracoes', label: 'Configurações', icon: Settings });
    }
  }

  const menuGroups = [
    { label: 'Cardápio / Cliente', ids: ['menu', 'tracking', 'fidelidade', 'suporte_virtual'] },
    { label: 'Operações de Venda', ids: ['pdv_vendas'] },
    { label: 'Operações de Entrega', ids: ['entrega_andamento', 'entrega_finalizada', 'teste_mapa'] },
    { label: 'Painéis de Trabalho', ids: ['cozinha', 'mostrador', 'atendimento', 'caixa', 'mapa_mesas', 'estoque', 'painel_atendimento', 'admin'] },
    { label: 'Configurações', ids: ['users', 'registros', 'configuracoes'] },
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
        if (userData?.staffFunctions?.display) subroles.push('Mostrador');
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
          <div className="header-user-info-stack">
            <span className="welcome-msg">Olá, <strong>{user ? (user.displayName?.split(' ')[0] || user.email?.split('@')[0]) : 'Visitante'}</strong></span>
            {userData?.role && (
              <span className="role-badge">
                <ShieldCheck size={12} style={{ marginRight: '4px' }} />
                {getRoleLabel(userData.role)}
              </span>
            )}
          </div>
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
                          className={`nav-menu-item ${activeView === item.id ? 'active' : ''} ${item.id === 'cozinha' && pulseKitchenMenu ? 'pulse-kitchen-highlight' : ''}`}
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
            {activeView === 'menu' && <ClientDashboard showOnly="menu" isVisitor={isVisitor} onLoginRequired={() => setIsVisitor(false)} onNavigate={setActiveView} cart={cart} setCart={setCart} storeStatus={storeStatus} />}
            {activeView === 'tracking' && <OrderTracking />}
            {activeView === 'fidelidade' && <ClientDashboard showOnly="loyalty" isVisitor={isVisitor} onLoginRequired={() => setIsVisitor(false)} onNavigate={setActiveView} cart={cart} setCart={setCart} storeStatus={storeStatus} />}
            {activeView === 'cozinha' && <StaffDashboard filter="cook" />}
            {activeView === 'mostrador' && <OrderDisplayScreen />}
            {activeView === 'atendimento' && <StaffDashboard filter="attendant" />}
            {activeView === 'caixa' && <StaffDashboard filter="cashier" />}
            {activeView === 'entrega_andamento' && (
              ['developer', 'owner', 'manager'].includes(role) ? (
                <ManagerDeliveryActive />
              ) : (
                <DeliveryActive />
              )
            )}
            {activeView === 'entrega_finalizada' && <DeliveryHistory />}
            {activeView === 'admin' && <AdminDashboard />}
            {activeView === 'estoque' && <StockControl />}
            {activeView === 'painel_atendimento' && <SupportPanel />}
            {activeView === 'suporte_virtual' && (isStaff ? <SupportPanel /> : <ClientSupportChat />)}
            {activeView === 'users' && <UserManagement />}
            {activeView === 'registros' && <SystemLogs />}
            {activeView === 'configuracoes' && <SettingsPage />}
            {activeView === 'mapa_mesas' && <TableMap />}
            {activeView === 'teste_mapa' && <RiderLocationMonitor />}
            {activeView === 'pdv_vendas' && <PdvSales />}
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
      <VirtualAssistantBubble />
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
