import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ShoppingCart, MapPin, Plus, Minus, Trash2, Edit2, Check, X, Upload, Camera, QrCode, CreditCard } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { DeliveryMap } from '../../components/DeliveryMap';
import { GooglePayLogo } from '../../components/GooglePayLogo';
import type { MapAddress } from '../../components/DeliveryMap';
import { collection, addDoc, query, where, getDocs, doc, updateDoc, getDoc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodeAddress } from '../../utils/geocoding';
import type { OrderItem } from '../../types/order';
import pastelCrocante from '../../assets/pastel_crocante.png';
import pastelFrito from '../../assets/pastel_frito.png';
import pastelRefri from '../../assets/pastel_refri.png';
import pastelCombo from '../../assets/pastel_combo.png';
import { API_BASE_URL } from '../../config/api';

const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

interface SummaryMiniMapProps {
  address: MapAddress | null;
  onDistanceCalculated?: (meters: number) => void;
}

const SummaryMiniMap = ({ address, onDistanceCalculated }: SummaryMiniMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; dest?: L.Marker; poly?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  // Resolve as coordenadas do destino
  useEffect(() => {
    if (!address) return;
    if (address.lat !== undefined && address.lng !== undefined) {
      setDestCoords([address.lat, address.lng]);
      return;
    }
    geocodeAddress(address.street, address.number, address.neighborhood)
      .then(setDestCoords)
      .catch(() => setDestCoords(DONA_LU_COORDS));
  }, [address]);

  // Inicializa / atualiza o mapa
  useEffect(() => {
    if (!containerRef.current || !destCoords) return;

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        doubleClickZoom: false,
      }).setView(DONA_LU_COORDS, 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);

      mapRef.current = map;
    }

    const map = mapRef.current;

    // Remove camadas antigas
    if (markersRef.current.origin) map.removeLayer(markersRef.current.origin);
    if (markersRef.current.dest)   map.removeLayer(markersRef.current.dest);
    if (markersRef.current.poly)   map.removeLayer(markersRef.current.poly);

    const mkOrigin = L.divIcon({
      html: `<div style="font-size:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:translate(-2px,-4px)">🏠</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const mkDest = L.divIcon({
      html: `<div style="font-size:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:translate(-2px,-4px)">📍</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    markersRef.current.origin = L.marker(DONA_LU_COORDS, { icon: mkOrigin })
      .addTo(map).bindPopup('<b>Dona Lu Pastelaria</b>');
    markersRef.current.dest = L.marker(destCoords, { icon: mkDest })
      .addTo(map).bindPopup('<b>Destino de Entrega</b>');

    // Rota via OSRM
    const coordsStr = `${DONA_LU_COORDS[1]},${DONA_LU_COORDS[0]};${destCoords[1]},${destCoords[0]}`;
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(data => {
        let pts: [number, number][] = [DONA_LU_COORDS, destCoords];
        let distance = 0;
        if (data.routes?.length) {
          pts = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
          distance = data.routes[0].distance;
        } else {
          distance = L.latLng(DONA_LU_COORDS).distanceTo(L.latLng(destCoords));
        }
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, { color: '#e28743', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
        onDistanceCalculated?.(distance);
      })
      .catch(() => {
        const pts: [number, number][] = [DONA_LU_COORDS, destCoords];
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, { color: '#e28743', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
        const distance = L.latLng(DONA_LU_COORDS).distanceTo(L.latLng(destCoords));
        onDistanceCalculated?.(distance);
      });

    // Clique abre Google Maps com rota configurada + navegação
    map.off('click');
    map.on('click', () => {
      window.open(
        `https://www.google.com/maps/dir/?api=1&origin=${DONA_LU_COORDS[0]},${DONA_LU_COORDS[1]}&destination=${destCoords[0]},${destCoords[1]}&travelmode=driving`,
        '_blank'
      );
    });

    // Forçar atualização do tamanho do mapa após montagem
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
    };
  }, [destCoords]);

  // Destrói ao desmontar
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div
      title="Clique para abrir rota no Google Maps"
      style={{
        position: 'relative',
        width: '100%',
        height: '140px',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.07)',
        cursor: 'pointer',
        zIndex: 1,
        marginTop: '0.75rem'
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', bottom: 5, right: 5, zIndex: 999,
        background: 'rgba(10,7,7,0.85)', padding: '0.2rem 0.5rem',
        borderRadius: '12px', fontSize: '0.65rem',
        color: 'var(--primary-gold)', border: '1px solid rgba(245,158,11,0.3)',
        pointerEvents: 'none', fontWeight: 600,
      }}>
        Ver no Maps 🗺️
      </div>
    </div>
  );
};

interface ClientDashboardProps {
  showOnly?: 'menu' | 'loyalty';
  isVisitor?: boolean;
  onLoginRequired?: () => void;
  onNavigate?: (view: string) => void;
  cart?: OrderItem[];
  setCart?: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  storeStatus?: { status: 'open' | 'closing_soon' | 'closed'; label: string };
}

