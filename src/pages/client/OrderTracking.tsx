import { useEffect, useState, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { OrderDocument } from '../../types/order';
import { Clock, MapPin, ClipboardList, ChefHat, ShoppingBag, Navigation, CheckCircle, HelpCircle } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

// Sub-componente para isolar a renderização do mapa Leaflet para cada pedido
interface OrderMapProps {
  orderId: string;
  clientName: string;
  address: any;
  deliveryCoords?: { lat: number; lng: number };
}

const OrderMap = ({ orderId, clientName, address, deliveryCoords }: OrderMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; current?: L.Marker; destination?: L.Marker; polyline?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  const getFallbackCoords = (id: string): [number, number] => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const latOffset = ((hash % 20) - 10) / 400;
    const lngOffset = ((hash % 17) - 8) / 400;
    return [DONA_LU_COORDS[0] + latOffset, DONA_LU_COORDS[1] + lngOffset];
  };

  useEffect(() => {
    if (!address) return;
    const queryStr = `${address.street}, ${address.number}, ${address.neighborhood}, Campo Grande, Rio de Janeiro`;
    
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStr)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.length > 0) {
          setDestCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        } else {
          setDestCoords(getFallbackCoords(orderId));
        }
      })
      .catch(() => {
        setDestCoords(getFallbackCoords(orderId));
      });
  }, [address, orderId]);

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

export const OrderTracking = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulatingOrderId, setSimulatingOrderId] = useState<string | null>(null);

  const startSimulation = async (order: OrderDocument) => {
    if (simulatingOrderId) return;
    setSimulatingOrderId(order.id!);

    let dest: [number, number] = DONA_LU_COORDS;
    const addr = order.address;
    const queryStr = `${addr.street}, ${addr.number}, ${addr.neighborhood}, Campo Grande, Rio de Janeiro`;
    
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStr)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        dest = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      } else {
        const hash = order.id!.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const latOffset = ((hash % 20) - 10) / 400;
        const lngOffset = ((hash % 17) - 8) / 400;
        dest = [DONA_LU_COORDS[0] + latOffset, DONA_LU_COORDS[1] + lngOffset];
      }
    } catch {
      const hash = order.id!.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const latOffset = ((hash % 20) - 10) / 400;
      const lngOffset = ((hash % 17) - 8) / 400;
      dest = [DONA_LU_COORDS[0] + latOffset, DONA_LU_COORDS[1] + lngOffset];
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
  const activeOrders = orders.filter((o) => o.status !== 'completed');
  const pastOrders = orders.filter((o) => o.status === 'completed').slice(0, 5); // Últimos 5 concluídos

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
                        <span className="welcome-msg" style={{ fontSize: '0.8rem' }}>Cod: #{order.id?.slice(-4).toUpperCase()}</span>
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

                  {/* Stepper de Status */}
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
                border: '1px solid rgba(255, 255, 255, 0.03)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <strong style={{ color: '#fff' }}>Pedido #{order.id?.slice(-4).toUpperCase()}</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>{formatOrderDate(order.createdAt)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-secondary)', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {order.items.map((it) => `${it.quantity}x ${it.name}`).join(', ')}
                  </span>
                  <strong style={{ color: 'var(--primary-gold)' }}>
                    R$ {order.total.toFixed(2).replace('.', ',')}
                  </strong>
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
