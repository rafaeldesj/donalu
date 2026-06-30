import { useEffect, useState, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { OrderDocument } from '../../types/order';
import { Clock, ClipboardList, ChefHat, ShoppingBag, Navigation, CheckCircle } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodeAddress } from '../../utils/geocoding';
import { API_BASE_URL } from '../../config/api';


const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

// Sub-componente para isolar a renderização do mapa Leaflet para cada pedido
interface OrderMapProps {
  orderId: string;
  clientName: string;
  address: any;
  deliveryCoords?: { lat: number; lng: number };
  clientCoords?: { lat: number; lng: number };
}

const OrderMap = ({ orderId, address, deliveryCoords, clientCoords }: OrderMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; current?: L.Marker; destination?: L.Marker; polyline?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (clientCoords) {
      setDestCoords([clientCoords.lat, clientCoords.lng]);
      return;
    }

    if (!address) return;
    geocodeAddress(address.street, address.number, address.neighborhood)
      .then((coords) => {
        setDestCoords(coords);
      })
      .catch(() => {
        setDestCoords(DONA_LU_COORDS);
      });
  }, [address, orderId, clientCoords]);

  useEffect(() => {
    if (!mapContainerRef.current || !destCoords) return;

    // Inicializa mapa Leaflet caso não exista
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false
      }).setView(DONA_LU_COORDS, 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Adiciona evento de clique para abrir o Google Maps
    map.off('click');
    map.on('click', () => {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${destCoords[0]},${destCoords[1]}&travelmode=driving`, '_blank');
    });

    // Remove camadas antigas
    if (markersRef.current.origin) map.removeLayer(markersRef.current.origin);
    if (markersRef.current.current) map.removeLayer(markersRef.current.current);
    if (markersRef.current.destination) map.removeLayer(markersRef.current.destination);
    if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

    const originIcon = L.divIcon({
      html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">🏠</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const deliveryIcon = L.divIcon({
      html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">🏍️</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const destIcon = L.divIcon({
      html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">📍</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    markersRef.current.origin = L.marker(DONA_LU_COORDS, { icon: originIcon })
      .addTo(map)
      .bindPopup('<b>Dona Lu Pastelaria</b><br/>Seu pastel saiu daqui!');

    markersRef.current.destination = L.marker(destCoords, { icon: destIcon })
      .addTo(map)
      .bindPopup(`<b>Sua Casa</b><br/>Endereço de Entrega`);

    const currentLoc: [number, number] = deliveryCoords ? [deliveryCoords.lat, deliveryCoords.lng] : DONA_LU_COORDS;
    markersRef.current.current = L.marker(currentLoc, { icon: deliveryIcon })
      .addTo(map)
      .bindPopup('<b>Entregador (Em Rota)</b>');

    // Busca rota real pelas ruas via OSRM API
    const coordsStr = `${DONA_LU_COORDS[1]},${DONA_LU_COORDS[0]};${currentLoc[1]},${currentLoc[0]};${destCoords[1]},${destCoords[0]}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        let routePoints: [number, number][] = [DONA_LU_COORDS, currentLoc, destCoords];
        if (data.routes && data.routes.length > 0) {
          const rawCoords = data.routes[0].geometry.coordinates; // Array de [lng, lat]
          routePoints = rawCoords.map((c: any) => [c[1], c[0]]); // Converte para [lat, lng]
        }
        
        if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

        const polyline = L.polyline(routePoints, {
          color: '#f59e0b',
          weight: 4,
          opacity: 0.8,
          dashArray: '6, 10'
        }).addTo(map);
        markersRef.current.polyline = polyline;

        // Enquadra a câmera na rota real pelas ruas
        const bounds = L.latLngBounds(routePoints);
        map.fitBounds(bounds, { padding: [40, 40] });
      })
      .catch(err => {
        console.error("Erro ao buscar rota OSRM:", err);
        // Fallback para linha reta se falhar
        if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

        const points = [DONA_LU_COORDS, currentLoc, destCoords];
        const polyline = L.polyline(points, {
          color: '#f59e0b',
          weight: 4,
          opacity: 0.8,
          dashArray: '6, 10'
        }).addTo(map);
        markersRef.current.polyline = polyline;

        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [40, 40] });
      });

  }, [destCoords, deliveryCoords]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Navigation size={14} className="pulse-dot-green" /> Acompanhe o entregador no mapa:
      </span>
      <div style={{ position: 'relative', width: '100%', height: '280px', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', zIndex: 1 }}>
        <div 
          ref={mapContainerRef} 
          style={{ width: '100%', height: '100%', cursor: 'pointer' }} 
          title="Clique no mapa para abrir rota no Google Maps" 
        />
        <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 999, background: 'rgba(10,7,7,0.85)', padding: '0.35rem 0.75rem', borderRadius: '20px', fontSize: '0.7rem', color: 'var(--primary-gold)', border: '1px solid rgba(245, 158, 11, 0.3)', pointerEvents: 'none', fontWeight: 600 }}>
          Abrir Google Maps 🗺️
        </div>
      </div>
    </div>
  );
};