export const ClientDashboard = ({ 
  showOnly, 
  isVisitor = false, 
  onLoginRequired, 
  onNavigate,
  cart: externalCart,
  setCart: externalSetCart,
  storeStatus
}: ClientDashboardProps) => {
  const { user, userData, updatePhoneNumber } = useAuth();

  const defaultPastels = [
    { id: 1, name: 'Pastel de Carne com Queijo', price: 12.00, description: 'Carne moída temperada com queijo mussarela derretido.', image: pastelCrocante, category: 'Pastéis Salgados' },
    { id: 2, name: 'Pastel de Frango Catupiry', price: 11.50, description: 'Peito de frango desfiado com o autêntico Catupiry.', image: pastelFrito, category: 'Pastéis Salgados' },
    { id: 3, name: 'Pastel de Vento Especial', price: 6.00, description: 'Aquele clássico dourado e crocante de feira.', image: pastelRefri, category: 'Pastéis Salgados' },
    { id: 4, name: 'Pastel Doce de Nutella com Morango', price: 14.00, description: 'Sobremesa perfeita recheada com Nutella e morangos frescos.', image: pastelCombo, category: 'Pastéis Doces' },
  ];

  // Estados
  const [pastels, setPastels] = useState<any[]>(defaultPastels);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrice, setEditPrice] = useState(0);
  const [editImage, setEditImage] = useState('');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [isNewItem, setIsNewItem] = useState<number | null>(null);

  const role = userData?.role || 'client';
  const canEdit = ['developer', 'owner', 'manager'].includes(role);
  const isStoreClosed = storeStatus?.status === 'closed';
  const isClosedForUser = isStoreClosed && !canEdit;

  const [localCart, setLocalCart] = useState<OrderItem[]>([]);
  const cart = externalCart !== undefined ? externalCart : localCart;
  const setCart = externalSetCart !== undefined ? externalSetCart : setLocalCart;
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState<MapAddress | null>(null);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [orderType, setOrderType] = useState<'pickup' | 'delivery' | 'dine_in' | 'dine_in_table'>(() => {
    const params = new URLSearchParams(window.location.search);
    const hasTable = params.has('mesa') || params.has('table');
    return hasTable ? 'dine_in_table' : 'delivery';
  });
  const [tableNumber, setTableNumber] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credito' | 'debito' | 'dinheiro' | 'pagar_final' | 'google_pay' | 'debito_point' | 'credito_point'>('pix');
  const [changeFor, setChangeFor] = useState('');
  const [noChangeNeeded, setNoChangeNeeded] = useState(false);
  const [showOrderSummary, setShowOrderSummary] = useState(false);
  const [categories, setCategories] = useState<string[]>(['Pastéis Gourmet Especiais', 'Bebidas']);
  const [activeCategory, setActiveCategory] = useState<string>('Pastéis Gourmet Especiais');
  const [waiveServiceFee, setWaiveServiceFee] = useState(false);

  // States para scanner da mesa
  const [showTableScannerModal, setShowTableScannerModal] = useState(false);
  const [manualTableInput, setManualTableInput] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [activeTablesCount, setActiveTablesCount] = useState<number>(10);

  // PagBank Credit Card Form States
  const [useSavedCard, setUseSavedCard] = useState(true);
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState(''); // MM/AA
  const [cardCvv, setCardCvv] = useState('');
  const [clientCpf, setClientCpf] = useState(userData?.cpf || '');
  const [saveCardConsent, setSaveCardConsent] = useState(false);

  // Mercado Pago Pix states
  const [storeConfig, setStoreConfig] = useState<any>(null);
  const [showPixLightbox, setShowPixLightbox] = useState(false);
  const [pixQrCode, setPixQrCode] = useState('');
  const [pixQrCodeBase64, setPixQrCodeBase64] = useState('');
  const [pixPaymentId, setPixPaymentId] = useState('');
  const [pixPaymentStatus, setPixPaymentStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // States para Maquininha Point
  const [showPointLightbox, setShowPointLightbox] = useState(false);
  const [pointPaymentId, setPointPaymentId] = useState('');
  const [pointPaymentStatus, setPointPaymentStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [pointDeviceLabel, setPointDeviceLabel] = useState('');
  const [showPointDeviceSelector, setShowPointDeviceSelector] = useState(false);
  const [pointAmount, setPointAmount] = useState(0);
  const [pointType, setPointType] = useState<'debito' | 'credito'>('debito');
  const [pointActionCallback, setPointActionCallback] = useState<'place_order' | 'close_bill'>('place_order');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // States for closing table bill
  const [showCloseBillModal, setShowCloseBillModal] = useState(false);
  const [tableOrders, setTableOrders] = useState<any[]>([]);
  const [loadingBill, setLoadingBill] = useState(false);
  const [billPaymentMethod, setBillPaymentMethod] = useState<'pix' | 'credito' | 'dinheiro' | 'debito' | 'google_pay' | 'debito_point' | 'credito_point'>('pix');
  const [billChangeFor, setBillChangeFor] = useState('');
  const [billNoChangeNeeded, setBillNoChangeNeeded] = useState(false);
  const [billSubmitting, setBillSubmitting] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);
  
  const [showBillPixLightbox, setShowBillPixLightbox] = useState(false);
  const [billPixQrCode, setBillPixQrCode] = useState('');
  const [billPixQrCodeBase64, setBillPixQrCodeBase64] = useState('');
  const [billPixPaymentId, setBillPixPaymentId] = useState<number | null>(null);
  const [billPixPaymentStatus, setBillPixPaymentStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');

  useEffect(() => {
    const fetchStoreConfig = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'settings', 'store_config'));
        if (docSnap.exists()) {
          setStoreConfig(docSnap.data());
        }
      } catch (err) {
        console.error('Erro ao buscar store_config:', err);
      }
    };
    fetchStoreConfig();
  }, []);

  // Verifica status do pagamento Pix do fechamento de conta periodicamente
  useEffect(() => {
    if (!billPixPaymentId || billPixPaymentStatus !== 'pending') return;

    let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
    if (token === 'null' || token === 'undefined' || !token) {
      token = 'mock';
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/pagamentos/check-pix?paymentId=${billPixPaymentId}&token=${token}`);
        const result = await res.json();
        if (result.status === 'approved') {
          setBillPixPaymentStatus('approved');
          clearInterval(interval);

          const unpaid = tableOrders.filter(o => 
            o.paymentMethod === 'pagar_final' || 
            o.paymentMethod === 'dinheiro' || 
            o.paymentMethod === 'debito'
          );
          
          const batchPromises = unpaid.map(order => 
            updateDoc(doc(db, 'orders', order.id), {
              status: 'completed',
              updatedAt: new Date().toISOString()
            })
          );
          await Promise.all(batchPromises);

          if (user) {
            const userDocRef = doc(db, 'users', user.uid);
            await updateDoc(userDocRef, {
              tableNumber: null,
              updatedAt: new Date().toISOString()
            });
          }

          alert("Conta fechada e paga com sucesso!");
          setShowBillPixLightbox(false);
          setShowCloseBillModal(false);
        } else if (result.status === 'rejected') {
          setBillPixPaymentStatus('rejected');
          clearInterval(interval);
          alert("O pagamento via Pix foi recusado.");
        }
      } catch (err) {
        console.error("Erro ao verificar Pix de fechamento:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [billPixPaymentId, billPixPaymentStatus, tableOrders, tableNumber, storeConfig]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'tables_config'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.activeTablesCount === 'number') {
          setActiveTablesCount(data.activeTablesCount);
        }
      }
    });
    return () => unsub();
  }, []);

  // Efeito para carregar o SDK do Google Pay
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://pay.google.com/gp/p/js/pay.js';
    script.async = true;
    script.onload = () => {
      console.log("SDK do Google Pay carregado com sucesso!");
    };
    script.onerror = (e) => {
      console.error("Falha ao carregar SDK do Google Pay:", e);
    };
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const handleLinkTable = async (tableNumStr: string) => {
    if (!user) {
      alert("Por favor, faça login antes de vincular uma mesa.");
      return;
    }
    
    const tableNum = parseInt(tableNumStr, 10);
    if (isNaN(tableNum) || tableNum < 1 || tableNum > activeTablesCount) {
      alert(`A Mesa ${tableNumStr} não está em serviço no momento. Por favor, selecione ou escaneie uma mesa válida (1 a ${activeTablesCount}).`);
      return;
    }

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        tableNumber: tableNumStr,
        updatedAt: new Date().toISOString()
      });
      setTableNumber(tableNumStr);
      setOrderType('dine_in_table');
      sessionStorage.setItem('donalu_mesa', tableNumStr);

      // Sincronizar pedidos ativos locais para a nova mesa
      const q = query(
        collection(db, 'orders'),
        where('clientUid', '==', user.uid),
        where('status', 'in', ['pending', 'preparing', 'ready', 'delivering'])
      );
      const querySnapshot = await getDocs(q);
      const updatePromises = querySnapshot.docs.map(orderDoc => {
        const o = orderDoc.data();
        if (o.orderType === 'dine_in' || o.orderType === 'dine_in_table') {
          return updateDoc(doc(db, 'orders', orderDoc.id), {
            tableNumber: tableNumStr,
            orderType: 'dine_in_table',
            updatedAt: new Date().toISOString()
          });
        }
        return Promise.resolve();
      });
      await Promise.all(updatePromises);

      alert(`Mesa ${tableNumStr} vinculada com sucesso!`);
    } catch (err) {
      console.error("Erro ao vincular mesa:", err);
      alert("Não foi possível vincular a mesa. Tente novamente.");
    }
  };

  useEffect(() => {
    let html5QrCode: any = null;
    if (showTableScannerModal) {
      setScannerError(null);
      const startScanner = async () => {
        try {
          html5QrCode = new Html5Qrcode("qr-reader");
          await html5QrCode.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: { width: 220, height: 220 }
            },
            async (decodedText: string) => {
              try {
                const url = new URL(decodedText);
                const mesaParam = url.searchParams.get('mesa');
                if (mesaParam) {
                  await handleLinkTable(mesaParam);
                  await html5QrCode.stop();
                  setShowTableScannerModal(false);
                } else {
                  const match = decodedText.match(/\d+/);
                  if (match) {
                    await handleLinkTable(match[0]);
                    await html5QrCode.stop();
                    setShowTableScannerModal(false);
                  } else {
                    setScannerError("QR Code lido, mas não contém uma mesa válida.");
                  }
                }
              } catch (e) {
                const match = decodedText.trim();
                if (/^\d+$/.test(match)) {
                  await handleLinkTable(match);
                  await html5QrCode.stop();
                  setShowTableScannerModal(false);
                } else {
                  setScannerError("QR Code inválido. Deve ser o link da mesa ou o número.");
                }
              }
            },
            () => {}
          );
        } catch (err: any) {
          console.error("Erro ao iniciar câmera para QR Code:", err);
          setScannerError("Não foi possível acessar a câmera. Use o campo abaixo para digitar a mesa.");
        }
      };
      
      startScanner();
    }
    
    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch((err: any) => console.error("Erro ao parar scanner:", err));
      }
    };
  }, [showTableScannerModal]);

  const handleOpenCloseBillModal = async () => {
    if (!tableNumber) {
      alert("Mesa não identificada.");
      return;
    }
    setLoadingBill(true);
    setBillError(null);
    setShowCloseBillModal(true);

    try {
      if (!user) return;
      const q = query(
        collection(db, 'orders'),
        where('clientUid', '==', user.uid),
        where('orderType', '==', 'dine_in_table')
      );
      const querySnapshot = await getDocs(q);
      const fetchedOrders: any[] = [];
      querySnapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status !== 'completed' && d.status !== 'cancelled' && d.tableNumber === tableNumber) {
          fetchedOrders.push({ id: docSnap.id, ...d });
        }
      });
      setTableOrders(fetchedOrders);
    } catch (err: any) {
      console.error("Erro ao carregar conta da mesa:", err);
      setBillError("Não foi possível carregar os pedidos da mesa.");
    } finally {
      setLoadingBill(false);
    }
  };

  const handleCloseBillPix = async () => {
    setBillError(null);
    setBillSubmitting(true);

    try {
      const unpaid = tableOrders.filter(o => 
        o.paymentMethod === 'pagar_final' || 
        o.paymentMethod === 'dinheiro' || 
        o.paymentMethod === 'debito'
      );
      const amountToPay = unpaid.reduce((sum, o) => sum + o.total, 0);

      let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
      if (token === 'null' || token === 'undefined' || !token) {
        token = 'mock';
      }

      const response = await fetch(`${API_BASE_URL}/api/pagamentos/create-pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          amount: amountToPay,
          email: user?.email || 'cliente@email.com',
          name: user?.displayName || user?.email || 'Cliente',
          cpf: userData?.cpf || '45678912364'
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Erro ao gerar Pix no Mercado Pago.');
      }

      setBillPixPaymentId(result.paymentId);
      setBillPixQrCode(result.qrCode);
      setBillPixQrCodeBase64(result.qrCodeBase64);
      setBillPixPaymentStatus('pending');
      setShowBillPixLightbox(true);
    } catch (err: any) {
      console.error(err);
      setBillError(err.message || "Erro ao gerar Pix. Tente novamente.");
    } finally {
      setBillSubmitting(false);
    }
  };

  const handleCloseBillCreditCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setBillError(null);
    setBillSubmitting(true);

    try {
      const unpaid = tableOrders.filter(o => 
        o.paymentMethod === 'pagar_final' || 
        o.paymentMethod === 'dinheiro' || 
        o.paymentMethod === 'debito'
      );
      const amountToPay = unpaid.reduce((sum, o) => sum + o.total, 0);

      const isUsingSavedCard = useSavedCard && !!userData?.pagbank_card_token;
      let encryptedCardToken = '';

      if (!isUsingSavedCard) {
        if (!(window as any).PagSeguro) {
          throw new Error('O SDK do PagBank não pôde ser carregado. Por favor, recarregue a página.');
        }

        if (!cardNumber || !cardHolder || !cardExpiry || !cardCvv || !clientCpf) {
          throw new Error('Por favor, preencha todos os campos do cartão e o CPF.');
        }

        const cleanedExpiry = cardExpiry.replace(/\s+/g, '').replace('/', '');
        const expMonth = cleanedExpiry.slice(0, 2);
        const expYear = '20' + cleanedExpiry.slice(2, 4);

        const card = (window as any).PagSeguro.encryptCard({
          publicKey: "MC0yM2UzNDFjNy04ZDNmLTQyZTUtYmJjYy05YjA3YTEyODNhM2U=",
          holder: cardHolder,
          number: cardNumber.replace(/\s+/g, ''),
          expMonth: expMonth,
          expYear: expYear,
          cvv: cardCvv
        });

        if (card.hasErrors) {
          console.error(card.errors);
          throw new Error('Dados do cartão inválidos. Verifique os campos informados.');
        }

        encryptedCardToken = card.encryptedCard;
      }

      const response = await fetch(`${API_BASE_URL}/api/pagamentos/process-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedCard: isUsingSavedCard ? undefined : encryptedCardToken,
          cpf: isUsingSavedCard ? undefined : clientCpf.replace(/\D/g, ''),
          saveCard: isUsingSavedCard ? false : saveCardConsent,
          orderTotal: amountToPay,
          clientName: user?.displayName || user?.email || 'Cliente',
          clientEmail: user?.email || '',
          useSavedCard: isUsingSavedCard,
          savedCustomerId: userData?.pagbank_customer_id || undefined,
          savedCardToken: userData?.pagbank_card_token || undefined
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Falha no pagamento do PagBank.');
      }

      if (!isUsingSavedCard && saveCardConsent && result.card) {
        const userDocRef = doc(db, 'users', user!.uid);
        await updateDoc(userDocRef, {
          cpf: clientCpf.replace(/\D/g, ''),
          pagbank_customer_id: result.card.customer_id,
          pagbank_card_token: result.card.card_token,
          pagbank_card_brand: result.card.brand,
          pagbank_card_last_digits: result.card.last_digits,
          updatedAt: new Date().toISOString()
        });
      }

      const batchPromises = unpaid.map(order => 
        updateDoc(doc(db, 'orders', order.id), {
          status: 'completed',
          updatedAt: new Date().toISOString()
        })
      );
      await Promise.all(batchPromises);

      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          tableNumber: null,
          updatedAt: new Date().toISOString()
        });
      }

      alert("Conta fechada e paga com sucesso via cartão de crédito!");
      setShowCloseBillModal(false);
    } catch (err: any) {
      console.error(err);
      setBillError(err.message || "Erro ao processar o pagamento. Tente novamente.");
    } finally {
      setBillSubmitting(false);
    }
  };

  const handleCloseBillGooglePay = async () => {
    if (!(window as any).google || !(window as any).google.payments) {
      alert('O SDK do Google Pay não está carregado. Por favor, recarregue a página.');
      return;
    }
    
    setBillError(null);
    setBillSubmitting(true);

    try {
      const unpaid = tableOrders.filter(o => 
        o.paymentMethod === 'pagar_final' || 
        o.paymentMethod === 'dinheiro' || 
        o.paymentMethod === 'debito'
      );
      const amountToPay = unpaid.reduce((sum, o) => sum + o.total, 0);

      const paymentsClient = new (window as any).google.payments.api.PaymentsClient({
        environment: 'TEST'
      });

      const isProduction = false;

      const paymentDataRequest = {
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [{
          type: 'CARD',
          parameters: {
            allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
            allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX"]
          },
          tokenizationSpecification: {
            type: 'PAYMENT_GATEWAY',
            parameters: {
              gateway: 'example',
              gatewayMerchantId: 'exampleGatewayMerchantId'
            }
          }
        }],
        transactionInfo: {
          totalPriceStatus: 'FINAL',
          totalPrice: amountToPay.toFixed(2),
          currencyCode: 'BRL',
          countryCode: 'BR'
        },
        merchantInfo: {
          merchantName: 'Dona Lu Pastelaria',
          ...(isProduction ? { merchantId: import.meta.env.VITE_GOOGLE_PAY_MERCHANT_ID || 'BCR2DN5TW6HJ3ZQL' } : {})
        }
      };

      const paymentData = await paymentsClient.loadPaymentData(paymentDataRequest);
      console.log("Token Google Pay para Fechamento recebido:", paymentData.paymentMethodData.tokenizationData.token);

      const batchPromises = unpaid.map(order => 
        updateDoc(doc(db, 'orders', order.id), {
          status: 'completed',
          updatedAt: new Date().toISOString()
        })
      );
      await Promise.all(batchPromises);

      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          tableNumber: null,
          updatedAt: new Date().toISOString()
        });
      }

      alert("Conta fechada e paga com sucesso via Google Pay!");
      setShowCloseBillModal(false);
    } catch (err: any) {
      if (err.statusCode === 'CANCELED') {
        return;
      }
      console.error("Erro no Google Pay:", err);
      setBillError(err.message || "Erro ao processar o pagamento com Google Pay.");
    } finally {
      setBillSubmitting(false);
    }
  };

  const handleCloseBillCashier = async () => {
    setBillError(null);
    setBillSubmitting(true);

    try {
      const unpaid = tableOrders.filter(o => 
        o.paymentMethod === 'pagar_final' || 
        o.paymentMethod === 'dinheiro' || 
        o.paymentMethod === 'debito'
      );

      const batchPromises = unpaid.map(order => 
        updateDoc(doc(db, 'orders', order.id), {
          status: 'aguardando_caixa',
          paymentMethod: billPaymentMethod,
          changeFor: billPaymentMethod === 'dinheiro' && billChangeFor ? parseFloat(billChangeFor.replace(',', '.')) : null,
          updatedAt: new Date().toISOString()
        })
      );
      await Promise.all(batchPromises);

      alert(`Solicitação de fechamento enviada ao Caixa! Por favor, dirija-se ao balcão para pagar em ${billPaymentMethod === 'dinheiro' ? 'Dinheiro' : 'Débito'}.`);
      setShowCloseBillModal(false);
    } catch (err: any) {
      console.error(err);
      setBillError(err.message || "Erro ao enviar solicitação ao Caixa.");
    } finally {
      setBillSubmitting(false);
    }
  };

  const checkReservationAndSetTable = async (tableId: string) => {
    try {
      const resSnap = await getDoc(doc(db, 'reservations', tableId));
      if (resSnap.exists()) {
        const resData = resSnap.data();
        if (resData.reserved) {
          // Se a reserva for para o cliente atual logado, permite o vínculo
          if (user && resData.clientUid === user.uid) {
            setTableNumber(tableId);
            sessionStorage.setItem('donalu_mesa', tableId);
            setOrderType('dine_in_table');
            
            const userDocRef = doc(db, 'users', user.uid);
            await updateDoc(userDocRef, {
              tableNumber: tableId,
              updatedAt: new Date().toISOString()
            });
            return true;
          } else {
            // Caso contrário, bloqueia e limpa a mesa local e no banco
            alert(`Esta mesa está reservada ${resData.clientName ? `para ${resData.clientName}` : ''} e não pode ser ocupada.`);
            setTableNumber(null);
            sessionStorage.removeItem('donalu_mesa');
            setOrderType('pickup');
            
            if (user) {
              const userDocRef = doc(db, 'users', user.uid);
              await updateDoc(userDocRef, {
                tableNumber: null,
                updatedAt: new Date().toISOString()
              });
            }
            return false;
          }
        }
      }

      // Se não houver reserva, vincula normalmente
      setTableNumber(tableId);
      sessionStorage.setItem('donalu_mesa', tableId);
      setOrderType('dine_in_table');

      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          tableNumber: tableId,
          updatedAt: new Date().toISOString()
        });
      }
      return true;
    } catch (err) {
      console.error("Erro ao verificar reserva da mesa:", err);
      return false;
    }
  };

  // 1. Sincroniza a mesa identificada localmente com a conta do usuário
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mesa = params.get('mesa') || params.get('table');

    if (mesa) {
      checkReservationAndSetTable(mesa);
    } else {
      const savedMesa = sessionStorage.getItem('donalu_mesa');
      if (savedMesa) {
        checkReservationAndSetTable(savedMesa);
      }
    }
  }, [user]);

  // 2. Sincroniza em tempo real as mudanças de mesa de outros dispositivos pela conta do usuário
  useEffect(() => {
    if (userData) {
      if (userData.tableNumber) {
        setTableNumber(userData.tableNumber);
        setOrderType('dine_in_table');
        sessionStorage.setItem('donalu_mesa', userData.tableNumber);
      } else {
        setTableNumber(null);
        sessionStorage.removeItem('donalu_mesa');
        if (orderType === 'dine_in_table') {
          setOrderType('delivery');
        }
      }
    }
  }, [userData]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'menu_categories'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.list && Array.isArray(data.list)) {
          setCategories(data.list);
          if (data.list.length > 0 && !data.list.includes(activeCategory)) {
            setActiveCategory(data.list[0]);
          }
        }
      } else {
        setDoc(doc(db, 'settings', 'menu_categories'), { list: ['Pastéis Gourmet Especiais', 'Bebidas'] })
          .catch(e => console.error("Erro ao criar menu_categories:", e));
      }
    });
    return () => unsub();
  }, [activeCategory]);

  useEffect(() => {
    const q = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty) {
        console.log("Cardápio no Firestore está vazio. Semeando dados padrão...");
        for (const item of defaultPastels) {
          const docId = item.id.toString();
          try {
            await setDoc(doc(db, 'products', docId), {
              id: item.id,
              name: item.name,
              price: item.price,
              description: item.description,
              image: item.image || '',
              category: 'Pastéis Gourmet Especiais'
            });
          } catch (err) {
            console.error("Erro ao semear produto:", item.name, err);
          }
        }
        const defaultDrinks = [
          { id: 101, name: 'Coca-Cola Lata 350ml', price: 5.50, description: 'Refrigerante Coca-Cola original lata.' },
          { id: 102, name: 'Guaraná Antarctica 350ml', price: 5.00, description: 'Refrigerante Guaraná Antarctica lata.' },
          { id: 103, name: 'Água Mineral 500ml', price: 3.50, description: 'Água mineral sem gás.' }
        ];
        for (const item of defaultDrinks) {
          const docId = item.id.toString();
          try {
            await setDoc(doc(db, 'products', docId), {
              id: item.id,
              name: item.name,
              price: item.price,
              description: item.description,
              image: '',
              category: 'Bebidas'
            });
          } catch (err) {
            console.error("Erro ao semear bebida:", item.name, err);
          }
        }
      } else {
        const itemsList: any[] = [];
        snapshot.forEach((docSnap) => {
          itemsList.push(docSnap.data());
        });
        itemsList.sort((a, b) => b.id - a.id);

        if (isNewItem !== null) {
          const alreadyInList = itemsList.some(item => item.id === isNewItem);
          if (!alreadyInList) {
            const tempNewItem = {
              id: isNewItem,
              name: editName,
              price: editPrice,
              description: editDescription,
              image: editImage,
              category: activeCategory
            };
            setPastels([tempNewItem, ...itemsList]);
            return;
          }
        }

        setPastels(itemsList);
      }
    });

    return () => unsubscribe();
  }, [isNewItem, editName, editPrice, editDescription, editImage, activeCategory]);

  useEffect(() => {
    if (userData?.cpf) {
      setClientCpf(userData.cpf);
    }
  }, [userData]);

  useEffect(() => {
    setWaiveServiceFee(false);
  }, [orderType]);

  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
  const [promptPhone, setPromptPhone] = useState('');
  const [promptPhoneError, setPromptPhoneError] = useState<string | null>(null);

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (digits.length <= 10) {
      return digits.replace(/^(\d{2})(\d{4})(\d{0,4})$/, (_, p1, p2, p3) => {
        return `(${p1}) ${p2}${p3 ? '-' + p3 : ''}`;
      });
    } else {
      return digits.slice(0, 11).replace(/^(\d{2})(\d{5})(\d{0,4})$/, (_, p1, p2, p3) => {
        return `(${p1}) ${p2}${p3 ? '-' + p3 : ''}`;
      });
    }
  };




  // Manipuladores de Edição
  const startEdit = (pastel: typeof defaultPastels[0]) => {
    setEditingId(pastel.id);
    setEditName(pastel.name);
    setEditDescription(pastel.description);
    setEditPrice(pastel.price);
    setEditImage(pastel.image || '');
  };

  const saveEdit = async () => {
    if (!editName.trim()) {
      alert("O nome do item não pode ser vazio.");
      return;
    }
    try {
      const docId = editingId!.toString();
      const existingItem = pastels.find((p: any) => p.id === editingId);
      const category = existingItem?.category || activeCategory;

      await setDoc(doc(db, 'products', docId), {
        id: editingId,
        name: editName,
        description: editDescription,
        price: editPrice,
        image: editImage,
        category: category
      });
      setEditingId(null);
      if (editingId === isNewItem) {
        setIsNewItem(null);
      }
    } catch (err) {
      console.error("Erro ao salvar item no Firestore:", err);
      alert("Erro ao salvar o item no cardápio. Verifique suas permissões.");
    }
  };

  const cancelEdit = () => {
    if (isNewItem === editingId) {
      setPastels(pastels.filter((p: any) => p.id !== isNewItem));
      setIsNewItem(null);
    }
    setEditingId(null);
  };

  const handleDeleteItem = async (id: number) => {
    if (window.confirm("Tem certeza de que deseja excluir este item do cardápio?")) {
      try {
        await deleteDoc(doc(db, 'products', id.toString()));
      } catch (err) {
        console.error("Erro ao excluir item do Firestore:", err);
        alert("Erro ao excluir o item do cardápio. Verifique suas permissões.");
      }
    }
  };

  const handleAddNewItem = () => {
    if (editingId !== null) {
      alert("Por favor, salve ou cancele a edição atual antes de criar um novo item.");
      return;
    }
    const newId = Date.now();
    const newPastel = {
      id: newId,
      name: '',
      price: 0,
      description: '',
      image: '',
      category: activeCategory
    };
    setPastels([newPastel, ...pastels]);
    setEditingId(newId);
    setEditName('');
    setEditDescription('');
    setEditPrice(0);
    setEditImage('');
    setIsNewItem(newId);
  };

  const handleCreateNewCategory = async () => {
    const name = prompt("Digite o nome da nova categoria de menu:");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    if (categories.some(c => c.toLowerCase() === cleanName.toLowerCase())) {
      alert("Esta categoria já existe!");
      return;
    }
    const newList = [...categories, cleanName];
    try {
      await setDoc(doc(db, 'settings', 'menu_categories'), { list: newList });
      setActiveCategory(cleanName);
    } catch (err) {
      console.error("Erro ao criar nova categoria:", err);
      alert("Erro ao criar nova categoria no servidor.");
    }
  };

  const handleRenameCategory = async (oldCategoryName: string) => {
    const newName = prompt(`Digite o novo nome para a categoria "${oldCategoryName}":`, oldCategoryName);
    if (!newName || !newName.trim()) return;
    const cleanNewName = newName.trim();
    if (cleanNewName === oldCategoryName) return;

    if (categories.some(c => c.toLowerCase() === cleanNewName.toLowerCase())) {
      alert("Esta categoria já existe!");
      return;
    }

    if (!window.confirm(`Você tem certeza de que deseja renomear a categoria "${oldCategoryName}" para "${cleanNewName}"?`)) {
      return;
    }

    try {
      const updatedList = categories.map(c => c === oldCategoryName ? cleanNewName : c);
      await setDoc(doc(db, 'settings', 'menu_categories'), { list: updatedList });

      const q = query(collection(db, 'products'), where('category', '==', oldCategoryName));
      const querySnapshot = await getDocs(q);
      const updatePromises = querySnapshot.docs.map(docSnap => 
        updateDoc(doc(db, 'products', docSnap.id), { category: cleanNewName })
      );
      await Promise.all(updatePromises);

      setActiveCategory(cleanNewName);
      alert("Categoria renomeada com sucesso!");
    } catch (err) {
      console.error("Erro ao renomear categoria:", err);
      alert("Erro ao renomear a categoria. Verifique suas permissões.");
    }
  };

  const handleDeleteCategory = async (categoryToDelete: string) => {
    if (categories.length <= 1) {
      alert("Você deve ter pelo menos uma categoria no cardápio!");
      return;
    }

    const confirmMessage = `Tem certeza de que deseja excluir a categoria "${categoryToDelete}"?\n\n` +
      `ATENÇÃO: Todos os produtos/itens cadastrados nesta categoria serão excluídos permanentemente!`;
      
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const updatedList = categories.filter(c => c !== categoryToDelete);
      await setDoc(doc(db, 'settings', 'menu_categories'), { list: updatedList });

      const q = query(collection(db, 'products'), where('category', '==', categoryToDelete));
      const querySnapshot = await getDocs(q);
      const deletePromises = querySnapshot.docs.map(docSnap => 
        deleteDoc(doc(db, 'products', docSnap.id))
      );
      await Promise.all(deletePromises);

      setActiveCategory(updatedList[0]);
      alert("Categoria e seus itens foram excluídos com sucesso!");
    } catch (err) {
      console.error("Erro ao excluir categoria:", err);
      alert("Erro ao excluir a categoria. Verifique suas permissões.");
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleChangeTable = async () => {
    const input = window.prompt("Para qual mesa você mudou? (Digite o número da nova mesa de 1 a 99)");
    if (input === null) return;
    const cleaned = input.trim();
    const num = parseInt(cleaned);
    if (!isNaN(num) && num >= 1 && num <= 99) {
      const allowed = await checkReservationAndSetTable(cleaned);
      if (allowed) {
        window.alert("Ok, sua mesa foi atualizada com sucesso!");
      }
    } else {
      window.alert("Por favor, digite um número de mesa válido (1 a 99).");
    }
  };

  const handleClearTable = async () => {
    if (window.confirm("Deseja realmente desvincular seu celular desta mesa?")) {
      setTableNumber(null);
      sessionStorage.removeItem('donalu_mesa');
      setOrderType('pickup');

      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          await updateDoc(userDocRef, {
            tableNumber: null,
            updatedAt: new Date().toISOString()
          });
        } catch (err) {
          console.error("Erro ao limpar mesa no banco:", err);
        }
      }
    }
  };

  const addToCart = (item: typeof defaultPastels[0]) => {
    if (isVisitor) {
      if (onLoginRequired) {
        alert('Para adicionar itens ao carrinho e realizar compras, você precisa estar logado. Redirecionando para a tela de login...');
        onLoginRequired();
      }
      return;
    }
    if (isClosedForUser) {
      alert('A pastelaria está fechada no momento e não está recebendo pedidos.');
      return;
    }

    setCart((prevCart) => {
      const existing = prevCart.find((i) => i.id === item.id);
      if (existing) {
        return prevCart.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prevCart, { 
        id: item.id, 
        name: item.name, 
        price: item.price, 
        quantity: 1,
        category: item.category || 'Pastéis Salgados',
        withCatupiry: false,
        withBorda: false,
        ingredients: []
      }];
    });
  };

  const removeFromCart = (id: number) => {
    setCart((prevCart) => prevCart.filter((i) => i.id !== id));
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart((prevCart) =>
      prevCart
        .map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const toggleCartItemCustom = (idx: number, field: 'withCatupiry' | 'withBorda') => {
    setCart((prevCart) => prevCart.map((item, i) => i === idx ? {
      ...item,
      [field]: !item[field]
    } : item));
  };

  const toggleCartItemIngredient = (idx: number, ing: string) => {
    setCart((prevCart) => prevCart.map((item, i) => {
      if (i !== idx) return item;
      const currentIngredients = item.ingredients || [];
      let newIngs = [...currentIngredients];
      if (newIngs.includes(ing)) {
        newIngs = newIngs.filter(x => x !== ing);
      } else if (newIngs.length < 5) {
        newIngs.push(ing);
      }
      return { ...item, ingredients: newIngs };
    }));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${Math.round(meters)} metros`;
    }
    const km = meters / 1000;
    return `${km.toFixed(1).replace('.', ',')} km`;
  };

  const deliveryFee = (orderType === 'delivery' && routeDistance !== null)
    ? (routeDistance / 1000 <= 3 ? 5.00 : 5.00 + Math.floor(routeDistance / 1000 - 3.0) * 1.00)
    : 0;

  const serviceFee = (orderType === 'dine_in_table' && !waiveServiceFee)
    ? parseFloat((cartTotal * 0.10).toFixed(2))
    : 0;

  const finalTotal = cartTotal + deliveryFee + serviceFee;

  const paymentLabels: Record<string, string> = {
    pix: 'Pix',
    credito: 'Cartão de Crédito',
    google_pay: 'Google Pay',
    debito: 'Cartão de Débito',
    dinheiro: 'Dinheiro',
    pagar_final: 'Pagar no Final (na Mesa) 🍽️',
  };

  const handleOpenSummary = () => {
    setError(null);
    if (cart.length === 0) { setError('O seu carrinho está vazio.'); return; }
    if (orderType === 'delivery' && (!deliveryAddress || !deliveryAddress.street)) {
      setError('Selecione o endereço de entrega no mapa antes de continuar.');
      return;
    }
    if (!paymentMethod) { setError('Selecione a forma de pagamento.'); return; }
    if (paymentMethod === 'dinheiro' && !noChangeNeeded && !changeFor.trim()) {
      setError('Por favor, informe para quanto precisa de troco ou marque "Não preciso de troco".');
      return;
    }
    
    // Exige cadastro de número de celular se o cliente não tiver um cadastrado
    if (!isVisitor && user && !userData?.phoneNumber) {
      setPromptPhone('');
      setPromptPhoneError(null);
      setShowPhonePrompt(true);
      return;
    }

    setShowOrderSummary(true);
  };

  const handleSavePromptPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromptPhoneError(null);
    const cleanPhone = promptPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setPromptPhoneError('Por favor, informe um número de celular válido com DDD.');
      return;
    }
    try {
      if (updatePhoneNumber) {
        await updatePhoneNumber(promptPhone);
      }
      setShowPhonePrompt(false);
      setShowOrderSummary(true);
    } catch (err) {
      console.error(err);
      setPromptPhoneError('Erro ao salvar número de celular. Tente novamente.');
    }
  };

  const completeCheckoutAfterPointPayment = async (deviceId: string, label: string) => {
    const now = new Date();
    const businessStart = new Date(now);
    if (now.getHours() < 6) {
      businessStart.setDate(now.getDate() - 1);
    }
    businessStart.setHours(6, 0, 0, 0);

    let dailySeq = 1;
    try {
      const qDaily = query(
        collection(db, 'orders'),
        where('createdAt', '>=', businessStart.toISOString())
      );
      const dailySnap = await getDocs(qDaily);
      dailySeq = dailySnap.size + 1;
    } catch (err) {
      dailySeq = Math.floor(Math.random() * 900) + 100;
    }

    const orderData: any = {
      clientUid: user?.uid || '',
      clientName: user?.displayName || user?.email || 'Cliente Anônimo',
      clientPhone: userData?.phoneNumber || '',
      items: cart.map(item => {
        let customSuffix = '';
        const details: string[] = [];
        if (item.category === 'Pastéis Salgados') {
          if (item.withCatupiry) details.push('Catupiry');
          if (item.withBorda) details.push('Borda de Queijo');
          if (item.ingredients && item.ingredients.length > 0) {
            details.push(`Adicionais: ${item.ingredients.join(', ')}`);
          }
        }
        if (details.length > 0) {
          customSuffix = ` (${details.join(' + ')})`;
        }
        return {
          id: item.id,
          name: `${item.name}${customSuffix}`,
          price: item.price,
          quantity: item.quantity
        };
      }),
      total: finalTotal,
      deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
      serviceFee: orderType === 'dine_in_table' ? serviceFee : 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      orderType,
      tableNumber: orderType === 'dine_in_table' ? tableNumber : null,
      paymentMethod: pointType, // Salva como 'debito' ou 'credito' para manter painéis
      pointPaymentIntentId: pointPaymentId,
      pointDeviceId: deviceId,
      pointDeviceLabel: label,
      dailySeq,
      address: orderType === 'delivery' ? {
        street: deliveryAddress!.street,
        number: deliveryAddress!.number || '',
        neighborhood: deliveryAddress!.neighborhood || '',
        city: deliveryAddress!.city || 'Rio de Janeiro',
        zipCode: deliveryAddress!.zipCode || '',
        complement: deliveryAddress!.complement || '',
        lat: deliveryAddress!.lat,
        lng: deliveryAddress!.lng,
      } : null,
    };

    await addDoc(collection(db, 'orders'), orderData);
    setCart([]);
    setDeliveryAddress(null);
    setRouteDistance(null);
    setShowOrderSummary(false);
    setPaymentMethod('pix');
    setChangeFor('');
    setOrderType('pickup');
    
    setTimeout(() => {
      setShowPointLightbox(false);
      setOrderPlaced(true);
    }, 1500);
  };

  const handleStartPointPayment = async (deviceId: string, label: string) => {
    try {
      setBillError(null);
      setError(null);
      if (pointActionCallback === 'close_bill') {
        setBillSubmitting(true);
      } else {
        setSubmitting(true);
      }

      let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
      if (token === 'null' || token === 'undefined' || !token) {
        token = 'mock';
      }

      const response = await fetch(`${API_BASE_URL}/api/pagamentos/create-point-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          deviceId,
          amount: pointAmount,
          paymentType: pointType,
          externalReference: 'PED_' + Date.now()
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Erro ao gerar cobrança na maquininha.');
      }

      setSelectedDeviceId(deviceId);
      setPointPaymentId(result.intentId);
      setPointDeviceLabel(label);
      setPointPaymentStatus('pending');
      setShowPointLightbox(true);

    } catch (err: any) {
      console.error(err);
      if (pointActionCallback === 'close_bill') {
        setBillError(err.message || 'Erro ao acionar maquininha. Tente novamente.');
      } else {
        setError(err.message || 'Erro ao acionar maquininha. Tente novamente.');
      }
    } finally {
      setBillSubmitting(false);
      setSubmitting(false);
    }
  };

  const handleConfirmPointPaymentChoice = (deviceId: string, label: string) => {
    setShowPointDeviceSelector(false);
    handleStartPointPayment(deviceId, label);
  };

  const handleTriggerPointPaymentFlow = async (amount: number, type: 'debito' | 'credito', callback: 'place_order' | 'close_bill') => {
    const devices = [];
    if (storeConfig?.pointSmart2Id) devices.push({ id: storeConfig.pointSmart2Id, label: 'Point Smart 2' });
    if (storeConfig?.pointPro3Id) devices.push({ id: storeConfig.pointPro3Id, label: 'Point Pro 3' });
    if (storeConfig?.pointAir2Id) devices.push({ id: storeConfig.pointAir2Id, label: 'Point Air 2' });
    if (storeConfig?.pointMiniNfc2Id) devices.push({ id: storeConfig.pointMiniNfc2Id, label: 'Point Mini NFC 2' });

    if (devices.length === 0) {
      if (callback === 'close_bill') {
        setBillError(null);
        setBillSubmitting(true);
        try {
          const unpaid = tableOrders.filter(o => 
            o.paymentMethod === 'pagar_final' || 
            o.paymentMethod === 'dinheiro' || 
            o.paymentMethod === 'debito'
          );

          const batchPromises = unpaid.map(order => 
            updateDoc(doc(db, 'orders', order.id), {
              status: 'aguardando_caixa',
              paymentMethod: type,
              updatedAt: new Date().toISOString()
            })
          );
          await Promise.all(batchPromises);

          alert(`Solicitação de fechamento enviada ao Caixa! Por favor, aguarde o garçom trazer a maquininha para pagar seu saldo em ${type === 'debito' ? 'Débito' : 'Crédito'}.`);
          setShowCloseBillModal(false);
        } catch (err: any) {
          console.error(err);
          setBillError(err.message || 'Erro ao processar solicitação de pagamento.');
        } finally {
          setBillSubmitting(false);
        }
      } else {
        setError(null);
        setSubmitting(true);
        try {
          const now = new Date();
          const businessStart = new Date(now);
          if (now.getHours() < 6) {
            businessStart.setDate(now.getDate() - 1);
          }
          businessStart.setHours(6, 0, 0, 0);

          let dailySeq = 1;
          try {
            const qDaily = query(
              collection(db, 'orders'),
              where('createdAt', '>=', businessStart.toISOString())
            );
            const dailySnap = await getDocs(qDaily);
            dailySeq = dailySnap.size + 1;
          } catch (errSeq) {
            dailySeq = Math.floor(Math.random() * 900) + 100;
          }

          const orderData: any = {
            clientUid: user?.uid || '',
            clientName: user?.displayName || user?.email || 'Cliente Anônimo',
            clientPhone: userData?.phoneNumber || '',
            items: cart.map(item => {
              let customSuffix = '';
              const details: string[] = [];
              if (item.category === 'Pastéis Salgados') {
                if (item.withCatupiry) details.push('Catupiry');
                if (item.withBorda) details.push('Borda de Queijo');
                if (item.ingredients && item.ingredients.length > 0) {
                  details.push(`Adicionais: ${item.ingredients.join(', ')}`);
                }
              }
              if (details.length > 0) {
                customSuffix = ` (${details.join(' + ')})`;
              }
              return {
                id: item.id,
                name: `${item.name}${customSuffix}`,
                price: item.price,
                quantity: item.quantity
              };
            }),
            total: finalTotal,
            deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
            serviceFee: orderType === 'dine_in_table' ? serviceFee : 0,
            status: 'aguardando_caixa',
            createdAt: new Date().toISOString(),
            orderType,
            tableNumber: orderType === 'dine_in_table' ? tableNumber : null,
            paymentMethod: type,
            dailySeq,
            address: orderType === 'delivery' ? {
              street: deliveryAddress!.street,
              number: deliveryAddress!.number || '',
              neighborhood: deliveryAddress!.neighborhood || '',
              city: deliveryAddress!.city || 'Rio de Janeiro',
              zipCode: deliveryAddress!.zipCode || '',
              complement: deliveryAddress!.complement || '',
              lat: deliveryAddress!.lat,
              lng: deliveryAddress!.lng,
            } : null,
          };

          await addDoc(collection(db, 'orders'), orderData);
          setCart([]);
          setDeliveryAddress(null);
          setRouteDistance(null);
          setShowOrderSummary(false);
          setPaymentMethod('pix');
          setChangeFor('');
          setOrderType('pickup');

          alert(`Pedido enviado com sucesso! Por favor, aguarde o garçom/entregador trazer a maquininha para passar seu cartão em ${type === 'debito' ? 'Débito' : 'Crédito'}.`);
          setOrderPlaced(true);
        } catch (err: any) {
          console.error(err);
          setError(err.message || 'Erro ao enviar pedido.');
        } finally {
          setSubmitting(false);
        }
      }
      return;
    }

    setPointAmount(amount);
    setPointType(type);
    setPointActionCallback(callback);

    if (devices.length === 1) {
      // Ativa diretamente a única maquininha
      handleStartPointPayment(devices[0].id, devices[0].label);
    } else {
      // Abre o seletor de maquininhas
      setShowPointDeviceSelector(true);
    }
  };

  const completeCheckoutAfterPixPayment = async () => {
    const now = new Date();
    const businessStart = new Date(now);
    if (now.getHours() < 6) {
      businessStart.setDate(now.getDate() - 1);
    }
    businessStart.setHours(6, 0, 0, 0);

    const qDaily = query(
      collection(db, 'orders'),
      where('createdAt', '>=', businessStart.toISOString())
    );
    const dailySnap = await getDocs(qDaily);
    const dailySeq = dailySnap.size + 1;

    const orderData: any = {
      clientUid: user?.uid || '',
      clientName: user?.displayName || user?.email || 'Cliente Anônimo',
      clientPhone: userData?.phoneNumber || '',
      items: cart,
      total: finalTotal,
      deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
      serviceFee: orderType === 'dine_in_table' ? serviceFee : 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      orderType,
      tableNumber: orderType === 'dine_in_table' ? tableNumber : null,
      paymentMethod: 'pix',
      mercadoPagoPaymentId: pixPaymentId,
      dailySeq,
      address: orderType === 'delivery' ? {
        street: deliveryAddress!.street,
        number: deliveryAddress!.number || '',
        neighborhood: deliveryAddress!.neighborhood || '',
        city: deliveryAddress!.city || 'Rio de Janeiro',
        zipCode: deliveryAddress!.zipCode || '',
        complement: deliveryAddress!.complement || '',
        lat: deliveryAddress!.lat,
        lng: deliveryAddress!.lng,
      } : null,
    };

    await addDoc(collection(db, 'orders'), orderData);
    setCart([]);
    setDeliveryAddress(null);
    setRouteDistance(null);
    setShowOrderSummary(false);
    setPaymentMethod('pix');
    setChangeFor('');
    setOrderType('pickup');
    
    setTimeout(() => {
      setShowPixLightbox(false);
      setOrderPlaced(true);
    }, 1500);
  };

  // Effect para checagem do pagamento na Maquininha Point
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (showPointLightbox && pointPaymentId && pointPaymentStatus === 'pending') {
      let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
      if (token === 'null' || token === 'undefined' || !token) {
        token = 'mock';
      }

      interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/pagamentos/check-point-order?intentId=${pointPaymentId}&token=${token}`);
          const data = await res.json();
          if (data.success && data.status === 'FINISHED') {
            setPointPaymentStatus('approved');
            clearInterval(interval);
            
            if (pointActionCallback === 'close_bill') {
              // FECHAMENTO DA CONTA DA MESA
              const unpaid = tableOrders.filter(o => 
                o.paymentMethod === 'pagar_final' || 
                o.paymentMethod === 'dinheiro' || 
                o.paymentMethod === 'debito'
              );
              
              const batchPromises = unpaid.map(order => 
                updateDoc(doc(db, 'orders', order.id), {
                  status: 'completed',
                  paymentMethod: pointType,
                  pointPaymentIntentId: pointPaymentId,
                  pointDeviceId: selectedDeviceId,
                  updatedAt: new Date().toISOString()
                })
              );
              await Promise.all(batchPromises);

              if (user) {
                const userDocRef = doc(db, 'users', user.uid);
                await updateDoc(userDocRef, {
                  tableNumber: null,
                  updatedAt: new Date().toISOString()
                });
              }

              alert("Conta fechada e paga com sucesso via Maquininha!");
              setShowPointLightbox(false);
              setShowCloseBillModal(false);
            } else {
              // NOVO PEDIDO DO CARRINHO
              await completeCheckoutAfterPointPayment(selectedDeviceId, pointDeviceLabel);
            }
          } else if (data.success && (data.status === 'CANCELED' || data.status === 'ERROR')) {
            setPointPaymentStatus('rejected');
            clearInterval(interval);
            alert(`O pagamento na maquininha falhou ou foi cancelado (Status: ${data.status}).`);
            setShowPointLightbox(false);
          }
        } catch (err) {
          console.error('Erro ao verificar status da Point:', err);
        }
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [showPointLightbox, pointPaymentId, pointPaymentStatus, storeConfig, cart, finalTotal, selectedDeviceId, pointDeviceLabel, pointActionCallback, tableOrders, user, pointType]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (showPixLightbox && pixPaymentId && pixPaymentStatus === 'pending') {
      let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
      if (token === 'null' || token === 'undefined' || !token) {
        token = 'mock';
      }
      
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/api/pagamentos/check-pix?paymentId=${pixPaymentId}&token=${token}`);
          const data = await res.json();
          if (data.success && data.status === 'approved') {
            setPixPaymentStatus('approved');
            clearInterval(interval);
            await completeCheckoutAfterPixPayment();
          } else if (data.success && data.status === 'rejected') {
            setPixPaymentStatus('rejected');
            clearInterval(interval);
          }
        } catch (err) {
          console.error('Erro ao verificar status Pix:', err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [showPixLightbox, pixPaymentId, pixPaymentStatus, storeConfig, cart, cartTotal, finalTotal, deliveryFee, orderType, deliveryAddress]);

  const handlePlaceOrder = async () => {
    setError(null);
    if (isClosedForUser) {
      setError('A pastelaria está fechada no momento e não está aceitando novos pedidos.');
      return;
    }
    if (orderType === 'dine_in_table' && !tableNumber) {
      setError('Você precisa estar vinculado a uma mesa (escanear o QR Code da mesa) para realizar o pedido de consumo local.');
      return;
    }
    setSubmitting(true);
    try {
      // Calcula o número sequencial do pedido para o dia de negócios atual (inicia às 6h da manhã)
      const now = new Date();
      const businessStart = new Date(now);
      if (now.getHours() < 6) {
        businessStart.setDate(now.getDate() - 1);
      }
      businessStart.setHours(6, 0, 0, 0);

      let dailySeq = 1;
      try {
        if (userData?.role && userData.role !== 'client') {
          // Admins, staff e gerentes podem listar todos os pedidos do dia
          const qDaily = query(
            collection(db, 'orders'),
            where('createdAt', '>=', businessStart.toISOString())
          );
          const dailySnap = await getDocs(qDaily);
          dailySeq = dailySnap.size + 1;
        } else {
          // Clientes normais contam apenas os próprios pedidos de hoje como fallback de sequência
          const qUserDaily = query(
            collection(db, 'orders'),
            where('clientUid', '==', user?.uid),
            where('createdAt', '>=', businessStart.toISOString())
          );
          const userDailySnap = await getDocs(qUserDaily);
          dailySeq = userDailySnap.size + 1;
        }
      } catch (errSeq) {
        console.warn("Erro ao calcular sequência de hoje (fallback ativo):", errSeq);
        dailySeq = Math.floor(Math.random() * 900) + 100;
      }

      let finalStatus = 'pending';

      if (paymentMethod === 'google_pay') {
        if (!(window as any).google || !(window as any).google.payments) {
          throw new Error('O SDK do Google Pay não está carregado. Por favor, recarregue a página.');
        }

        const paymentsClient = new (window as any).google.payments.api.PaymentsClient({
          environment: 'TEST'
        });

        const isProduction = false;

        const paymentDataRequest = {
          apiVersion: 2,
          apiVersionMinor: 0,
          allowedPaymentMethods: [{
            type: 'CARD',
            parameters: {
              allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
              allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX"]
            },
            tokenizationSpecification: {
              type: 'PAYMENT_GATEWAY',
              parameters: {
                gateway: 'example',
                gatewayMerchantId: 'exampleGatewayMerchantId'
              }
            }
          }],
          transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: finalTotal.toFixed(2),
            currencyCode: 'BRL',
            countryCode: 'BR'
          },
          merchantInfo: {
            merchantName: 'Dona Lu Pastelaria',
            ...(isProduction ? { merchantId: import.meta.env.VITE_GOOGLE_PAY_MERCHANT_ID || 'BCR2DN5TW6HJ3ZQL' } : {})
          }
        };

        try {
          const paymentData = await paymentsClient.loadPaymentData(paymentDataRequest);
          console.log("Token do Google Pay recebido com sucesso:", paymentData.paymentMethodData.tokenizationData.token);
          
          if (orderType === 'dine_in_table') {
            finalStatus = 'pending';
          } else {
            finalStatus = 'aguardando_caixa';
          }
        } catch (err: any) {
          if (err.statusCode === 'CANCELED') {
            setError('Pagamento via Google Pay cancelado pelo usuário.');
            setSubmitting(false);
            return;
          }
          console.error("Erro no Google Pay:", err);
          throw new Error(err.message || 'Falha ao processar o pagamento com Google Pay. Tente novamente.');
        }
      } else if (paymentMethod === 'debito_point' || paymentMethod === 'credito_point') {
        await handleTriggerPointPaymentFlow(finalTotal, paymentMethod === 'debito_point' ? 'debito' : 'credito', 'place_order');
        return;
      } else if (paymentMethod === 'pix') {
        let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
        if (token === 'null' || token === 'undefined' || !token) {
          token = 'mock';
        }
        const response = await fetch(`${API_BASE_URL}/api/pagamentos/create-pix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            amount: finalTotal,
            email: user?.email || 'cliente@email.com',
            name: user?.displayName || user?.email || 'Cliente',
            cpf: userData?.cpf || '45678912364'
          })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Erro ao gerar Pix no Mercado Pago.');
        }

        setPixPaymentId(result.paymentId);
        setPixQrCode(result.qrCode);
        setPixQrCodeBase64(result.qrCodeBase64);
        setPixPaymentStatus('pending');
        setShowPixLightbox(true);
        setSubmitting(false);
        return;
      } else if (paymentMethod === 'dinheiro' || paymentMethod === 'debito' || paymentMethod === 'pagar_final') {
        if (orderType === 'dine_in_table') {
          finalStatus = 'pending';
        } else {
          finalStatus = 'aguardando_caixa';
        }
      } else if (paymentMethod === 'credito') {
        // FLUXO DE PAGAMENTO ONLINE DO PAGBANK
        const isUsingSavedCard = useSavedCard && !!userData?.pagbank_card_token;
        let encryptedCardToken = '';

        if (!isUsingSavedCard) {
          if (!(window as any).PagSeguro) {
            throw new Error('O SDK do PagBank não pôde ser carregado. Por favor, recarregue a página.');
          }

          if (!cardNumber || !cardHolder || !cardExpiry || !cardCvv || !clientCpf) {
            throw new Error('Por favor, preencha todos os campos do cartão e o CPF.');
          }

          const expiryParts = cardExpiry.split('/');
          if (expiryParts.length !== 2) {
            throw new Error('Formato da validade inválido (use MM/AA).');
          }
          const expMonth = expiryParts[0].trim();
          let expYear = expiryParts[1].trim();
          if (expYear.length === 2) {
            expYear = '20' + expYear;
          }

          const encryptionResult = (window as any).PagSeguro.encryptCard({
            publicKey: import.meta.env.VITE_PAGBANK_PUBLIC_KEY || 'MOCK_PUBLIC_KEY_PAGBANK_123456',
            holder: cardHolder,
            number: cardNumber.replace(/\s/g, ''),
            expMonth: expMonth,
            expYear: expYear,
            cvv: cardCvv
          });

          if (encryptionResult.hasErrors) {
            const errorMsg = encryptionResult.errors?.[0]?.message || 'Dados do cartão inválidos.';
            throw new Error(errorMsg);
          }

          encryptedCardToken = encryptionResult.encryptedCard;
        }

        const response = await fetch(`${API_BASE_URL}/api/pagamentos/process-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            encryptedCard: isUsingSavedCard ? undefined : encryptedCardToken,
            cpf: isUsingSavedCard ? undefined : clientCpf.replace(/\D/g, ''),
            saveCard: isUsingSavedCard ? false : saveCardConsent,
            orderTotal: finalTotal,
            clientName: user?.displayName || user?.email || 'Cliente',
            clientEmail: user?.email || '',
            useSavedCard: isUsingSavedCard,
            savedCustomerId: userData?.pagbank_customer_id || undefined,
            savedCardToken: userData?.pagbank_card_token || undefined
          })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Falha no pagamento do PagBank.');
        }

        if (!isUsingSavedCard && saveCardConsent && result.card) {
          const userDocRef = doc(db, 'users', user!.uid);
          await updateDoc(userDocRef, {
            cpf: clientCpf.replace(/\D/g, ''),
            pagbank_customer_id: result.card.customer_id,
            pagbank_card_token: result.card.card_token,
            pagbank_card_brand: result.card.brand,
            pagbank_card_last_digits: result.card.last_digits,
            updatedAt: new Date().toISOString()
          });
        }

        finalStatus = 'pending';
      }

      const orderData: any = {
        clientUid: user?.uid || '',
        clientName: user?.displayName || user?.email || 'Cliente Anônimo',
        clientPhone: userData?.phoneNumber || '',
        items: cart.map(item => {
          let customSuffix = '';
          const details: string[] = [];
          if (item.category === 'Pastéis Salgados') {
            if (item.withCatupiry) details.push('Catupiry');
            if (item.withBorda) details.push('Borda de Queijo');
            if (item.ingredients && item.ingredients.length > 0) {
              details.push(`Adicionais: ${item.ingredients.join(', ')}`);
            }
          }
          if (details.length > 0) {
            customSuffix = ` (${details.join(' + ')})`;
          }
          return {
            id: item.id,
            name: `${item.name}${customSuffix}`,
            price: item.price,
            quantity: item.quantity
          };
        }),
        total: finalTotal,
        deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
        serviceFee: orderType === 'dine_in_table' ? serviceFee : 0,
        status: finalStatus,
        createdAt: new Date().toISOString(),
        orderType,
        tableNumber: orderType === 'dine_in_table' ? tableNumber : null,
        paymentMethod,
        changeFor: paymentMethod === 'dinheiro' && changeFor ? parseFloat(changeFor.replace(',', '.')) : null,
        dailySeq,
        address: orderType === 'delivery' ? {
          street: deliveryAddress!.street,
          number: deliveryAddress!.number || '',
          neighborhood: deliveryAddress!.neighborhood || '',
          city: deliveryAddress!.city || 'Rio de Janeiro',
          zipCode: deliveryAddress!.zipCode || '',
          complement: deliveryAddress!.complement || '',
          lat: deliveryAddress!.lat,
          lng: deliveryAddress!.lng,
        } : null,
      };

      await addDoc(collection(db, 'orders'), orderData);
      setCart([]);
      setDeliveryAddress(null);
      setRouteDistance(null);
      setShowOrderSummary(false);
      setPaymentMethod('pix');
      setChangeFor('');
      setNoChangeNeeded(false);
      setOrderType('pickup');
      setCardNumber('');
      setCardHolder('');
      setCardExpiry('');
      setCardCvv('');
      setSaveCardConsent(false);
      setOrderPlaced(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao enviar pedido para a cozinha. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  // Renderização condicional conforme a prop 'showOnly'
  if (showOnly === 'loyalty') {
    return (
      <div className="dashboard-layout animate-fade-in">
        <div className="dashboard-header">
          <h2>Programa de Fidelidade e Perfil 💝</h2>
          <p>Confira seus carimbos acumulados e endereço principal de entrega.</p>
        </div>
        <div className="client-grid-loyalty">
          <div className="loyalty-card" style={{ padding: '2rem' }}>
            <h3>Cartão Fidelidade Dona Lu</h3>
            <p>Junte 10 carimbos e ganhe um pastel doce da sua escolha!</p>
            <div className="stamps-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginTop: '2rem', gap: '1rem' }}>
              {[...Array(10)].map((_, i) => (
                <div key={i} className={`stamp-slot ${i < 3 ? 'stamped' : ''}`} style={{ padding: '0.5rem', fontSize: i < 3 ? '1.5rem' : '0.9rem' }}>
                  {i < 3 ? '🥟' : i + 1}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Total de carimbos ativos: <strong>3 de 10</strong>. Faltam 7 para o próximo pastel grátis!
            </div>
          </div>

          <div className="loyalty-card" style={{ padding: '2rem', textAlign: 'left' }}>
            <h3>Seu Endereço Cadastrado</h3>
            {userData?.clientAddress ? (
              <div className="address-card" style={{ border: 'none', background: 'rgba(255,255,255,0.02)', padding: '1.5rem' }}>
                <MapPin size={24} className="address-icon" />
                <div>
                  <p style={{ fontSize: '1.1rem' }}><strong>{userData.clientAddress.street}, {userData.clientAddress.number}</strong></p>
                  <p>{userData.clientAddress.neighborhood} - {userData.clientAddress.city}</p>
                  {userData.clientAddress.complement && <p className="complement">{userData.clientAddress.complement}</p>}
                </div>
              </div>
            ) : (
              <div className="empty-address-card" style={{ padding: '2rem' }}>
                <MapPin size={32} />
                <p>Nenhum endereço principal cadastrado no seu documento do Firestore.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const filteredProducts = pastels.filter((p: any) => {
    const cat = p.category || 'Pastéis Gourmet Especiais';
    return cat.toLowerCase() === activeCategory.toLowerCase();
  });

  const isBebidasTab = activeCategory.toLowerCase().includes('bebida');
  const isPastelTab = activeCategory.toLowerCase().includes('pastel') || activeCategory.toLowerCase().includes('pastéis') || activeCategory.toLowerCase().includes('pasteis');
  
  const namePlaceholder = isBebidasTab 
    ? "Nome da bebida" 
    : (isPastelTab ? "Nome do pastel" : "Nome do item");

  const descPlaceholder = isBebidasTab 
    ? "Descrição da bebida" 
    : (isPastelTab ? "Descrição do pastel" : "Descrição do item");

  // Padrão: exibe o cardápio e carrinho
  return (
    <div className="dashboard-layout animate-fade-in">
      <div className="dashboard-header">
        <h2>Cardápio Digital 🥟</h2>
        <p>Monte seu carrinho e faça seu pedido!</p>
      </div>

      {/* Menu deslizante horizontal de categorias */}
      <div className="category-menu-container">
        <div className="category-menu-scroll">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={`category-menu-btn ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
          {canEdit && (
            <button
              type="button"
              className="category-menu-btn create-new-btn"
              onClick={handleCreateNewCategory}
            >
              ➕ Criar novo menu
            </button>
          )}
        </div>
      </div>





      {isStoreClosed && (
        <div className="animate-fade-in" style={{
          background: canEdit ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          borderLeft: `4px solid ${canEdit ? 'var(--primary-gold)' : '#ef4444'}`,
          color: canEdit ? 'var(--primary-gold)' : '#ef4444',
          padding: '1rem 1.25rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          fontSize: '0.9rem',
          lineHeight: '1.5',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          border: `1px solid ${canEdit ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`
        }}>
          {canEdit ? (
            <>
              <strong>⚠️ Modo Administrativo / Testes Ativo:</strong>
              <span>A pastelaria está atualmente <strong>fechada</strong> para clientes externos (fora do horário de funcionamento: {storeConfig?.openingTime || '18:00'} às {storeConfig?.closingTime || '23:30'}). No entanto, como você possui privilégios de <strong>{role === 'developer' ? 'Desenvolvedor' : role === 'owner' ? 'Proprietário' : 'Gerente'}</strong>, você pode navegar e realizar pedidos de teste normalmente.</span>
            </>
          ) : (
            <>
              <strong>🔴 Pastelaria Fechada no Momento:</strong>
              <span>Estamos fora do horário de atendimento. Nosso horário de funcionamento é das <strong>{storeConfig?.openingTime || '18:00'}</strong> às <strong>{storeConfig?.closingTime || '23:30'}</strong>. Você pode olhar nosso cardápio, mas não será possível adicionar produtos ao carrinho ou enviar novos pedidos agora. Agradecemos a compreensão!</span>
            </>
          )}
        </div>
      )}

      {isVisitor && (
        <div className="alert-box animate-fade-in" style={{
          background: 'rgba(245, 158, 11, 0.1)',
          borderLeft: '4px solid var(--primary-gold)',
          color: 'var(--primary-gold)',
          padding: '1rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          fontSize: '0.9rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <div>
            <strong>Navegação como Visitante:</strong> Você pode visualizar os produtos e novidades, mas precisará estar logado para fazer pedidos e acumular carimbos no cartão fidelidade.
          </div>
          <button 
            type="button" 
            onClick={onLoginRequired}
            style={{
              background: 'var(--primary-gold)',
              border: 'none',
              color: '#0a0707',
              padding: '0.4rem 1rem',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontSize: '0.85rem'
            }}
          >
            Fazer Login / Cadastrar
          </button>
        </div>
      )}

      {/* Modal de Sucesso do Pedido */}
      {orderPlaced && (
        <div
          className="lightbox-overlay"
          style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: '24px',
            padding: '2.5rem 2rem',
            width: '100%',
            maxWidth: '420px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.2rem',
            boxShadow: '0 0 60px rgba(16,185,129,0.15), 0 24px 60px rgba(0,0,0,0.6)',
            textAlign: 'center',
            animation: 'fadeInUp 0.4s ease',
          }}>
            {/* Ícone animado */}
            <div style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(16,185,129,0.12)',
              border: '2px solid rgba(16,185,129,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
            }}>
              ✅
            </div>

            <div>
              <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.4rem', color: '#10b981', fontWeight: 800 }}>
                Pedido Confirmado!
              </h2>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.6' }}>
                Seu pedido foi recebido com sucesso e <strong style={{ color: '#fff' }}>já está sendo preparado</strong>! 🥟🔥
              </p>
              <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Acompanhe o andamento do pedido em tempo real e fique de olho no status!
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setOrderPlaced(false);
                onNavigate?.('tracking');
              }}
              className="auth-btn auth-btn-login"
              style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 700, marginTop: '0.4rem' }}
            >
              👀 Acompanhar meu Pedido
            </button>

            <button
              type="button"
              onClick={() => setOrderPlaced(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                textDecoration: 'underline',
                padding: '0'
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {error && <div className="auth-error-message" style={{ marginBottom: '1.5rem' }}>{error}</div>}

      <div className="client-grid">
        {/* Lista de Pastéis */}
        <div className="menu-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.5rem', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, border: 'none', padding: 0 }}>{activeCategory}</h3>
              {canEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    onClick={() => handleRenameCategory(activeCategory)}
                    title="Renomear Categoria"
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: 'var(--text-secondary)',
                      borderRadius: '6px',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--primary-gold)';
                      e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-secondary)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    }}
                  >
                    <Edit2 size={12} />
                    <span>Renomear</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(activeCategory)}
                    title="Excluir Categoria"
                    style={{
                      background: 'rgba(239, 68, 68, 0.05)',
                      border: '1px solid rgba(239, 68, 68, 0.15)',
                      color: '#f87171',
                      borderRadius: '6px',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)';
                    }}
                  >
                    <Trash2 size={12} />
                    <span>Excluir</span>
                  </button>
                </div>
              )}
            </div>
            {canEdit && (
              <button 
                type="button" 
                onClick={handleAddNewItem}
                style={{ 
                  background: 'rgba(245, 158, 11, 0.1)', 
                  border: '1px dashed var(--primary-gold)', 
                  color: 'var(--primary-gold)', 
                  padding: '0.4rem 1rem', 
                  borderRadius: '8px', 
                  fontSize: '0.85rem', 
                  fontWeight: 600, 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)'; }}
              >
                <Plus size={16} />
                <span>Adicionar Novo Item</span>
              </button>
            )}
          </div>
          {activeCategory !== 'Bebidas' && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid rgba(245, 158, 11, 0.15)',
              borderRadius: '12px',
              padding: '0.85rem 1.25rem',
              marginBottom: '1.5rem',
              textAlign: 'center',
              color: '#fff',
              fontSize: '0.9rem',
              lineHeight: '1.5'
            }}>
              <strong>📢 Qualquer pastel deste cardápio custa apenas R$ 20,00! 🍕⭐</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                A borda e o catupiry são opcionais (não são cobrados por fora) opções personalizáveis abaixo.
              </div>
            </div>
          )}

          <div className="pastels-list">
            {filteredProducts.length === 0 ? (
              <div style={{ 
                color: 'var(--text-secondary)', 
                padding: '3rem 1rem', 
                textAlign: 'center', 
                width: '100%', 
                background: 'rgba(255,255,255,0.01)', 
                border: '1px dashed rgba(255,255,255,0.06)', 
                borderRadius: '12px',
                fontSize: '0.95rem'
              }}>
                Nenhum produto cadastrado nesta categoria.
              </div>
            ) : (
              filteredProducts.map((pastel: any) => (
                <div key={pastel.id} className="pastel-card">
                {/* Foto do Pastel */}
                <div className="pastel-img-container" onClick={() => pastel.image && setZoomedImage(pastel.image)} title="Clique para ampliar">
                  {pastel.image ? (
                    <img src={pastel.image} alt={pastel.name} className="pastel-card-img" loading="lazy" decoding="async" />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Sem foto</div>
                  )}
                </div>

                <div className="pastel-details" style={{ 
                  flex: 1, 
                  marginLeft: '1.25rem',
                  display: 'flex',
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: '0.5rem 1.5rem'
                }}>
                  {editingId === pastel.id ? (
                    // Modo Edição
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
                      <input 
                        type="text" 
                        className="pastel-edit-input" 
                        value={editName} 
                        onChange={(e) => setEditName(e.target.value)} 
                        placeholder={namePlaceholder} 
                      />
                      <textarea 
                        className="pastel-edit-textarea" 
                        value={editDescription} 
                        onChange={(e) => setEditDescription(e.target.value)} 
                        placeholder={descPlaceholder} 
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>R$</span>
                        <input 
                          type="number" 
                          step="0.01" 
                          className="pastel-edit-input" 
                          value={editPrice} 
                          onChange={(e) => setEditPrice(parseFloat(e.target.value) || 0)} 
                          placeholder="Preço" 
                          style={{ width: '90px', marginBottom: '0.5rem' }} 
                        />
                        
                        <label className="pastel-upload-label" style={{ marginBottom: '0.5rem' }}>
                          <Upload size={14} />
                          <span>{editImage ? 'Trocar foto' : 'Anexar foto'}</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={handleImageUpload} 
                            style={{ display: 'none' }} 
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    // Modo Visualização
                    <>
                      <div style={{ flex: '1 1 auto', minWidth: '90px', maxWidth: '200px', textAlign: 'left' }}>
                        <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{pastel.name}</h4>
                        {pastel.category !== 'Pastéis Salgados' && pastel.description && (
                          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{pastel.description}</p>
                        )}
                      </div>

                      {pastel.category === 'Pastéis Salgados' && (
                        <div style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-secondary)',
                          fontStyle: 'italic',
                          marginTop: '0.2rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px dashed rgba(255, 255, 255, 0.08)',
                          borderRadius: '6px',
                          padding: '0.35rem 0.5rem',
                          maxWidth: '320px',
                          textAlign: 'left'
                        }}>
                          ℹ️ <strong>Escolha opcionais e adicionais no carrinho</strong> antes de confirmar o pedido.
                        </div>
                      )}

                      {pastel.category !== 'Pastéis Salgados' && pastel.category !== 'Pastéis Doces' && (
                        <span className="pastel-price">R$ {pastel.price.toFixed(2).replace('.', ',')}</span>
                      )}
                    </>
                  )}
                </div>

                <div className="pastel-actions" style={{ marginLeft: '1rem' }}>
                  {editingId === pastel.id ? (
                    // Botões para salvar/cancelar em edição
                    <>
                      <button type="button" onClick={saveEdit} className="pastel-action-btn save-btn" title="Salvar Alterações">
                        <Check size={18} />
                      </button>
                      <button type="button" onClick={cancelEdit} className="pastel-action-btn cancel-btn" title="Cancelar">
                        <X size={18} />
                      </button>
                    </>
                  ) : (
                    // Botões para editar / comprar
                    <>
                      {canEdit && (
                        <>
                          <button type="button" onClick={() => startEdit(pastel)} className="pastel-action-btn edit-btn" title="Editar Pastel">
                            <Edit2 size={16} />
                          </button>
                          <button type="button" onClick={() => handleDeleteItem(pastel.id)} className="pastel-action-btn delete-btn" title="Excluir Pastel">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                      <button 
                        type="button" 
                        onClick={() => addToCart(pastel)} 
                        className="add-to-cart-btn" 
                        aria-label={`Adicionar ${pastel.name} ao carrinho`}
                        disabled={isClosedForUser}
                        style={isClosedForUser ? { opacity: 0.5, cursor: 'not-allowed', background: '#4b5563' } : undefined}
                      >
                        <ShoppingCart size={18} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )))}
          </div>
        </div>

        {/* Carrinho e Endereço */}
        <div className="profile-section" id="cart-section">
          <div className="loyalty-card">
            <h3>Carrinho de Compras</h3>
            {cart.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '2rem 0' }}>Seu carrinho está vazio.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="cart-items-list" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {cart.map((item, idx) => (
                    <div key={`${item.id}-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{item.name}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)' }}>R$ {item.price.toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <button type="button" onClick={() => updateQuantity(item.id, -1)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><Minus size={14} /></button>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{item.quantity}</span>
                          <button type="button" onClick={() => updateQuantity(item.id, 1)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><Plus size={14} /></button>
                          <button type="button" onClick={() => removeFromCart(item.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: '0.5rem' }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      
                      {/* Mostrar resumo rápido das opções no carrinho */}
                      {item.category === 'Pastéis Salgados' && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '0.2rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          <span>Catupiry: {item.withCatupiry ? 'Sim ✅' : 'Não ❌'}</span>
                          <span>·</span>
                          <span>Borda: {item.withBorda ? 'Sim ✅' : 'Não ❌'}</span>
                          {item.ingredients && item.ingredients.length > 0 && (
                            <>
                              <span>·</span>
                              <span>Adicionais: {item.ingredients.join(', ')}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem', fontWeight: 700 }}>
                  <span>Total:</span>
                  <span style={{ color: 'var(--primary-gold)' }}>R$ {cartTotal.toFixed(2).replace('.', ',')}</span>
                </div>
              </div>
            )}
          </div>

          {/* Seleção: Retirada ou Entrega */}
          <div className="loyalty-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--primary-gold)' }}>🛵</span> Como deseja retirar?
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => { setOrderType('dine_in_table'); setDeliveryAddress(null); setRouteDistance(null); }}
                style={{
                  padding: '0.85rem 0.5rem',
                  borderRadius: '12px',
                  border: orderType === 'dine_in_table' ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)',
                  background: orderType === 'dine_in_table' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                  color: orderType === 'dine_in_table' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  fontWeight: orderType === 'dine_in_table' ? 700 : 400,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.2rem',
                }}
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="28" 
                  height="28" 
                  viewBox="0 0 24 24" 
                  fill="none"
                  style={{ marginBottom: '0.1rem', marginTop: '0.1rem', flexShrink: 0 }}
                >
                  {/* Behind Chairs (2 Backrests) */}
                  <rect x="7" y="4" width="3" height="7" rx="0.5" fill="#92400e" stroke="#78350f" strokeWidth="1" />
                  <line x1="8.5" y1="4" x2="8.5" y2="11" stroke="#78350f" strokeWidth="0.8" />
                  
                  <rect x="14" y="4" width="3" height="7" rx="0.5" fill="#92400e" stroke="#78350f" strokeWidth="1" />
                  <line x1="15.5" y1="4" x2="15.5" y2="11" stroke="#78350f" strokeWidth="0.8" />

                  {/* Side Chairs Seats and Legs */}
                  {/* Left Side Chair */}
                  <rect x="1" y="10" width="3.5" height="1.5" rx="0.5" fill="#b45309" stroke="#78350f" strokeWidth="1" />
                  <rect x="1" y="4" width="1" height="6" rx="0.3" fill="#b45309" stroke="#78350f" strokeWidth="0.8" />
                  <line x1="1.5" y1="11.5" x2="1.5" y2="20" stroke="#78350f" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="3.5" y1="11.5" x2="3.5" y2="20" stroke="#78350f" strokeWidth="1.2" strokeLinecap="round" />

                  {/* Right Side Chair */}
                  <rect x="19.5" y="10" width="3.5" height="1.5" rx="0.5" fill="#b45309" stroke="#78350f" strokeWidth="1" />
                  <rect x="22" y="4" width="1" height="6" rx="0.3" fill="#b45309" stroke="#78350f" strokeWidth="0.8" />
                  <line x1="20" y1="11.5" x2="20" y2="20" stroke="#78350f" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="22" y1="11.5" x2="22" y2="20" stroke="#78350f" strokeWidth="1.2" strokeLinecap="round" />

                  {/* Table Legs (Behind Table Top) */}
                  <rect x="6.5" y="11" width="1.5" height="9" rx="0.3" fill="#78350f" />
                  <rect x="16" y="11" width="1.5" height="9" rx="0.3" fill="#78350f" />

                  {/* Table Top */}
                  <rect x="4.5" y="9.5" width="15" height="2" rx="0.5" fill="#d97706" stroke="#92400e" strokeWidth="1" />
                </svg>
                <span style={{ fontWeight: 600 }}>Comer à mesa</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(Servido na mesa)</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  setOrderType('dine_in');
                  setDeliveryAddress(null);
                  setRouteDistance(null);
                  setTableNumber(null);
                  sessionStorage.removeItem('donalu_mesa');
                  if (user) {
                    try {
                      await updateDoc(doc(db, 'users', user.uid), {
                        tableNumber: null,
                        updatedAt: new Date().toISOString()
                      });
                    } catch (err) {
                      console.error("Erro ao desvincular mesa ao selecionar comer ai:", err);
                    }
                  }
                }}
                style={{
                  padding: '0.85rem 0.5rem',
                  borderRadius: '12px',
                  border: orderType === 'dine_in' ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)',
                  background: orderType === 'dine_in' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                  color: orderType === 'dine_in' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  fontWeight: orderType === 'dine_in' ? 700 : 400,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.2rem',
                }}
              >
                <span style={{ fontSize: '1.6rem' }}>🍽️</span>
                <span style={{ fontWeight: 600 }}>Vou comer aí</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(Pode ir preparando)</span>
              </button>
              <button
                type="button"
                onClick={() => { setOrderType('pickup'); setDeliveryAddress(null); setRouteDistance(null); }}
                style={{
                  padding: '0.85rem 0.5rem',
                  borderRadius: '12px',
                  border: orderType === 'pickup' ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)',
                  background: orderType === 'pickup' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                  color: orderType === 'pickup' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  fontWeight: orderType === 'pickup' ? 700 : 400,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.2rem',
                }}
              >
                <span style={{ fontSize: '1.6rem' }}>🏪</span>
                <span style={{ fontWeight: 600 }}>Vou retirar na loja</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(Embale para viagem)</span>
              </button>
              <button
                type="button"
                onClick={() => setOrderType('delivery')}
                style={{
                  padding: '0.85rem 0.5rem',
                  borderRadius: '12px',
                  border: orderType === 'delivery' ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)',
                  background: orderType === 'delivery' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.02)',
                  color: orderType === 'delivery' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  fontWeight: orderType === 'delivery' ? 700 : 400,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.2rem',
                }}
              >
                <span style={{ fontSize: '1.6rem' }}>🛵</span>
                <span style={{ fontWeight: 600 }}>Quero que entregue</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(Receba em casa)</span>
              </button>
            </div>

            {(orderType === 'pickup' || orderType === 'dine_in' || orderType === 'dine_in_table') && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '0.5rem 0.75rem', lineHeight: '1.5' }}>
                📍 <strong style={{ color: '#fff' }}>Dona Lu Pastelaria</strong> &mdash; Rua Jícara, 239 · Campo Grande · RJ
                {orderType === 'dine_in' && (
                  <div style={{ color: 'var(--primary-gold)', marginTop: '0.25rem', fontWeight: 600 }}>
                    🍽️ Seu pedido será servido para consumo no local! Estamos preparando para quando você chegar.
                  </div>
                )}
                {orderType === 'dine_in_table' && (
                  <div style={{ color: 'var(--primary-gold)', marginTop: '0.25rem', fontWeight: 600 }}>
                    🪑 Seu pedido será servido na mesa {tableNumber || ''}!
                  </div>
                )}
              </div>
            )}

            {tableNumber && (
              orderType === 'dine_in_table' ? (
                /* Caso Comer à Mesa: Exibe banner padrão */
                <div className="alert-box animate-fade-in" style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  borderLeft: '4px solid var(--primary-gold)',
                  color: 'var(--primary-gold)',
                  padding: '1rem 1.25rem',
                  borderRadius: '12px',
                  marginTop: '0.75rem',
                  fontSize: '0.92rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  border: '1px solid rgba(245, 158, 11, 0.15)'
                }}>
                  <div>
                    🪑 <strong>Mesa Identificada:</strong> Você está na <strong>Mesa {tableNumber}</strong>. Seus pedidos serão entregues no salão diretamente para você!
                  </div>
                  <button 
                    type="button" 
                    onClick={handleChangeTable}
                    style={{
                      background: 'none',
                      border: '1px solid var(--primary-gold)',
                      color: 'var(--primary-gold)',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Troquei de Mesa
                  </button>
                </div>
              ) : (
                /* Caso Escolha Outra Opção: Exibe aviso de que não será entregue na mesa */
                <div className="alert-box animate-fade-in" style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderLeft: '4px solid #ef4444',
                  color: '#ef4444',
                  padding: '1rem 1.25rem',
                  borderRadius: '12px',
                  marginTop: '0.75rem',
                  fontSize: '0.92rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  border: '1px solid rgba(239, 68, 68, 0.15)'
                }}>
                  <div>
                    ⚠️ <strong>Aviso:</strong> Você escaneou a <strong>Mesa {tableNumber}</strong>, mas escolheu outra opção. Seu pedido <strong>NÃO</strong> será servido na mesa, será embrulhado para a viagem e entregue!
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <button 
                      type="button" 
                      onClick={() => setOrderType('dine_in_table')}
                      style={{
                        background: 'none',
                        border: '1px solid #ef4444',
                        color: '#ef4444',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Comer na Mesa {tableNumber}
                    </button>
                    <button 
                      type="button" 
                      onClick={handleClearTable}
                      style={{
                        background: 'none',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: 'var(--text-secondary)',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '8px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Liberar Mesa
                    </button>
                  </div>
                </div>
              )
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleOpenSummary(); }} className="loyalty-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>

            {/* Endereço de Entrega — só aparece se cliente escolheu delivery */}
            {orderType === 'delivery' && (
              <>
                <h3 style={{ fontSize: '1.1rem', margin: '0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <MapPin size={18} style={{ color: 'var(--primary-gold)' }} />
                  Endereço de Entrega
                </h3>

                <DeliveryMap
                  onAddressSelect={(addr) => { setDeliveryAddress(addr); setRouteDistance(null); }}
                />

                {deliveryAddress && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem',
                    lineHeight: '1.5'
                  }}>
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {deliveryAddress.street}{deliveryAddress.number ? `, ${deliveryAddress.number}` : ''}
                    </strong>
                    {deliveryAddress.complement && <span> &middot; {deliveryAddress.complement}</span>}
                    <br />
                    {deliveryAddress.neighborhood && `${deliveryAddress.neighborhood} · `}
                    {deliveryAddress.city}
                    {deliveryAddress.zipCode && ` · CEP ${deliveryAddress.zipCode}`}
                  </div>
                )}
              </>
            )}

            {/* Forma de Pagamento */}
            <div style={{ borderTop: orderType === 'delivery' ? '1px solid rgba(255,255,255,0.06)' : 'none', paddingTop: orderType === 'delivery' ? '0.75rem' : '0', marginTop: orderType === 'delivery' ? '0.25rem' : '0' }}>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>
                Forma de Pagamento
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {(() => {
                  if (orderType === 'dine_in_table') {
                    return [
                      ['pix', 'Pix 🟡'],
                      ['credito', 'Crédito Online 💳'],
                      ['google_pay', 'Google Pay 📱'],
                      ['debito_point', 'Débito Maquininha 💴'],
                      ['credito_point', 'Crédito Maquininha 💳'],
                      ['pagar_final', 'Pagar no Final 🍽️']
                    ] as any;
                  }

                  return [
                    ['pix', 'Pix 🟡'],
                    ['credito', 'Crédito Online 💳'],
                    ['google_pay', 'Google Pay 📱'],
                    ['debito_point', 'Débito Maquininha 💴'],
                    ['credito_point', 'Crédito Maquininha 💳']
                  ] as any;
                })().map(([val, label]: [string, string]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(val as any);
                      setChangeFor('');
                      setNoChangeNeeded(false);
                    }}
                    style={{
                      padding: '0.6rem 0.5rem',
                      borderRadius: '30px',
                      border: paymentMethod === val
                        ? '2px solid var(--primary-gold)'
                        : '1px solid rgba(255,255,255,0.15)',
                      background: paymentMethod === val
                        ? 'rgba(245,158,11,0.16)'
                        : '#000000',
                      color: paymentMethod === val ? 'var(--primary-gold)' : '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'center',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  >
                    {val === 'google_pay' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#ffffff' }}>
                        Pagar com <GooglePayLogo height="14px" color="#ffffff" />
                      </span>
                    ) : val === 'pix' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        Pix <QrCode size={14} style={{ color: paymentMethod === val ? 'var(--primary-gold)' : '#ffffff' }} />
                      </span>
                    ) : (
                      label
                    )}
                  </button>
                ))}
              </div>

              {paymentMethod === 'dinheiro' && (
                <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      id="no-change-needed"
                      checked={noChangeNeeded}
                      onChange={(e) => {
                        setNoChangeNeeded(e.target.checked);
                        if (e.target.checked) {
                          setChangeFor('');
                        }
                      }}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--primary-gold)', cursor: 'pointer' }}
                    />
                    <label htmlFor="no-change-needed" style={{ fontSize: '0.85rem', color: '#fff', cursor: 'pointer', userSelect: 'none' }}>
                      Não preciso de troco
                    </label>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem', opacity: noChangeNeeded ? 0.5 : 1 }}>
                      Troco para quanto?
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="pastel-edit-input"
                      style={{ marginBottom: 0, maxWidth: '180px', opacity: noChangeNeeded ? 0.5 : 1, cursor: noChangeNeeded ? 'not-allowed' : 'text' }}
                      placeholder="Ex: 50,00"
                      value={changeFor}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9.,]/g, '');
                        setChangeFor(val);
                      }}
                      disabled={noChangeNeeded}
                    />
                  </div>
                </div>
              )}

              {paymentMethod === 'credito' && (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem' }}>
                  {userData?.pagbank_card_token ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: useSavedCard ? '0' : '0.5rem' }}>
                      <input
                        type="checkbox"
                        id="use-saved-card"
                        checked={useSavedCard}
                        onChange={(e) => setUseSavedCard(e.target.checked)}
                        style={{ width: '16px', height: '16px', accentColor: 'var(--primary-gold)' }}
                      />
                      <label htmlFor="use-saved-card" style={{ fontSize: '0.9rem', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                        Usar cartão de crédito salvo ({userData.pagbank_card_brand?.toUpperCase()} final **** {userData.pagbank_card_last_digits})
                      </label>
                    </div>
                  ) : null}

                  {(!userData?.pagbank_card_token || !useSavedCard) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Número do Cartão</label>
                        <input
                          type="text"
                          className="pastel-edit-input"
                          placeholder="0000 0000 0000 0000"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 '))}
                          maxLength={19}
                          required={paymentMethod === 'credito' && !useSavedCard}
                        />
                      </div>
                      <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Nome Impresso no Cartão</label>
                        <input
                          type="text"
                          className="pastel-edit-input"
                          placeholder="NOME DO TITULAR"
                          value={cardHolder}
                          onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                          required={paymentMethod === 'credito' && !useSavedCard}
                        />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div className="input-group">
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Validade (MM/AA)</label>
                          <input
                            type="text"
                            className="pastel-edit-input"
                            placeholder="MM/AA"
                            value={cardExpiry}
                            onChange={(e) => {
                              let v = e.target.value.replace(/\D/g, '');
                              if (v.length > 2) {
                                v = v.substring(0, 2) + '/' + v.substring(2, 4);
                              }
                              setCardExpiry(v);
                            }}
                            maxLength={5}
                            required={paymentMethod === 'credito' && !useSavedCard}
                          />
                        </div>
                        <div className="input-group">
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>CVV</label>
                          <input
                            type="text"
                            className="pastel-edit-input"
                            placeholder="123"
                            value={cardCvv}
                            onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ''))}
                            maxLength={4}
                            required={paymentMethod === 'credito' && !useSavedCard}
                          />
                        </div>
                      </div>
                      
                      <div className="input-group">
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>CPF do Titular</label>
                        <input
                          type="text"
                          className="pastel-edit-input"
                          placeholder="000.000.000-00"
                          value={clientCpf}
                          onChange={(e) => {
                            let v = e.target.value.replace(/\D/g, '');
                            if (v.length <= 11) {
                              v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                            }
                            setClientCpf(v);
                          }}
                          maxLength={14}
                          required={paymentMethod === 'credito' && !useSavedCard}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <input
                          type="checkbox"
                          id="save-card-consent"
                          checked={saveCardConsent}
                          onChange={(e) => setSaveCardConsent(e.target.checked)}
                          style={{ width: '16px', height: '16px', accentColor: 'var(--primary-gold)' }}
                        />
                        <label htmlFor="save-card-consent" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                          salvar meus dados de pagamento para usar novamente na proxima vez
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {paymentMethod === 'dinheiro' && !noChangeNeeded && changeFor.trim() === '' && (
              <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.25rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.5rem 0.75rem', borderRadius: '8px', fontWeight: 600 }}>
                ⚠️ Por favor, informe para quanto precisa de troco ou marque "Não preciso de troco" para prosseguir.
              </div>
            )}

            <button
              type="submit"
              disabled={
                cart.length === 0 || 
                (orderType === 'delivery' && !deliveryAddress) || 
                isClosedForUser ||
                (paymentMethod === 'dinheiro' && !noChangeNeeded && changeFor.trim() === '')
              }
              className="auth-btn auth-btn-login"
              style={{ 
                marginTop: '6px', 
                padding: '0.7rem', 
                fontSize: '0.95rem', 
                fontWeight: 700,
                ...((isClosedForUser || (paymentMethod === 'dinheiro' && !noChangeNeeded && changeFor.trim() === '')) ? { opacity: 0.5, cursor: 'not-allowed', background: '#4b5563' } : {})
              }}
            >
              <span>🛒 Ver Resumo do Pedido</span>
            </button>
          </form>

          {orderType === 'dine_in_table' && tableNumber && (
            <button
              type="button"
              onClick={handleOpenCloseBillModal}
              className="auth-btn"
              style={{
                marginTop: '0.6rem',
                padding: '0.7rem',
                fontSize: '0.95rem',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                width: '100%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                transition: 'all 0.2s'
              }}
            >
              <span>🧾 Fechar minha Conta e Pagar</span>
            </button>
          )}
        </div>
      </div>

      {/* Lightbox Modal para fotos ampliadas */}
      {zoomedImage && (
        <div className="lightbox-overlay" onClick={() => setZoomedImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lightbox-close-btn" onClick={() => setZoomedImage(null)} aria-label="Fechar imagem">
              <X size={20} />
            </button>
            <img src={zoomedImage} alt="Pastel Expandido" className="lightbox-img" decoding="async" />
          </div>
        </div>
      )}

      {/* Modal de Resumo do Pedido */}
      {showOrderSummary && (
        <div
          className="lightbox-overlay"
          onClick={() => setShowOrderSummary(false)}
          style={{ zIndex: 2000, alignItems: 'center', justifyContent: 'center', display: 'flex' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '20px',
              padding: '1.5rem',
              width: '90%',
              maxWidth: '480px',
              maxHeight: 'min(85vh, 85dvh)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.2rem',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setShowOrderSummary(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.3rem' }}>🧧</div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#fff' }}>Resumo do Pedido</h2>
              <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Confira tudo antes de confirmar</p>
            </div>

            {/* Itens */}
            <div>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Itens</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {cart.map((item, idx) => (
                  <div key={`${item.id}-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.6rem', marginBottom: '0.4rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                      <span style={{ color: '#fff', fontWeight: 600 }}>
                        <strong style={{ color: 'var(--primary-gold)' }}>{item.quantity}x</strong> {item.name}
                      </span>
                      <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                        R$ {(item.price * item.quantity).toFixed(2).replace('.', ',')}
                      </span>
                    </div>
                    
                    {/* Checkboxes de Customização do item salgado no resumo do pedido */}
                    {item.category === 'Pastéis Salgados' && (
                      <div className="pastel-customization-box" style={{ maxWidth: '100%', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', marginTop: '0.2rem' }}>
                        {/* Opcionais */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.15rem' }}>
                          <strong style={{ fontSize: '0.68rem', color: 'var(--primary-gold)' }}>Opcionais:</strong>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.68rem', color: '#fff', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={!!item.withCatupiry}
                              onChange={() => toggleCartItemCustom(idx, 'withCatupiry')}
                              style={{ accentColor: 'var(--primary-gold)', cursor: 'pointer', width: '11px', height: '11px' }}
                            />
                            Catupiry
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.68rem', color: '#fff', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={!!item.withBorda}
                              onChange={() => toggleCartItemCustom(idx, 'withBorda')}
                              style={{ accentColor: 'var(--primary-gold)', cursor: 'pointer', width: '11px', height: '11px' }}
                            />
                            Borda de Queijo
                          </label>
                        </div>

                        {/* Adicionais */}
                        <div>
                          <strong style={{ fontSize: '0.68rem', color: 'var(--primary-gold)', display: 'block', marginBottom: '0.1rem' }}>Adicionais (Escolha até 5):</strong>
                          <div className="pastel-ingredients-grid">
                            {['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon'].map(ing => {
                              const itemIngredients = item.ingredients || [];
                              const isChecked = itemIngredients.includes(ing);
                              const isDisabled = !isChecked && itemIngredients.length >= 5;
                              return (
                                <label key={ing} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.68rem', color: isDisabled ? '#4b5563' : '#fff', cursor: isDisabled ? 'not-allowed' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isDisabled}
                                    onChange={() => toggleCartItemIngredient(idx, ing)}
                                    style={{ accentColor: 'var(--primary-gold)', cursor: isDisabled ? 'not-allowed' : 'pointer', width: '11px', height: '11px' }}
                                  />
                                  {ing}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {orderType === 'delivery' && deliveryFee > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                    <span style={{ color: '#fff' }}>
                      <strong style={{ color: 'var(--primary-gold)' }}>1x</strong> Taxa de Entrega ({formatDistance(routeDistance || 0)})
                    </span>
                    <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      R$ {deliveryFee.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                )}
                {orderType === 'dine_in_table' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                    <span style={{ color: '#fff' }}>
                      <strong style={{ color: 'var(--primary-gold)' }}>1x</strong> Taxa de Serviço (10%){waiveServiceFee && ' (Isento)'}
                    </span>
                    <span style={{ color: waiveServiceFee ? '#ef4444' : 'var(--text-secondary)', textDecoration: waiveServiceFee ? 'line-through' : 'none', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      R$ {serviceFee.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                )}
                {orderType === 'dine_in_table' && canEdit && (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    marginTop: '0.5rem', 
                    padding: '0.4rem 0.6rem', 
                    borderRadius: '8px', 
                    background: 'rgba(245, 158, 11, 0.08)', 
                    border: '1px solid rgba(245, 158, 11, 0.15)' 
                  }}>
                    <input
                      type="checkbox"
                      id="waive-service-fee-checkbox"
                      checked={waiveServiceFee}
                      onChange={(e) => setWaiveServiceFee(e.target.checked)}
                      style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                    />
                    <label htmlFor="waive-service-fee-checkbox" style={{ fontSize: '0.78rem', color: 'var(--primary-gold)', cursor: 'pointer', fontWeight: 600, userSelect: 'none' }}>
                      Isentar taxa de 10% (Solicitação verbal)
                    </label>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.75rem', paddingTop: '0.75rem', fontWeight: 700, fontSize: '1.05rem' }}>
                <span>Total</span>
                <span style={{ color: 'var(--primary-gold)' }}>R$ {finalTotal.toFixed(2).replace('.', ',')}</span>
              </div>
            </div>

            {/* Forma de Pagamento */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
              <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>💳 Pagamento</h4>
              {paymentMethod === 'google_pay' ? (
                <div style={{ marginTop: '0.25rem' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      background: '#000000',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#ffffff',
                      borderRadius: '30px',
                      padding: '0.5rem 1.2rem',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      userSelect: 'none',
                    }}
                  >
                    Pagar com <GooglePayLogo height="16px" color="#ffffff" />
                  </div>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {paymentMethod === 'pix' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      Pix <QrCode size={15} style={{ color: 'var(--primary-gold)' }} />
                    </span>
                  ) : (
                    paymentLabels[paymentMethod]
                  )}
                </p>
              )}
              {paymentMethod === 'dinheiro' && (
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {changeFor ? (
                    <>Troco para R$ {parseFloat(changeFor.replace(',', '.')).toFixed(2).replace('.', ',')} · Troco: R$ {Math.max(0, parseFloat(changeFor.replace(',', '.')) - finalTotal).toFixed(2).replace('.', ',')}</>
                  ) : (
                    <>Não preciso de troco</>
                  )}
                </p>
              )}
            </div>

            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  {orderType === 'delivery' ? '📍 Entrega em' : orderType === 'dine_in' ? '🍽️ Consumo Local (A Caminho)' : orderType === 'dine_in_table' ? `🪑 Consumo na Mesa ${tableNumber || '---'}` : '🏪 Retirada em'}
                </h4>
                {orderType === 'dine_in_table' && (
                  <button
                    type="button"
                    onClick={() => setShowTableScannerModal(true)}
                    style={{
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      borderRadius: '8px',
                      padding: '0.25rem 0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      color: 'var(--primary-gold)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      outline: 'none'
                    }}
                  >
                    <Camera size={13} style={{ flexShrink: 0 }} />
                    <QrCode size={13} style={{ flexShrink: 0 }} />
                    <span>Escanear Mesa</span>
                  </button>
                )}
              </div>
              {orderType === 'delivery' ? (
                <>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>
                    {deliveryAddress?.street}{deliveryAddress?.number ? `, ${deliveryAddress.number}` : ''}
                  </p>
                  {deliveryAddress?.complement && (
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      {deliveryAddress.complement}
                    </p>
                  )}
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {deliveryAddress?.neighborhood && `${deliveryAddress.neighborhood} · `}{deliveryAddress?.city}
                    {deliveryAddress?.zipCode && ` · CEP ${deliveryAddress.zipCode}`}
                  </p>
                  <SummaryMiniMap address={deliveryAddress} onDistanceCalculated={setRouteDistance} />
                  {routeDistance !== null && (
                    <>
                      <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                        📍 <span style={{ color: 'var(--primary-gold)' }}>Distancia: {formatDistance(routeDistance)}</span>
                      </p>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.4' }}>
                        * Taxa de entrega: R$ 5,00 até 3 km + R$ 1,00 por km adicional completo.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>
                    Dona Lu Pastelaria &mdash; Rua Jícara, 239 · Campo Grande · RJ
                  </p>
                  {orderType === 'dine_in' && (
                    <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: 'var(--primary-gold)', fontWeight: 600 }}>
                      🍽️ Servido no local (Estou a caminho)
                    </p>
                  )}
                  {orderType === 'dine_in_table' && (
                    <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: 'var(--primary-gold)', fontWeight: 600 }}>
                      🪑 Servido na Mesa: {tableNumber ? `Mesa ${tableNumber}` : 'Mesa não identificada ⚠️'}
                    </p>
                  )}
                </>
              )}
            </div>

            {error && <div className="auth-error-message">{error}</div>}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowOrderSummary(false)}
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
                ← Voltar
              </button>
              <button
                type="button"
                onClick={handlePlaceOrder}
                disabled={submitting}
                className="auth-btn auth-btn-login"
                style={{ flex: 2, padding: '0.75rem', fontSize: '0.95rem', fontWeight: 700 }}
              >
                {submitting ? (
                  <><span className="spinner" /><span>Confirmando...</span></>
                ) : (
                  <span>🌟 Confirmar Pedido</span>
                )}
              </button>
            </div>
            {/* Espaçador para garantir respiro no final da rolagem no celular */}
            <div style={{ minHeight: '0.5rem', height: '0.5rem', flexShrink: 0 }} />
          </div>
        </div>
      )}
      {/* Modal de Solicitação de Celular */}
      {showPhonePrompt && (
        <div
          className="lightbox-overlay"
          onClick={() => setShowPhonePrompt(false)}
          style={{ zIndex: 3000, alignItems: 'center', justifyContent: 'center', display: 'flex', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '20px',
              padding: '2rem',
              width: '90%',
              maxWidth: '420px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.2rem',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setShowPhonePrompt(false)}
              style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.3rem' }}>📞</div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#fff' }}>Celular Obrigatório</h2>
              <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Precisamos do seu contato para o pedido</p>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, lineHeight: '1.4' }}>
              💡 <strong>Por que informar o celular?</strong> Precisamos de um contato direto para avisar sobre o andamento do seu pedido, tirar dúvidas sobre o endereço ou em caso de qualquer imprevisto com a entrega!
            </p>

            <form onSubmit={handleSavePromptPhone} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {promptPhoneError && <div className="auth-error-message">{promptPhoneError}</div>}
              
              <div className="input-group">
                <label htmlFor="prompt-phone">Celular (WhatsApp)</label>
                <div className="input-wrapper">
                  <span className="input-icon" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📞</span>
                  <input
                    id="prompt-phone"
                    type="tel"
                    placeholder="(21) 99999-9999"
                    value={promptPhone}
                    onChange={(e) => setPromptPhone(formatPhone(e.target.value))}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowPhonePrompt(false)}
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
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="auth-btn auth-btn-login"
                  style={{ flex: 1.5, padding: '0.75rem', fontSize: '0.95rem', fontWeight: 700 }}
                >
                  Salvar e Prosseguir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox de Pagamento via Pix */}
      {showPixLightbox && (
        <div
          className="lightbox-overlay animate-fade-in"
          style={{
            zIndex: 3500,
            alignItems: 'center',
            justifyContent: 'center',
            display: 'flex',
            background: 'rgba(5, 5, 8, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #16121e 0%, #0d0a11 100%)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '24px',
              padding: '1.5rem',
              width: '90%',
              maxWidth: '430px',
              maxHeight: 'min(90vh, 90dvh)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.25rem',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 40px rgba(245,158,11,0.05)',
              position: 'relative',
              animation: 'fadeInUp 0.4s ease'
            }}
          >
            <button
              type="button"
              onClick={() => { setShowPixLightbox(false); setSubmitting(false); }}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                lineHeight: 1
              }}
              className="map-search-clear"
            >
              <X size={16} />
            </button>

            <div style={{ textAlign: 'center', width: '100%' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Pagamento Online
              </span>
              <h3 style={{ margin: '0.2rem 0 0.4rem', fontSize: '1.4rem', color: '#fff', fontWeight: 800 }}>
                Pague com Pix
              </h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                Escaneie o código QR ou copie o código Pix abaixo. O pedido será enviado para a cozinha assim que o pagamento for confirmado.
              </p>
            </div>

            {/* QR Code Container */}
            <div style={{
              background: '#fff',
              padding: '1rem',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              position: 'relative',
              width: '200px',
              height: '200px'
            }}>
              {pixQrCodeBase64 ? (
                <img
                  src={`data:image/png;base64,${pixQrCodeBase64}`}
                  alt="Mercado Pago Pix QR Code"
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              ) : (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pixQrCode)}`}
                  alt="Pix QR Code Fallback"
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              )}
            </div>

            {/* Pix Copy and Paste String */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Código Pix Copia e Cola
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                <input
                  type="text"
                  readOnly
                  value={pixQrCode}
                  style={{
                    flex: 1,
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    outline: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(pixQrCode);
                    const btn = document.getElementById('pix-copy-btn');
                    if (btn) {
                      btn.innerText = 'Copiado! ✓';
                      btn.style.backgroundColor = '#10b981';
                      btn.style.borderColor = '#10b981';
                      setTimeout(() => {
                        btn.innerText = '📋 Copiar';
                        btn.style.backgroundColor = 'var(--primary-gold)';
                        btn.style.borderColor = 'var(--primary-gold)';
                      }, 2000);
                    }
                  }}
                  id="pix-copy-btn"
                  style={{
                    background: 'var(--primary-gold)',
                    border: '1px solid var(--primary-gold)',
                    borderRadius: '10px',
                    padding: '0 1rem',
                    color: '#000',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  📋 Copiar
                </button>
              </div>
            </div>

            {/* Status do pagamento */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem',
              width: '100%',
              padding: '0.75rem',
              background: pixPaymentStatus === 'approved' ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.02)',
              border: pixPaymentStatus === 'approved' ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              marginTop: '0.25rem'
            }}>
              {pixPaymentStatus === 'pending' ? (
                <>
                  <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--primary-gold)' }} />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Aguardando confirmação de pagamento...
                  </span>
                </>
              ) : pixPaymentStatus === 'approved' ? (
                <>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <span style={{ fontSize: '0.85rem', color: '#34d399', fontWeight: 700 }}>
                    Pagamento Aprovado! Preparando pedido...
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '1.1rem' }}>❌</span>
                  <span style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: 700 }}>
                    Pagamento recusado ou expirado.
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => { setShowPixLightbox(false); setSubmitting(false); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                textDecoration: 'underline',
                marginTop: '0.2rem'
              }}
            >
              Cancelar e voltar
            </button>
            {/* Espaçador para garantir respiro no final da rolagem no celular */}
            <div style={{ minHeight: '0.5rem', height: '0.5rem', flexShrink: 0 }} />
          </div>
        </div>
      )}

      {/* Modal de seleção de maquininhas Point */}
      {showPointDeviceSelector && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '20px',
            padding: '2rem',
            maxWidth: '420px',
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            textAlign: 'left'
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary-gold)' }}>
                Selecione a Maquininha Point
              </h3>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Escolha qual terminal ativo você deseja usar para realizar o pagamento de <strong>R$ {pointAmount.toFixed(2).replace('.', ',')}</strong>.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(() => {
                const devices = [];
                if (storeConfig?.pointSmart2Id) devices.push({ id: storeConfig.pointSmart2Id, label: 'Point Smart 2' });
                if (storeConfig?.pointPro3Id) devices.push({ id: storeConfig.pointPro3Id, label: 'Point Pro 3' });
                if (storeConfig?.pointAir2Id) devices.push({ id: storeConfig.pointAir2Id, label: 'Point Air 2' });
                if (storeConfig?.pointMiniNfc2Id) devices.push({ id: storeConfig.pointMiniNfc2Id, label: 'Point Mini NFC 2' });
                return devices.map(dev => (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() => handleConfirmPointPaymentChoice(dev.id, dev.label)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.85rem 1rem',
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.02)',
                      color: '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontWeight: 600,
                      fontSize: '0.9rem'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(59,130,246,0.08)';
                      e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                    }}
                  >
                    <span>📟 {dev.label}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                      Ativar
                    </span>
                  </button>
                ));
              })()}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPointDeviceSelector(false);
                setBillSubmitting(false);
                setSubmitting(false);
              }}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-secondary)',
                padding: '0.65rem',
                borderRadius: '30px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                marginTop: '0.25rem'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lightbox de Pagamento via Point */}
      {showPointLightbox && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '20px',
            padding: '2.5rem 2rem',
            maxWidth: '420px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5), 0 10px 10px -5px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem'
          }}>
            {/* Ícone */}
            <div style={{
              position: 'relative',
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(59, 130, 246, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '0.5rem'
            }}>
              <CreditCard size={36} style={{ color: '#3b82f6' }} />
              <div style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                border: '2px dashed rgba(59, 130, 246, 0.3)'
              }} />
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Aguardando Maquininha</h3>
              <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Envio realizado para a <strong>{pointDeviceLabel}</strong>
              </p>
            </div>

            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '1rem',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem'
            }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Valor da Cobrança</span>
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--primary-gold)' }}>
                R$ {pointAmount.toFixed(2).replace('.', ',')}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#60a5fa', fontWeight: 600 }}>
                Modo: {pointType === 'debito' ? '💳 Débito' : '💳 Crédito'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#34d399', fontSize: '0.85rem', fontWeight: 600 }}>
              <div className="status-dot status-open" style={{ width: '8px', height: '8px' }} />
              <span>Insira ou aproxime o cartão na maquininha...</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPointLightbox(false);
                setPointPaymentId('');
                setPointPaymentStatus('pending');
                alert('Pagamento cancelado na tela. A maquininha continuará ativa por alguns instantes.');
              }}
              style={{
                marginTop: '0.5rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                padding: '0.6rem 1.5rem',
                borderRadius: '30px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
            >
              Cancelar Pagamento
            </button>
          </div>
        </div>
      )}

      {showCloseBillModal && (
        <div
          className="lightbox-overlay"
          onClick={() => !billSubmitting && setShowCloseBillModal(false)}
          style={{ zIndex: 2000, alignItems: 'center', justifyContent: 'center', display: 'flex', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            className="lightbox-content animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '450px',
              maxWidth: '92%',
              background: '#0d1527',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '1.25rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.8)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              color: '#fff',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            {/* Cabeçalho */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🧾 Conta da Mesa {tableNumber}
              </h3>
              <button
                type="button"
                onClick={() => !billSubmitting && setShowCloseBillModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: '1.2rem', cursor: 'pointer' }}
                disabled={billSubmitting}
              >
                ✕
              </button>
            </div>

            {loadingBill ? (
              <div style={{ padding: '2rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <span className="spinner"></span>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Carregando dados da conta...</span>
              </div>
            ) : billError ? (
              <div className="auth-error-message">{billError}</div>
            ) : tableOrders.length === 0 ? (
              <div style={{ padding: '1.5rem 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                  Nenhum pedido ativo encontrado para esta mesa.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    if (tableNumber && user) {
                      const userDocRef = doc(db, 'users', user.uid);
                      await updateDoc(userDocRef, { tableNumber: null, updatedAt: new Date().toISOString() });
                      setTableNumber(null);
                      setOrderType('pickup');
                      sessionStorage.removeItem('donalu_mesa');
                    }
                    setShowCloseBillModal(false);
                  }}
                  className="auth-btn"
                  style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', width: 'auto', background: 'rgba(255,255,255,0.06)' }}
                >
                  Liberar Mesa
                </button>
              </div>
            ) : (() => {
              const totalConsumed = tableOrders.reduce((sum, o) => sum + o.total, 0);
              
              const paidOrders = tableOrders.filter(o => o.paymentMethod === 'pix' || o.paymentMethod === 'credito');
              const totalPaidOnline = paidOrders.reduce((sum, o) => sum + o.total, 0);

              const unpaidOrders = tableOrders.filter(o => 
                o.paymentMethod === 'pagar_final' || 
                o.paymentMethod === 'dinheiro' || 
                o.paymentMethod === 'debito'
              );
              const totalToPay = unpaidOrders.reduce((sum, o) => sum + o.total, 0);

              return (
                <>
                  {/* Lista de Pedidos */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                    <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Pedidos Realizados</span>
                    {tableOrders.map((order) => {
                      const isPaid = order.paymentMethod === 'pix' || order.paymentMethod === 'credito';
                      return (
                        <div key={order.id} style={{ padding: '0.6rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 700 }}>Pedido #{order.dailySeq || '---'}</span>
                            <span style={{ fontWeight: 700, color: isPaid ? '#10b981' : 'var(--primary-gold)' }}>
                              R$ {order.total.toFixed(2).replace('.', ',')} {isPaid ? '(Pago)' : '(Pagar no Final)'}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
                            {order.items.map((item: any, idx: number) => (
                              <div key={idx}>{item.quantity}x {item.name} - R$ {((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</div>
                            ))}
                            {(order.serviceFee ?? 0) > 0 && (
                              <div style={{ fontStyle: 'italic', color: 'var(--primary-gold)' }}>🪑 Taxa de Serviço (10%): R$ {order.serviceFee.toFixed(2).replace('.', ',')}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Resumo Financeiro */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      <span>Consumido Total:</span>
                      <span>R$ {totalConsumed.toFixed(2).replace('.', ',')}</span>
                    </div>
                    {totalPaidOnline > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#10b981', marginBottom: '0.25rem' }}>
                        <span>Pago Online (Pix/Crédito):</span>
                        <span>- R$ {totalPaidOnline.toFixed(2).replace('.', ',')}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700, borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '0.4rem', marginTop: '0.4rem' }}>
                      <span>Saldo Pendente a Pagar:</span>
                      <span style={{ color: 'var(--primary-gold)' }}>R$ {totalToPay.toFixed(2).replace('.', ',')}</span>
                    </div>
                  </div>

                  {totalToPay <= 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'center', marginTop: '0.5rem' }}>
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#10b981', fontWeight: 600 }}>
                        ✓ Todos os seus pedidos já estão pagos!
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          if (tableNumber && user) {
                            const userDocRef = doc(db, 'users', user.uid);
                            await updateDoc(userDocRef, { tableNumber: null, updatedAt: new Date().toISOString() });
                            setTableNumber(null);
                            setOrderType('pickup');
                            sessionStorage.removeItem('donalu_mesa');
                          }
                          setShowCloseBillModal(false);
                        }}
                        className="auth-btn"
                        style={{
                          padding: '0.6rem',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '10px',
                          cursor: 'pointer',
                          fontWeight: 700
                        }}
                      >
                        Liberar Mesa e Sair
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Seleção de Pagamento */}
                      <div>
                        <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>Pagar Saldo Devedor Via</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                          {(() => {
                            return [
                              ['pix', 'Pix 🟡'],
                              ['credito', 'Crédito Online 💳'],
                              ['google_pay', 'Google Pay 📱'],
                              ['debito_point', 'Débito Maquininha 💴'],
                              ['credito_point', 'Crédito Maquininha 💳'],
                              ['dinheiro', 'Dinheiro 💵']
                            ] as any;
                          })().map(([val, label]: [string, string]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => {
                                setBillPaymentMethod(val as any);
                                setBillChangeFor('');
                                setBillNoChangeNeeded(false);
                              }}
                              style={{
                                padding: '0.5rem',
                                borderRadius: '30px',
                                border: billPaymentMethod === val ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.15)',
                                background: billPaymentMethod === val ? 'rgba(245,158,11,0.16)' : '#000000',
                                color: billPaymentMethod === val ? 'var(--primary-gold)' : '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.35rem',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                              }}
                            >
                              {val === 'google_pay' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#ffffff' }}>
                                  Pagar com <GooglePayLogo height="12px" color="#ffffff" />
                                </span>
                              ) : val === 'pix' ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                  Pix <QrCode size={12} style={{ color: billPaymentMethod === val ? 'var(--primary-gold)' : '#ffffff' }} />
                                </span>
                              ) : (
                                label
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Configuração de Troco */}
                      {billPaymentMethod === 'dinheiro' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.02)', padding: '0.6rem', borderRadius: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                              type="checkbox"
                              id="bill-no-change-needed"
                              checked={billNoChangeNeeded}
                              onChange={(e) => {
                                setBillNoChangeNeeded(e.target.checked);
                                if (e.target.checked) setBillChangeFor('');
                              }}
                              style={{ width: '15px', height: '15px', accentColor: 'var(--primary-gold)' }}
                            />
                            <label htmlFor="bill-no-change-needed" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>Não preciso de troco</label>
                          </div>
                          {!billNoChangeNeeded && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Troco para quanto?</label>
                              <input
                                type="text"
                                className="pastel-edit-input"
                                placeholder="Ex: 50"
                                value={billChangeFor}
                                onChange={(e) => setBillChangeFor(e.target.value.replace(/\D/g, ''))}
                                style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* PagBank Cartão de Crédito */}
                      {billPaymentMethod === 'credito' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.6rem', borderRadius: '10px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontWeight: 600 }}>💳 Informações do Cartão de Crédito (PagBank)</span>
                          {userData?.pagbank_card_token && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                              <input
                                type="checkbox"
                                id="bill-use-saved-card"
                                checked={useSavedCard}
                                onChange={(e) => setUseSavedCard(e.target.checked)}
                                style={{ width: '15px', height: '15px', accentColor: 'var(--primary-gold)' }}
                              />
                              <label htmlFor="bill-use-saved-card" style={{ fontSize: '0.78rem', cursor: 'pointer' }}>
                                Usar meu cartão salvo (final {userData.pagbank_card_last_digits})
                              </label>
                            </div>
                          )}
                          {(!useSavedCard || !userData?.pagbank_card_token) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Número do Cartão</label>
                                <input
                                  type="text"
                                  className="pastel-edit-input"
                                  placeholder="0000 0000 0000 0000"
                                  value={cardNumber}
                                  onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 '))}
                                  maxLength={19}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Nome no Cartão</label>
                                <input
                                  type="text"
                                  className="pastel-edit-input"
                                  placeholder="Nome impresso"
                                  value={cardHolder}
                                  onChange={(e) => setCardHolder(e.target.value)}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                />
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Validade (MM/AA)</label>
                                  <input
                                    type="text"
                                    className="pastel-edit-input"
                                    placeholder="MM/AA"
                                    value={cardExpiry}
                                    onChange={(e) => {
                                      let v = e.target.value.replace(/\D/g, '');
                                      if (v.length > 2) v = v.substring(0, 2) + '/' + v.substring(2, 4);
                                      setCardExpiry(v);
                                    }}
                                    maxLength={5}
                                    style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>CVV</label>
                                  <input
                                    type="text"
                                    className="pastel-edit-input"
                                    placeholder="123"
                                    value={cardCvv}
                                    onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ''))}
                                    maxLength={4}
                                    style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                  />
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>CPF do Titular</label>
                                <input
                                  type="text"
                                  className="pastel-edit-input"
                                  placeholder="CPF do proprietário do cartão"
                                  value={clientCpf}
                                  onChange={(e) => {
                                    let v = e.target.value.replace(/\D/g, '');
                                    if (v.length <= 11) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                                    setClientCpf(v);
                                  }}
                                  maxLength={14}
                                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                                />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  id="bill-save-card"
                                  checked={saveCardConsent}
                                  onChange={(e) => setSaveCardConsent(e.target.checked)}
                                  style={{ width: '15px', height: '15px', accentColor: 'var(--primary-gold)' }}
                                />
                                <label htmlFor="bill-save-card" style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>Salvar cartão para futuras compras</label>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Botão de Submissão */}
                      {billPaymentMethod === 'pix' ? (
                        <button
                          type="button"
                          onClick={handleCloseBillPix}
                          disabled={billSubmitting}
                          className="auth-btn"
                          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', fontWeight: 700, padding: '0.7rem' }}
                        >
                          {billSubmitting ? 'Gerando Pix...' : `Pagar R$ ${totalToPay.toFixed(2).replace('.', ',')} via Pix`}
                        </button>
                      ) : billPaymentMethod === 'credito' ? (
                        <button
                          type="button"
                          onClick={(e) => handleCloseBillCreditCard(e)}
                          disabled={billSubmitting}
                          className="auth-btn"
                          style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', fontWeight: 700, padding: '0.7rem' }}
                        >
                          {billSubmitting ? 'Processando Cartão...' : `Pagar R$ ${totalToPay.toFixed(2).replace('.', ',')} via Cartão`}
                        </button>
                      ) : billPaymentMethod === 'google_pay' ? (
                        <button
                          type="button"
                          onClick={handleCloseBillGooglePay}
                          disabled={billSubmitting}
                          className="auth-btn"
                          style={{ background: 'linear-gradient(135deg, #000000 0%, #202020 100%)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontWeight: 700, padding: '0.7rem' }}
                        >
                          {billSubmitting ? 'Iniciando Google Pay...' : `Pagar R$ ${totalToPay.toFixed(2).replace('.', ',')} via Google Pay`}
                        </button>
                      ) : (billPaymentMethod === 'debito_point' || billPaymentMethod === 'credito_point') ? (
                        <button
                          type="button"
                          onClick={() => handleTriggerPointPaymentFlow(totalToPay, billPaymentMethod === 'debito_point' ? 'debito' : 'credito', 'close_bill')}
                          disabled={billSubmitting}
                          className="auth-btn"
                          style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', fontWeight: 700, padding: '0.7rem' }}
                        >
                          {billSubmitting ? 'Acionando Maquininha...' : `Pagar R$ ${totalToPay.toFixed(2).replace('.', ',')} na Maquininha`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleCloseBillCashier}
                          disabled={billSubmitting || (billPaymentMethod === 'dinheiro' && !billNoChangeNeeded && billChangeFor.trim() === '')}
                          className="auth-btn"
                          style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', fontWeight: 700, padding: '0.7rem' }}
                        >
                          {billSubmitting ? 'Enviando...' : `Chamar Caixa para Pagar R$ ${totalToPay.toFixed(2).replace('.', ',')}`}
                        </button>
                      )}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Lightbox do Pix para Fechamento de Conta */}
      {showBillPixLightbox && (
        <div
          className="lightbox-overlay"
          style={{ zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)' }}
          onClick={() => setShowBillPixLightbox(false)}
        >
          <div
            className="lightbox-content animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '380px',
              maxWidth: '92%',
              background: '#0d1527',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '1.25rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              color: '#fff'
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>🔑 Pagamento via Pix (Mesa {tableNumber})</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Escaneie o QR Code abaixo com o aplicativo do seu banco ou copie o código Pix.
            </p>
            {billPixQrCodeBase64 ? (
              <img
                src={`data:image/png;base64,${billPixQrCodeBase64}`}
                alt="Pix QR Code"
                style={{ width: '180px', height: '180px', margin: '0 auto', borderRadius: '8px', background: '#fff', padding: '6px' }}
              />
            ) : (
              <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="spinner"></span>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(billPixQrCode);
                alert('Código Pix copiado com sucesso!');
              }}
              className="auth-btn"
              style={{ padding: '0.5rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.06)' }}
            >
              Copiar Código Pix
            </button>
            <div style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
              <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span>
              Aguardando confirmação de pagamento...
            </div>
            <button
              type="button"
              onClick={() => setShowBillPixLightbox(false)}
              className="auth-btn btn-danger"
              style={{ padding: '0.5rem', fontSize: '0.85rem' }}
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {showTableScannerModal && (
        <div
          className="lightbox-overlay animate-fade-in"
          style={{
            zIndex: 4000,
            alignItems: 'center',
            justifyContent: 'center',
            display: 'flex',
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(5, 5, 8, 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)'
          }}
          onClick={() => setShowTableScannerModal(false)}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #16121e 0%, #0d0a11 100%)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '24px',
              padding: '1.5rem',
              width: '90%',
              maxWidth: '400px',
              maxHeight: 'min(90vh, 90dvh)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
              position: 'relative',
              color: '#fff'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fechar */}
            <button
              type="button"
              onClick={() => setShowTableScannerModal(false)}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <X size={16} />
            </button>

            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--primary-gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Leitura de QR Code
              </span>
              <h3 style={{ margin: '0.2rem 0 0.4rem', fontSize: '1.3rem', color: '#fff', fontWeight: 800 }}>
                Escaneie o QR Code da Mesa
              </h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: '1.4' }}>
                Aponte a câmera para o QR Code localizado na sua mesa.
              </p>
            </div>

            {/* Container do Scanner da Câmera */}
            <div 
              style={{ 
                width: '100%', 
                borderRadius: '16px', 
                overflow: 'hidden', 
                background: '#000', 
                border: '1px solid rgba(255,255,255,0.08)',
                position: 'relative',
                aspectRatio: '1'
              }}
            >
              <div id="qr-reader" style={{ width: '100%', height: '100%' }}></div>
              {scannerError && (
                <div style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '100%', 
                  height: '100%', 
                  background: 'rgba(0,0,0,0.85)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  padding: '1.5rem', 
                  textAlign: 'center',
                  color: '#f87171',
                  fontSize: '0.85rem',
                  lineHeight: '1.4'
                }}>
                  <div>
                    <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>📷</span>
                    {scannerError}
                  </div>
                </div>
              )}
            </div>

            {/* Alternativa: Seleção Manual */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Dificuldade para escanear? Escolha a mesa abaixo:
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  value={manualTableInput}
                  onChange={(e) => setManualTableInput(e.target.value)}
                  style={{
                    flex: 1.2,
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.9rem',
                    color: '#fff',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="" style={{ background: '#0d0a11', color: 'var(--text-secondary)' }}>Mesa...</option>
                  {Array.from({ length: activeTablesCount }, (_, i) => i + 1).map((num) => (
                    <option key={num} value={String(num)} style={{ background: '#0d0a11', color: '#fff' }}>
                      Mesa {num}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const tableVal = manualTableInput.trim();
                    if (!tableVal) {
                      alert('Por favor, selecione uma mesa.');
                      return;
                    }
                    await handleLinkTable(tableVal);
                    setShowTableScannerModal(false);
                    setManualTableInput('');
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--primary-gold)',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.65rem 0.75rem',
                    color: '#000',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Confirmar
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTableScannerModal(false)}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                padding: '0.65rem',
                color: 'var(--text-secondary)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default ClientDashboard;
