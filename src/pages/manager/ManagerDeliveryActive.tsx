import { useEffect, useState, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';
import { Navigation, Check } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodeAddress } from '../../utils/geocoding';
import { processOrderLoyaltyStamps } from '../../utils/loyalty';

const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

interface DeliveryRowMapProps {
  orderId: string;
  address: any;
  clientCoords?: { lat: number; lng: number };
  deliveryCoords?: { lat: number; lng: number };
}

const DeliveryRowMap = ({ orderId, address, clientCoords, deliveryCoords }: DeliveryRowMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; rider?: L.Marker; dest?: L.Marker; poly?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (clientCoords) {
      setDestCoords([clientCoords.lat, clientCoords.lng]);
      return;
    }
    if (!address) return;
    geocodeAddress(address.street, address.number, address.neighborhood)
      .then(setDestCoords)
      .catch(() => setDestCoords(DONA_LU_COORDS));
  }, [address, clientCoords, orderId]);

  useEffect(() => {
    if (!containerRef.current || !destCoords) return;

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView(DONA_LU_COORDS, 14);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      }).addTo(map);

      mapRef.current = map;
    }

    const map = mapRef.current;
    const riderLoc: [number, number] = deliveryCoords ? [deliveryCoords.lat, deliveryCoords.lng] : DONA_LU_COORDS;

    map.off('click');
    map.on('click', () => {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${destCoords[0]},${destCoords[1]}&travelmode=driving`,
        '_blank'
      );
    });

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
      .addTo(map).bindPopup('<b>Dona Lu Pastelaria</b>');
    markersRef.current.rider = L.marker(riderLoc, { icon: mkRider })
      .addTo(map).bindPopup('<b>Entregador</b>');
    markersRef.current.dest = L.marker(destCoords, { icon: mkDest })
      .addTo(map).bindPopup('<b>Endereço do Cliente</b>');

    const coordsStr = `${DONA_LU_COORDS[1]},${DONA_LU_COORDS[0]};${riderLoc[1]},${riderLoc[0]};${destCoords[1]},${destCoords[0]}`;
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(data => {
        let pts: [number, number][] = [DONA_LU_COORDS, riderLoc, destCoords];
        if (data.routes?.length) {
          pts = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
        }
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, { color: '#f59e0b', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
      })
      .catch(() => {
        const pts: [number, number][] = [DONA_LU_COORDS, riderLoc, destCoords];
        if (markersRef.current.poly) map.removeLayer(markersRef.current.poly);
        markersRef.current.poly = L.polyline(pts, { color: '#f59e0b', weight: 4, opacity: 0.85 }).addTo(map);
        map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
      });
  }, [destCoords, deliveryCoords, orderId]);

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
      title="Clique para abrir no Google Maps"
      style={{
        position: 'relative',
        width: '100%',
        height: '350px',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
        zIndex: 1
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', bottom: 10, right: 10, zIndex: 999,
        background: 'rgba(10,7,7,0.85)', padding: '0.3rem 0.6rem',
        borderRadius: '12px', fontSize: '0.75rem',
        color: 'var(--primary-gold)', border: '1px solid rgba(245,158,11,0.3)',
        pointerEvents: 'none', fontWeight: 600,
      }}>
        Abrir Google Maps 🗺️
      </div>
    </div>
  );
};

export default function ManagerDeliveryActive() {
  const { userData } = useAuth();
  const role = userData?.role || '';
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deliverers, setDeliverers] = useState<any[]>([]);
  const [selectedDelivererMap, setSelectedDelivererMap] = useState<Record<string, string>>({});

  // Escuta entregadores ativos no sistema
  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        const u = docSnap.data();
        if (u.staffFunctions?.delivery === true) {
          list.push({ uid: docSnap.id, ...u });
        }
      });
      setDeliverers(list);
    });
    return () => unsubscribe();
  }, []);

  const handleChangeDeliverer = async (orderId: string, delivererId: string) => {
    if (!delivererId) {
      alert('Selecione um entregador.');
      return;
    }
    const deliverer = deliverers.find(d => d.uid === delivererId);
    if (!deliverer) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        deliveryUid: deliverer.uid,
        deliveryName: deliverer.name || deliverer.displayName || deliverer.email || 'Entregador',
        dispatchedAt: new Date().toISOString()
      });
      alert('Entregador alterado com sucesso!');
    } catch (err) {
      console.error('Erro ao trocar entregador:', err);
      alert('Erro ao trocar entregador.');
    }
  };

  const handleRemoveDeliverer = async (orderId: string) => {
    if (!window.confirm('Tem certeza que deseja retirar o entregador deste pedido e enviá-lo de volta ao balcão?')) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'ready',
        deliveryUid: null,
        deliveryName: null,
        deliveryCoords: null,
        dispatchedAt: null
      });
      alert('Entregador removido. O pedido voltou ao balcão de entrega.');
    } catch (err) {
      console.error('Erro ao remover entregador:', err);
      alert('Erro ao remover entregador.');
    }
  };

  // Escuta os pedidos que estão em rota (delivering)
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('status', '==', 'delivering')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        const orderData = docSnap.data() as any;
        if (!orderData.isTest || role === 'developer') {
          fetched.push({
            id: docSnap.id,
            ...orderData
          } as OrderDocument);
        }
      });
      const sorted = fetched.sort((a, b) => {
        const uidA = a.deliveryUid || '';
        const uidB = b.deliveryUid || '';
        if (uidA !== uidB) return uidA.localeCompare(uidB);
        const roA = a.routeOrder ?? 999;
        const roB = b.routeOrder ?? 999;
        if (roA !== roB) return roA - roB;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      setOrders(sorted);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao escutar entregas em andamento:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleCompleteDelivery = async (order: OrderDocument) => {
    if (!order.id) return;
    if (!window.confirm('Confirmar que a entrega foi realizada e o pagamento recebido?')) return;
    try {
      await updateDoc(doc(db, 'orders', order.id), { status: 'completed' });
      await processOrderLoyaltyStamps(order.id, { ...order, status: 'completed' });
    } catch (err) {
      console.error('Erro ao concluir entrega:', err);
      alert('Erro ao concluir entrega: ' + (err as Error).message);
    }
  };

  const formatOrderHeader = (order: OrderDocument) => {
    const seqNum = order.dailySeq || (order.id ? order.id.slice(-4).toUpperCase() : '---');
    return `Pedido ${seqNum}`;
  };

  return (
    <div className="dashboard-layout animate-fade-in" style={{ padding: '0.5rem 0' }}>
      {/* Cabeçalho */}
      <div className="dashboard-header" style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🏍️ Entregas em Andamento
        </h2>
        <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Acompanhe a rota dos entregadores e o status dos pedidos em tempo real.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <span className="spinner" style={{ margin: '0 auto 1rem auto' }}></span>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Buscando entregas ativas...</p>
        </div>
      ) : orders.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.01)',
          border: '1px dashed rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '4rem 2rem',
          color: 'var(--text-secondary)',
          textAlign: 'center'
        }}>
          <Navigation size={42} style={{ margin: '0 auto 1rem auto', opacity: 0.6, color: 'var(--primary-gold)' }} />
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.1rem' }}>Nenhuma Entrega em Andamento</h4>
          <p style={{ margin: 0, fontSize: '0.88rem' }}>Os entregadores estão aguardando novos pedidos na pastelaria.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {orders.map((order, index) => (
            <div key={order.id}>
              {index > 0 && (
                <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.5rem 0 2.5rem 0' }} />
              )}
              
              <div className="delivery-active-grid">
                {/* Coluna Esquerda: Informações do Pedido */}
                <div className="admin-card-box" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                    <span className="auth-role-badge" style={{ backgroundColor: '#f59e0b20', color: 'var(--primary-gold)', fontSize: '0.8rem' }}>
                      EM ROTA DE ENTREGA {order.deliveryName ? `— ${order.deliveryName.toUpperCase()}` : ''}
                    </span>
                    <h3 style={{ margin: '0.5rem 0 0 0', fontSize: '1.25rem' }}>{formatOrderHeader(order)}</h3>
                  </div>

                  {/* Status GPS simulado / ativo */}
                  <div style={{
                    background: 'rgba(16,185,129,0.08)',
                    borderLeft: '4px solid #10b981',
                    color: '#34d399',
                    padding: '0.85rem', borderRadius: '8px',
                    fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500,
                  }}>
                    <div className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#34d399' }} />
                    <span>Sinal de GPS Ativo: Rastreamento em tempo real do entregador.</span>
                  </div>

                  {/* Dados do cliente */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.95rem' }}>
                    <p style={{ margin: 0 }}><strong>Cliente:</strong> {order.clientName}</p>
                    {order.clientPhone && (
                      <p style={{ margin: 0 }}><strong>Celular:</strong> {order.clientPhone}</p>
                    )}
                    <p style={{ margin: 0 }}>
                      <strong>Total a Receber:</strong>{' '}
                      <span style={{ color: 'var(--primary-gold)', fontWeight: 700 }}>
                        R$ {order.total.toFixed(2).replace('.', ',')}
                      </span>
                    </p>
                  </div>

                  {/* Endereço */}
                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '1rem', borderRadius: '10px' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Endereço de Entrega:</h4>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                      {order.address?.street}, {order.address?.number}<br />
                      {order.address?.neighborhood} — Rio de Janeiro
                      {order.address?.complement && (
                        <><br /><span>Complemento: {order.address.complement}</span></>
                      )}
                    </p>
                  </div>

                  {/* Itens */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '10px', maxHeight: '150px', overflowY: 'auto' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Itens do Pedido:</h4>
                    {order.items.map((item, idx) => (
                      <p key={idx} style={{ margin: '0.3rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                        {item.quantity}x {item.name}
                      </p>
                    ))}
                    {(order.deliveryFee ?? 0) > 0 && (
                      <p style={{ margin: '0.3rem 0', fontSize: '0.88rem', color: 'var(--primary-gold)', fontStyle: 'italic' }}>
                        🛵 Taxa de Entrega: R$ {(order.deliveryFee ?? 0).toFixed(2).replace('.', ',')}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCompleteDelivery(order)}
                    className="btn-small btn-success"
                    style={{ width: '100%', padding: '0.75rem', gap: '0.5rem', fontWeight: 600, fontSize: '0.95rem' }}
                  >
                    <Check size={18} /> Concluir Entrega (Pago)
                  </button>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.03)', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ordem de Entrega:</label>
                    <select
                      value={order.routeOrder || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        updateDoc(doc(db, 'orders', order.id!), { routeOrder: val })
                          .catch(err => console.error("Erro ao definir rota:", err));
                      }}
                      style={{
                        background: '#1f2937',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        padding: '0.4rem',
                        fontSize: '0.85rem',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">Automático</option>
                      <option value="1">1ª Entrega (Prioridade Máxima)</option>
                      <option value="2">2ª Entrega</option>
                      <option value="3">3ª Entrega</option>
                      <option value="4">4ª Entrega</option>
                      <option value="5">5ª Entrega</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.03)', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Trocar Entregador:</label>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <select
                        value={selectedDelivererMap[order.id!] || ''}
                        onChange={(e) => setSelectedDelivererMap(prev => ({ ...prev, [order.id!]: e.target.value }))}
                        style={{
                          flex: 1,
                          background: '#1f2937',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '6px',
                          padding: '0.4rem',
                          fontSize: '0.85rem'
                        }}
                      >
                        <option value="">Selecione outro...</option>
                        {deliverers.filter(d => d.uid !== order.deliveryUid).map(d => (
                          <option key={d.uid} value={d.uid}>{d.name || d.displayName || d.email}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleChangeDeliverer(order.id!, selectedDelivererMap[order.id!] || '')}
                        className="btn-small btn-primary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveDeliverer(order.id!)}
                    className="btn-small btn-danger"
                    style={{
                      width: '100%',
                      padding: '0.6rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      marginTop: '0.25rem'
                    }}
                  >
                    🚫 Retirar Entregador (Voltar ao Balcão)
                  </button>
                </div>

                {/* Coluna Direita: Rota de Entrega */}
                <div className="admin-card-box" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    🗺️ Rota de Entrega
                  </h4>
                  <DeliveryRowMap
                    orderId={order.id!}
                    address={order.address}
                    clientCoords={order.clientCoords}
                    deliveryCoords={order.deliveryCoords}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