interface PaymentRetryProps {
  order: OrderDocument;
  userData: any;
}

const OrderPaymentRetry = ({ order, userData }: PaymentRetryProps) => {
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credito' | 'debito' | 'dinheiro'>('pix');
  const [changeFor, setChangeFor] = useState('');
  
  // Card states
  const [useSavedCard, setUseSavedCard] = useState(true);
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [clientCpf, setClientCpf] = useState(userData?.cpf || '');
  const [saveCardConsent, setSaveCardConsent] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userData?.cpf) {
      setClientCpf(userData.cpf);
    }
  }, [userData]);

  const handleRetryPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      let finalStatus = 'pending';
      
      if (paymentMethod === 'dinheiro' || paymentMethod === 'debito') {
        finalStatus = 'aguardando_caixa';
      } else if (paymentMethod === 'credito') {
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
            orderTotal: order.total,
            clientName: userData?.name || userData?.email || 'Cliente',
            clientEmail: userData?.email || '',
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
          const userDocRef = doc(db, 'users', userData.uid);
          await updateDoc(userDocRef, {
            cpf: clientCpf.replace(/\D/g, ''),
            pagbank_customer_id: result.card.customer_id,
            pagbank_card_token: result.card.card_token,
            pagbank_card_brand: result.card.brand,
            pagbank_card_last_digits: result.card.last_digits,
            updatedAt: new Date().toISOString()
          });
        }

        finalStatus = 'preparing';
      }

      const orderDocRef = doc(db, 'orders', order.id!);
      await updateDoc(orderDocRef, {
        status: finalStatus,
        paymentMethod: paymentMethod,
        changeFor: paymentMethod === 'dinheiro' && changeFor ? parseFloat(changeFor.replace(',', '.')) : null,
      });

      alert('Pagamento atualizado com sucesso! O pedido foi enviado.');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao processar o pagamento. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: '1rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '16px', padding: '1.25rem', textAlign: 'left' }}>
      <h4 style={{ margin: '0 0 0.5rem 0', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1rem' }}>
        ⚠️ Pagamento Pendente / Recusado
      </h4>
      <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
        Por favor, selecione outra forma de pagamento abaixo para prosseguir com seu pedido de <strong>R$ {order.total.toFixed(2).replace('.', ',')}</strong>.
      </p>

      {error && <div className="auth-error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

      <form onSubmit={handleRetryPayment} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          {([['pix','Pix 🟡'],['credito','Crédito 💳'],['debito','Débito 💴'],['dinheiro','Dinheiro 💵']] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setPaymentMethod(val)}
              style={{
                padding: '0.6rem 0.5rem',
                borderRadius: '10px',
                border: paymentMethod === val ? '2px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)',
                background: paymentMethod === val ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.02)',
                color: paymentMethod === val ? 'var(--primary-gold)' : 'var(--text-secondary)',
                fontWeight: paymentMethod === val ? 700 : 400,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textAlign: 'center',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {paymentMethod === 'dinheiro' && (
          <div style={{ marginTop: '0.3rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
              Troco para quanto? (opcional)
            </label>
            <input
              type="number"
              className="pastel-edit-input"
              style={{ marginBottom: 0, maxWidth: '180px' }}
              placeholder="Ex: 50,00"
              value={changeFor}
              onChange={(e) => setChangeFor(e.target.value)}
              min="0"
              step="0.01"
            />
          </div>
        )}

        {paymentMethod === 'credito' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', marginTop: '0.25rem' }}>
            {userData?.pagbank_card_token ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: useSavedCard ? '0' : '0.5rem' }}>
                <input
                  type="checkbox"
                  id={`use-saved-card-retry-${order.id}`}
                  checked={useSavedCard}
                  onChange={(e) => setUseSavedCard(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: 'var(--primary-gold)' }}
                />
                <label htmlFor={`use-saved-card-retry-${order.id}`} style={{ fontSize: '0.9rem', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Usar cartão salvo ({userData.pagbank_card_brand?.toUpperCase()} final **** {userData.pagbank_card_last_digits})
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
                    id={`save-card-consent-retry-${order.id}`}
                    checked={saveCardConsent}
                    onChange={(e) => setSaveCardConsent(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--primary-gold)' }}
                  />
                  <label htmlFor={`save-card-consent-retry-${order.id}`} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    salvar meus dados de pagamento para usar novamente na proxima vez
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="auth-btn auth-btn-login"
          style={{ marginTop: '0.5rem', padding: '0.75rem', fontSize: '0.95rem', fontWeight: 700 }}
        >
          {submitting ? (
            <><span className="spinner" /><span>Processando pagamento...</span></>
          ) : (
            <span>Tentar Pagamento Novamente</span>
          )}
        </button>
      </form>
    </div>
  );
};

export const OrderTracking = () => {
  const { user, userData } = useAuth();
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulatingOrderId, setSimulatingOrderId] = useState<string | null>(null);

  const startSimulation = async (order: OrderDocument) => {
    if (simulatingOrderId) return;
    setSimulatingOrderId(order.id!);

    let dest: [number, number] = DONA_LU_COORDS;
    if (order.clientCoords) {
      dest = [order.clientCoords.lat, order.clientCoords.lng];
    } else {
      const addr = order.address;
      try {
        dest = await geocodeAddress(addr.street, addr.number, addr.neighborhood);
      } catch (err) {
        console.warn("Erro ao geocodificar na simulação:", err);
        dest = DONA_LU_COORDS;
      }
    }

    // Busca rota real pelas ruas via OSRM para a simulação
    let routePoints: [number, number][] = [];
    try {
      const coordsStr = `${DONA_LU_COORDS[1]},${DONA_LU_COORDS[0]};${dest[1]},${dest[0]}`;
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
      const routeRes = await fetch(url);
      const routeData = await routeRes.json();
      if (routeData.routes && routeData.routes.length > 0) {
        const rawCoords = routeData.routes[0].geometry.coordinates; // [lng, lat]
        routePoints = rawCoords.map((c: any) => [c[1], c[0]]); // Converte para [lat, lng]
      }
    } catch (err) {
      console.error("Erro ao buscar rota OSRM para simulação:", err);
    }

    const orderDocRef = doc(db, 'orders', order.id!);
    await updateDoc(orderDocRef, {
      status: 'delivering',
      deliveryCoords: { lat: DONA_LU_COORDS[0], lng: DONA_LU_COORDS[1] }
    });

    let step = 0;
    const totalSteps = 15;

    const interval = setInterval(async () => {
      step++;
      if (step > totalSteps) {
        clearInterval(interval);
        await updateDoc(orderDocRef, {
          status: 'completed'
        });
        setSimulatingOrderId(null);
        alert("Simulação de entrega concluída!");
        return;
      }

      let currentLat = DONA_LU_COORDS[0];
      let currentLng = DONA_LU_COORDS[1];

      if (routePoints.length > 0) {
        const idx = Math.round((step / totalSteps) * (routePoints.length - 1));
        const pt = routePoints[idx];
        currentLat = pt[0];
        currentLng = pt[1];
      } else {
        const ratio = step / totalSteps;
        currentLat = DONA_LU_COORDS[0] + (dest[0] - DONA_LU_COORDS[0]) * ratio;
        currentLng = DONA_LU_COORDS[1] + (dest[1] - DONA_LU_COORDS[1]) * ratio;
      }

      await updateDoc(orderDocRef, {
        deliveryCoords: { lat: currentLat, lng: currentLng }
      });
    }, 1000);
  };

  // Escuta pedidos em tempo real associados ao cliente
  useEffect(() => {
    if (!user) return;

    // Filtra pelo ID do cliente logado no lado do Firestore
    const q = query(
      collection(db, 'orders'),
      where('clientUid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        } as OrderDocument);
      });

      // Ordenação decrescente baseada no createdAt do lado do cliente
      fetched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setOrders(fetched);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao assinar reatividade de pedidos:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '250px', margin: '3rem auto' }}>
        <span className="spinner"></span>
        <span>Carregando seus pedidos...</span>
      </div>
    );
  }

  // Divide os pedidos em Ativos (não finalizados) e Histórico Recente
  const activeOrders = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled');
  const pastOrders = orders.filter((o) => o.status === 'completed' || o.status === 'cancelled').slice(0, 5); // Últimos 5 concluídos ou cancelados

  const formatOrderDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Retorna os dados do Stepper de acordo com o status e tipo do pedido
  const getStepperConfig = (order: OrderDocument) => {
    const isDelivery = !!order.address;

    if (isDelivery) {
      // 5 etapas para entrega
      const steps = [
        { label: 'Recebido', icon: ClipboardList, status: 'pending' },
        { label: 'Na Cozinha', icon: ChefHat, status: 'preparing' },
        { label: 'Pronto', icon: ShoppingBag, status: 'ready' },
        { label: 'Em Rota', icon: Navigation, status: 'delivering' },
        { label: 'Entregue', icon: CheckCircle, status: 'completed' }
      ];

      let activeIndex = 0;
      if (order.status === 'preparing') activeIndex = 1;
      else if (order.status === 'ready') activeIndex = 2;
      else if (order.status === 'delivering') activeIndex = 3;
      else if (order.status === 'completed') activeIndex = 4;

      const progressWidth = `${(activeIndex / (steps.length - 1)) * 100}%`;

      return { steps, activeIndex, progressWidth };
    } else {
      // 4 etapas para retirada no balcão
      const steps = [
        { label: 'Recebido', icon: ClipboardList, status: 'pending' },
        { label: 'Na Cozinha', icon: ChefHat, status: 'preparing' },
        { label: 'No Balcão', icon: ShoppingBag, status: 'ready' },
        { label: 'Retirado', icon: CheckCircle, status: 'completed' }
      ];

      let activeIndex = 0;
      if (order.status === 'preparing') activeIndex = 1;
      else if (order.status === 'ready') activeIndex = 2;
      else if (order.status === 'completed') activeIndex = 3;

      const progressWidth = `${(activeIndex / (steps.length - 1)) * 100}%`;

      return { steps, activeIndex, progressWidth };
    }
  };

  // Status descritivo para exibir no cabeçalho do pedido
  const getStatusText = (status: string, isDelivery: boolean) => {
    switch (status) {
      case 'pending': return 'Recebido pela cozinha';
      case 'preparing': return 'Sendo preparado';
      case 'ready': return isDelivery ? 'Pronto na expedição' : 'Aguardando retirada no balcão!';
      case 'delivering': return 'Saiu para entrega';
      case 'completed': return 'Finalizado com sucesso';
      default: return 'Desconhecido';
    }
  };

  return (
    <div className="dashboard-layout animate-fade-in">
      <div className="dashboard-header">
        <h2>Acompanhe seu pedido 🛵</h2>
        <p>Acompanhe o andamento dos seus pastéis quentinhos em tempo real.</p>
      </div>

      <div className="tracking-grid">
        
        {/* Seção Principal: Pedidos Ativos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem', textAlign: 'left' }}>
            Pedidos em Andamento ({activeOrders.length})
          </h3>

          {activeOrders.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.01)',
              border: '1px dashed rgba(255,255,255,0.08)',
              borderRadius: '16px',
              padding: '3rem',
              color: 'var(--text-secondary)',
              textAlign: 'center'
            }}>
              <Clock size={36} style={{ margin: '0 auto 1rem auto', opacity: 0.6 }} />
              <p style={{ margin: 0, fontSize: '0.95rem' }}>Você não possui nenhum pedido ativo no momento.</p>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>Faça suas escolhas no Cardápio Digital! 🥟</p>
            </div>
          ) : (
            activeOrders.map((order) => {
              const isDelivery = !!order.address;
              const { steps, activeIndex, progressWidth } = getStepperConfig(order);

              return (
                <div key={order.id} className="order-tracking-card">
                  {/* Cabeçalho do Pedido */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="welcome-msg" style={{ fontSize: '0.8rem' }}>
                          {order.dailySeq ? (
                            userData?.role === 'developer' ? (
                              `Pedido ${order.dailySeq} (#${order.id?.slice(-4).toUpperCase()})`
                            ) : (
                              `Pedido ${order.dailySeq}`
                            )
                          ) : (
                            `Cod: #${order.id?.slice(-4).toUpperCase()}`
                          )}
                        </span>
                        {isDelivery && order.status !== 'completed' && (
                          <button
                            type="button"
                            onClick={() => startSimulation(order)}
                            disabled={simulatingOrderId !== null}
                            style={{
                              background: 'rgba(245, 158, 11, 0.1)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              color: 'var(--primary-gold)',
                              fontSize: '0.7rem',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              cursor: simulatingOrderId ? 'not-allowed' : 'pointer',
                              fontWeight: 600
                            }}
                          >
                            {simulatingOrderId === order.id ? 'Simulando GPS...' : '⚡ Simular Rota GPS'}
                          </button>
                        )}
                      </div>
                      <h4 style={{ margin: '0.15rem 0 0 0', fontSize: '1.15rem', color: '#fff' }}>
                        {getStatusText(order.status, isDelivery)}
                      </h4>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatOrderDate(order.createdAt)}</span>
                      <p style={{ margin: '0.15rem 0 0 0', color: 'var(--primary-gold)', fontWeight: 700 }}>
                        Total: R$ {order.total.toFixed(2).replace('.', ',')}
                      </p>
                    </div>
                  </div>

                  {/* Stepper de Status ou Re-pagamento */}
                  {!order.paymentMethod ? (
                    <OrderPaymentRetry order={order} userData={userData} />
                  ) : (
                    <div className="stepper-container">
                      <div className="stepper-line">
                        <div className="stepper-line-progress" style={{ width: progressWidth }} />
                      </div>

                      {steps.map((step, idx) => {
                        const StepIcon = step.icon;
                        const isCompleted = idx < activeIndex;
                        const isActive = idx === activeIndex;
                        
                        let stateClass = 'upcoming';
                        if (isCompleted) stateClass = 'completed';
                        else if (isActive) stateClass = 'active';

                        return (
                          <div key={idx} className="stepper-step">
                            <div className={`step-icon-wrapper ${stateClass}`}>
                              <StepIcon size={16} />
                            </div>
                            <span className={`step-label ${stateClass === 'completed' ? 'completed' : stateClass === 'active' ? 'active' : ''}`}>
                              {step.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Detalhes de Endereço/Retirada */}
                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.85rem 1rem', borderRadius: '10px', marginTop: '1.5rem', fontSize: '0.9rem' }}>
                    {isDelivery ? (
                      <div>
                        <strong>Entrega Domiciliar:</strong>
                        <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>
                          {order.address.street}, {order.address.number} ({order.address.neighborhood})
                          {order.address.complement && <span style={{ fontStyle: 'italic' }}> - {order.address.complement}</span>}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <strong>Retirada Balcão:</strong>
                        <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>
                          Retire seu pedido diretamente na Dona Lu Pastelaria (Rua Jícara, 239 - Campo Grande).
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Rastreamento GPS com Mapa */}
                  {order.status === 'delivering' && order.address && (
                    <OrderMap 
                      orderId={order.id!}
                      clientName={order.clientName}
                      address={order.address}
                      deliveryCoords={order.deliveryCoords}
                      clientCoords={order.clientCoords}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Seção Lateral: Histórico de Pedidos Recentes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem', textAlign: 'left' }}>
            Histórico Recente
          </h3>

          {pastOrders.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.01)',
              border: '1px solid rgba(255,255,255,0.03)',
              borderRadius: '16px',
              padding: '2rem',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              fontSize: '0.9rem'
            }}>
              Nenhum pedido finalizado anteriormente.
            </div>
          ) : (
            pastOrders.map((order) => (
              <div key={order.id} style={{
                background: 'rgba(255, 255, 255, 0.01)',
                border: order.status === 'cancelled' ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(255, 255, 255, 0.03)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', alignItems: 'center' }}>
                  <strong style={{ color: '#fff' }}>
                    {order.dailySeq ? (
                      userData?.role === 'developer' ? (
                        `Pedido ${order.dailySeq} (#${order.id?.slice(-4).toUpperCase()})`
                      ) : (
                        `Pedido ${order.dailySeq}`
                      )
                    ) : (
                      `Pedido #${order.id?.slice(-4).toUpperCase()}`
                    )}
                  </strong>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    backgroundColor: order.status === 'cancelled' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: order.status === 'cancelled' ? '#f87171' : '#34d399'
                  }}>
                    {order.status === 'cancelled' ? 'Cancelado' : 'Concluído'}
                  </span>
                </div>
                {order.status === 'cancelled' && order.cancelReason && (
                  <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.25rem', fontStyle: 'italic' }}>
                    Motivo: {order.cancelReason}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.85rem', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-secondary)', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {order.items.map((it) => `${it.quantity}x ${it.name}`).join(', ')}
                  </span>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginRight: '0.5rem' }}>{formatOrderDate(order.createdAt)}</span>
                    <strong style={{ color: 'var(--primary-gold)' }}>
                      R$ {order.total.toFixed(2).replace('.', ',')}
                    </strong>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
};

export default OrderTracking;
