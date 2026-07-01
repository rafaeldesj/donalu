import { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { OrderDocument } from '../../types/order';
import { Play, Check, AlertTriangle, ShoppingBag, MapPin } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodeAddress } from '../../utils/geocoding';

const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

// ─────────────────────────────────────────────
// Mini mapa — pedidos disponíveis (antes de aceitar)
// ─────────────────────────────────────────────
interface MiniMapProps {
  orderId: string;
  address: any;
  clientCoords?: { lat: number; lng: number };
}

const MiniMap = ({ orderId, address, clientCoords }: MiniMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; dest?: L.Marker; poly?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  // Resolve as coordenadas do destino
  useEffect(() => {
    if (clientCoords) {
      setDestCoords([clientCoords.lat, clientCoords.lng]);
      return;
    }
    if (!address) return;
    geocodeAddress(address.street, address.number, address.neighborhood)
      .then(setDestCoords)
      .catch(() => setDestCoords(DONA_LU_COORDS));
  }, [address, orderId, clientCoords]);

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
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    const mkDest = L.divIcon({
      html: `<div style="font-size:20px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:translate(-2px,-4px)">📍</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [24, 24], iconAnchor: [12, 12],
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
        if (data.routes?.length) {
          pts = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
        }
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, { color: '#e28743', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
      })
      .catch(() => {
        const pts: [number, number][] = [DONA_LU_COORDS, destCoords];
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, { color: '#e28743', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });
      });

    // Clique abre Google Maps com rota configurada + navegação
    map.off('click');
    map.on('click', () => {
      window.open(
        `https://www.google.com/maps/dir/?api=1&origin=${DONA_LU_COORDS[0]},${DONA_LU_COORDS[1]}&destination=${destCoords[0]},${destCoords[1]}&travelmode=driving`,
        '_blank'
      );
    });
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

// ─────────────────────────────────────────────
// Mapa principal — entrega ativa
// ─────────────────────────────────────────────
interface ActiveMapProps {
  address: any;
  clientCoords?: { lat: number; lng: number };
  gpsCoords: [number, number] | null;
}

const ActiveMap = ({ address, clientCoords, gpsCoords }: ActiveMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; rider?: L.Marker; dest?: L.Marker; poly?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  // Resolve coordenadas do destino
  useEffect(() => {
    if (clientCoords) {
      setDestCoords([clientCoords.lat, clientCoords.lng]);
      return;
    }
    if (!address) return;
    geocodeAddress(address.street, address.number, address.neighborhood)
      .then(setDestCoords)
      .catch(() => setDestCoords(DONA_LU_COORDS));
  }, [address, clientCoords]);

  // Inicializa / atualiza o mapa quando destino ou GPS mudam
  useEffect(() => {
    if (!containerRef.current || !destCoords) return;

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView(DONA_LU_COORDS, 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);

      mapRef.current = map;
    }

    const map = mapRef.current;
    const riderLoc: [number, number] = gpsCoords ?? DONA_LU_COORDS;

    // Clique abre Google Maps com destino e navegação
    map.off('click');
    map.on('click', () => {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${destCoords[0]},${destCoords[1]}&travelmode=driving`,
        '_blank'
      );
    });

    // Remove camadas antigas
    if (markersRef.current.origin) map.removeLayer(markersRef.current.origin);
    if (markersRef.current.rider)  map.removeLayer(markersRef.current.rider);
    if (markersRef.current.dest)   map.removeLayer(markersRef.current.dest);
    if (markersRef.current.poly)   map.removeLayer(markersRef.current.poly);

    const mkOrigin = L.divIcon({
      html: `<div style="font-size:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:translate(-2px,-6px)">🏠</div>`,
      className: 'leaflet-div-icon-emoji', iconSize: [30, 30], iconAnchor: [15, 15],
    });
    const mkRider = L.divIcon({
      html: `<div style="font-size:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:translate(-2px,-6px)">🏍️</div>`,
      className: 'leaflet-div-icon-emoji', iconSize: [30, 30], iconAnchor: [15, 15],
    });
    const mkDest = L.divIcon({
      html: `<div style="font-size:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));transform:translate(-2px,-6px)">📍</div>`,
      className: 'leaflet-div-icon-emoji', iconSize: [30, 30], iconAnchor: [15, 15],
    });

    markersRef.current.origin = L.marker(DONA_LU_COORDS, { icon: mkOrigin })
      .addTo(map).bindPopup('<b>Dona Lu Pastelaria</b><br/>Ponto de Partida');
    markersRef.current.rider = L.marker(riderLoc, { icon: mkRider })
      .addTo(map).bindPopup('<b>Sua Posição (GPS)</b>');
    markersRef.current.dest = L.marker(destCoords, { icon: mkDest })
      .addTo(map).bindPopup('<b>Endereço do Cliente</b>');

    // Rota via OSRM: loja → entregador → cliente
    const coordsStr = `${DONA_LU_COORDS[1]},${DONA_LU_COORDS[0]};${riderLoc[1]},${riderLoc[0]};${destCoords[1]},${destCoords[0]}`;
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(data => {
        let pts: [number, number][] = [DONA_LU_COORDS, riderLoc, destCoords];
        if (data.routes?.length) {
          pts = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
        }
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, {
          color: '#f59e0b', weight: 5, opacity: 0.85, dashArray: '8, 12',
        }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [45, 45] });
      })
      .catch(() => {
        const pts: [number, number][] = [DONA_LU_COORDS, riderLoc, destCoords];
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, {
          color: '#f59e0b', weight: 5, opacity: 0.85, dashArray: '8, 12',
        }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [45, 45] });
      });

  }, [destCoords, gpsCoords]);

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
    <div className="admin-card-box" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem 0.75rem' }}>
        <MapPin size={16} style={{ color: 'var(--primary-gold)' }} />
        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Rota de Entrega</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Clique no mapa para abrir no Google Maps 🗺️
        </span>
      </div>
      <div style={{
        position: 'relative', flex: 1,
        borderRadius: '10px', overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.07)',
        cursor: 'pointer', zIndex: 1, minHeight: '340px',
      }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 999,
          background: 'rgba(10,7,7,0.85)', padding: '0.35rem 0.75rem',
          borderRadius: '20px', fontSize: '0.72rem',
          color: 'var(--primary-gold)', border: '1px solid rgba(245,158,11,0.3)',
          pointerEvents: 'none', fontWeight: 600,
        }}>
          Abrir Google Maps 🗺️
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// Componente principal — DeliveryActive
// ─────────────────────────────────────────────
export const DeliveryActive = () => {
  const { user, userData } = useAuth();
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [gpsCoords, setGpsCoords] = useState<[number, number] | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const getBusinessDay = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      const adjusted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
      const yyyy = adjusted.getFullYear();
      const mm = String(adjusted.getMonth() + 1).padStart(2, '0');
      const dd = String(adjusted.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    } catch {
      return '';
    }
  };

  const getOrderSequenceNumber = (orderId?: string, createdAt?: string): number => {
    if (!orderId || !createdAt) return 1;
    const oDay = getBusinessDay(createdAt);
    const sameDayOrders = orders
      .filter(o => getBusinessDay(o.createdAt) === oDay)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const index = sameDayOrders.findIndex(o => o.id === orderId);
    return index !== -1 ? index + 1 : 1;
  };

  const formatOrderHeader = (order: OrderDocument) => {
    const seqNum = order.dailySeq || getOrderSequenceNumber(order.id, order.createdAt);
    if (userData?.role === 'developer') {
      return `Pedido ${seqNum} (#${order.id?.slice(-4).toUpperCase()})`;
    }
    return `Pedido ${seqNum}`;
  };

  // Escuta todos os pedidos em tempo real
  useEffect(() => {
    const q = collection(db, 'orders');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({ id: docSnap.id, ...docSnap.data() } as OrderDocument);
      });
      setOrders(fetched);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao carregar pedidos:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Pedido ativo deste entregador
  const activeOrder = orders.find(
    (o) => o.status === 'delivering' && o.deliveryUid === user?.uid
  );

  // Pedidos disponíveis
  const availableOrders = orders.filter(
    (o) => o.status === 'ready' && o.address && !o.deliveryUid
  );

  // GPS do entregador em tempo real
  useEffect(() => {
    if (!activeOrder) {
      setGpsCoords(null);
      setGpsError(null);
      return;
    }
    if (!navigator.geolocation) {
      setGpsError('Seu navegador não suporta geolocalização.');
      return;
    }

    const update = () => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const { latitude, longitude } = coords;
          setGpsCoords([latitude, longitude]);
          setGpsError(null);
          updateDoc(doc(db, 'orders', activeOrder.id!), {
            deliveryCoords: { lat: latitude, lng: longitude },
          }).catch(err => console.error('Erro ao salvar GPS:', err));
        },
        (err) => {
          console.error('Erro GPS:', err);
          if (err.code === 1) setGpsError('Acesso à localização negado. O GPS é obrigatório para entregas!');
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [activeOrder]);

  const handleAcceptDelivery = async (orderId: string) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'delivering',
        deliveryUid: user?.uid,
        deliveryName: user?.displayName || user?.email || 'Entregador',
        deliveryCoords: { lat: DONA_LU_COORDS[0], lng: DONA_LU_COORDS[1] },
      });
    } catch (err) {
      console.error('Erro ao aceitar pedido:', err);
    }
  };

  const handleCompleteDelivery = async (orderId: string) => {
    if (!window.confirm('Confirmar que a entrega foi realizada e o pagamento recebido?')) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'completed' });
      setGpsCoords(null);
    } catch (err) {
      console.error('Erro ao concluir entrega:', err);
    }
  };

  if (loading) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '250px', margin: '3rem auto' }}>
        <span className="spinner" />
        <span>Carregando entregas...</span>
      </div>
    );
  }

  return (
    <div className="dashboard-layout animate-fade-in">
      <div className="dashboard-header">
        <h2>Entrega em Andamento 🏍️</h2>
        <p>Monitore sua rota ativa e aceite novos pedidos de delivery.</p>
      </div>

      {activeOrder ? (
        /* ── Entrega ativa: detalhes + mapa ── */
        <div className="delivery-active-grid">

          {/* Coluna esquerda — informações */}
          <div className="admin-card-box" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <span className="auth-role-badge" style={{ backgroundColor: '#3b82f620', color: '#60a5fa', fontSize: '0.8rem' }}>
                EM ROTA DE ENTREGA
              </span>
              <h3 style={{ margin: '0.5rem 0 0 0', fontSize: '1.25rem' }}>{formatOrderHeader(activeOrder)}</h3>
            </div>

            {/* Status GPS */}
            <div style={{
              background: gpsError ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.08)',
              borderLeft: `4px solid ${gpsError ? '#ef4444' : '#10b981'}`,
              color: gpsError ? '#f87171' : '#34d399',
              padding: '0.85rem', borderRadius: '8px',
              fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500,
            }}>
              {gpsError
                ? <AlertTriangle size={18} />
                : <div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#34d399' }} />
              }
              <span>{gpsError ?? 'Sinal de GPS Ativo: Rastreamento em tempo real obrigatório.'}</span>
            </div>

            {/* Dados do cliente */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.95rem' }}>
              <p style={{ margin: 0 }}><strong>Cliente:</strong> {activeOrder.clientName}</p>
              {activeOrder.clientPhone && (
                <p style={{ margin: 0 }}><strong>Celular:</strong> {activeOrder.clientPhone}</p>
              )}
              <p style={{ margin: 0 }}>
                <strong>Total a Receber:</strong>{' '}
                <span style={{ color: 'var(--primary-gold)', fontWeight: 700 }}>
                  R$ {activeOrder.total.toFixed(2).replace('.', ',')}
                </span>
              </p>
            </div>

            {/* Endereço */}
            <div style={{ background: 'rgba(0,0,0,0.15)', padding: '1rem', borderRadius: '10px' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Endereço de Entrega:</h4>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {activeOrder.address?.street}, {activeOrder.address?.number}<br />
                {activeOrder.address?.neighborhood} — Rio de Janeiro
                {activeOrder.address?.complement && (
                  <><br /><span>Complemento: {activeOrder.address.complement}</span></>
                )}
              </p>
            </div>

            {/* Itens */}
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '10px', maxHeight: '150px', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Itens do Pedido:</h4>
              {activeOrder.items.map((item, idx) => (
                <p key={idx} style={{ margin: '0.3rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  {item.quantity}x {item.name}
                </p>
              ))}
            </div>

            <button
              type="button"
              onClick={() => handleCompleteDelivery(activeOrder.id!)}
              className="btn-small btn-success"
              style={{ width: '100%', padding: '0.75rem', gap: '0.5rem', fontWeight: 600, fontSize: '0.95rem' }}
            >
              <Check size={18} /> Concluir Entrega (Pago)
            </button>
          </div>

          {/* Coluna direita — mapa de rota */}
          <ActiveMap
            address={activeOrder.address || undefined}
            clientCoords={activeOrder.clientCoords}
            gpsCoords={gpsCoords}
          />
        </div>
      ) : (
        /* ── Pedidos disponíveis para aceitar ── */
        <div className="admin-card-box">
          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingBag size={20} style={{ color: 'var(--primary-gold)' }} />
            Entregas Disponíveis ({availableOrders.length})
          </h3>

          {availableOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              Nenhum pedido pronto para entrega no balcão. Aguardando a cozinha...
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1.25rem' }}>
              {availableOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    padding: '1.25rem', borderRadius: '16px',
                    display: 'flex', flexDirection: 'column', gap: '0.75rem',
                  }}
                >
                  {/* Cabeçalho */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <strong>{formatOrderHeader(order)}</strong>
                    <span style={{ fontWeight: 700, color: 'var(--primary-gold)' }}>
                      R$ {order.total.toFixed(2).replace('.', ',')}
                    </span>
                  </div>

                  {/* Cliente */}
                  <div style={{ fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <p style={{ margin: 0 }}><strong>Cliente:</strong> {order.clientName}</p>
                    {order.clientPhone && (
                      <p style={{ margin: 0 }}><strong>Celular:</strong> {order.clientPhone}</p>
                    )}
                  </div>

                  {/* Endereço resumido */}
                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <strong>Bairro:</strong> {order.address?.neighborhood || ''}<br />
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {order.address?.street || ''}, {order.address?.number || ''}
                    </span>
                  </div>

                  {/* Mini mapa — rota loja → cliente */}
                  <MiniMap orderId={order.id!} address={order.address || undefined} clientCoords={order.clientCoords} />

                  {/* Itens */}
                  <div style={{ maxHeight: '80px', overflowY: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {order.items.map((it, idx) => (
                      <div key={idx}>{it.quantity}x {it.name}</div>
                    ))}
                  </div>

                  {/* Botão aceitar */}
                  <button
                    type="button"
                    onClick={() => handleAcceptDelivery(order.id!)}
                    className="btn-small btn-primary"
                    style={{ width: '100%', padding: '0.6rem', marginTop: 'auto', gap: '0.5rem' }}
                  >
                    <Play size={14} /> Aceitar e Iniciar Entrega
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DeliveryActive;
