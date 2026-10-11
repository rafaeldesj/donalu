import { useEffect, useState, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';
import { Check } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { processOrderLoyaltyStamps } from '../../utils/loyalty';

const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

export default function RiderLocationMonitor() {
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');
  const [deliverers, setDeliverers] = useState<any[]>([]);
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [selectedDelivererMap, setSelectedDelivererMap] = useState<Record<string, string>>({});

  // Mapa
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Escuta entregadores
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

  // Escuta pedidos em rota
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('status', '==', 'delivering')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        } as OrderDocument);
      });
      setOrders(fetched);
    });
    return () => unsubscribe();
  }, []);

  // Atualiza mapa
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: DONA_LU_COORDS,
        zoom: 14,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Limpa camadas
    layersRef.current.forEach(layer => map.removeLayer(layer));
    layersRef.current = [];

    // Dona Lu pastelaria marker
    const originIcon = L.divIcon({
      html: `<div style="font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">🏠</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const pastelariaMarker = L.marker(DONA_LU_COORDS, { icon: originIcon })
      .addTo(map)
      .bindPopup('<b>Dona Lu Pastelaria</b><br/>Ponto de Origem 🥟');
    layersRef.current.push(pastelariaMarker);

    const boundsPoints: L.LatLngExpression[] = [DONA_LU_COORDS];

    if (selectedRiderId === '') {
      // Exibe todas as rotas ativas
      orders.forEach((order) => {
        const riderCoords = order.deliveryCoords;
        if (riderCoords) {
          const riderIcon = L.divIcon({
            html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px); animation: pulse 2s infinite;">🏍️</div>`,
            className: 'leaflet-div-icon-emoji',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });

          const riderMarker = L.marker([riderCoords.lat, riderCoords.lng], { icon: riderIcon })
            .addTo(map)
            .bindPopup(`
              <div style="font-family: sans-serif; font-size: 13px;">
                <strong style="color: var(--primary-gold);">🏍️ Entregador: ${order.deliveryName || 'Desconhecido'}</strong><br/>
                <b>Pedido:</b> Seq ${order.dailySeq || '---'} (#${order.id?.slice(-4).toUpperCase()})<br/>
                <b>Status:</b> Em Rota
              </div>
            `);
          layersRef.current.push(riderMarker);
          boundsPoints.push([riderCoords.lat, riderCoords.lng]);

          if (order.clientCoords) {
            const destIcon = L.divIcon({
              html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">📍</div>`,
              className: 'leaflet-div-icon-emoji',
              iconSize: [30, 30],
              iconAnchor: [15, 15]
            });

            const clientMarker = L.marker([order.clientCoords.lat, order.clientCoords.lng], { icon: destIcon })
              .addTo(map)
              .bindPopup(`
                <div style="font-family: sans-serif; font-size: 13px;">
                  <strong>📍 Cliente: ${order.clientName}</strong><br/>
                  <b>Endereço:</b> ${order.address?.street}, ${order.address?.number}
                </div>
              `);
            layersRef.current.push(clientMarker);
            boundsPoints.push([order.clientCoords.lat, order.clientCoords.lng]);

            const pathPoints: [number, number][] = [
              DONA_LU_COORDS,
              [riderCoords.lat, riderCoords.lng],
              [order.clientCoords.lat, order.clientCoords.lng]
            ];

            const polyline = L.polyline(pathPoints, {
              color: '#f59e0b',
              weight: 3,
              opacity: 0.7,
              dashArray: '5, 8'
            }).addTo(map);
            layersRef.current.push(polyline);
          }
        }
      });
    } else {
      // Exibe apenas rota do entregador selecionado
      const riderUser = deliverers.find(d => d.uid === selectedRiderId);
      const riderOrder = orders.find(o => o.deliveryUid === selectedRiderId);
      const riderCoords = riderOrder?.deliveryCoords || riderUser?.lastCoords || riderUser?.deliveryCoords;

      if (riderCoords) {
        const riderIcon = L.divIcon({
          html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px); animation: pulse 2s infinite;">🏍️</div>`,
          className: 'leaflet-div-icon-emoji',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const riderMarker = L.marker([riderCoords.lat, riderCoords.lng], { icon: riderIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: sans-serif; font-size: 13px;">
              <strong style="color: var(--primary-gold);">🏍️ Entregador: ${riderUser?.name || 'Desconhecido'}</strong><br/>
              ${riderOrder ? `<b>Pedido:</b> Seq ${riderOrder.dailySeq || '---'}` : '<b>Sem entrega ativa</b>'}
            </div>
          `);
        layersRef.current.push(riderMarker);
        boundsPoints.push([riderCoords.lat, riderCoords.lng]);
      }

      if (riderOrder && riderOrder.clientCoords) {
        const destIcon = L.divIcon({
          html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">📍</div>`,
          className: 'leaflet-div-icon-emoji',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const clientMarker = L.marker([riderOrder.clientCoords.lat, riderOrder.clientCoords.lng], { icon: destIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family: sans-serif; font-size: 13px;">
              <strong>📍 Cliente: ${riderOrder.clientName}</strong><br/>
              <b>Endereço:</b> ${riderOrder.address?.street}, ${riderOrder.address?.number}
            </div>
          `);
        layersRef.current.push(clientMarker);
        boundsPoints.push([riderOrder.clientCoords.lat, riderOrder.clientCoords.lng]);

        const riderLoc: [number, number] = riderCoords ? [riderCoords.lat, riderCoords.lng] : DONA_LU_COORDS;
        const pathPoints: [number, number][] = [
          DONA_LU_COORDS,
          riderLoc,
          [riderOrder.clientCoords.lat, riderOrder.clientCoords.lng]
        ];

        const polyline = L.polyline(pathPoints, {
          color: '#f59e0b',
          weight: 3,
          opacity: 0.7,
          dashArray: '5, 8'
        }).addTo(map);
        layersRef.current.push(polyline);
      }
    }

    if (boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [50, 50] });
    } else {
      map.setView(DONA_LU_COORDS, 14);
    }
  }, [selectedRiderId, orders, deliverers]);

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

  const formatOrderHeader = (order: OrderDocument) => {
    const seqNum = order.dailySeq || (order.id ? order.id.slice(-4).toUpperCase() : '---');
    return `Pedido ${seqNum}`;
  };

  // Pedidos ativos do entregador selecionado ordenados pela rota
  const activeOrders = selectedRiderId
    ? orders
        .filter(o => o.deliveryUid === selectedRiderId)
        .sort((a, b) => (a.routeOrder ?? 999) - (b.routeOrder ?? 999) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];

  return (
    <div className="dashboard-layout animate-fade-in" style={{ padding: '0.5rem 0' }}>
      {/* Cabeçalho com apenas o título */}
      <div className="dashboard-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>🗺️ Localização dos Entregadores</h2>
        
        {/* Campo de Seleção do Entregador */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Entregador:</label>
          <select
            value={selectedRiderId}
            onChange={(e) => {
              setSelectedRiderId(e.target.value);
              // Reset local map selection state
              setSelectedDelivererMap({});
            }}
            style={{
              background: '#1f2937',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              padding: '0.45rem 1rem',
              fontSize: '0.9rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">Todos os Entregadores</option>
            {deliverers.map(d => (
              <option key={d.uid} value={d.uid}>{d.name || d.displayName || d.email}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Container do Mapa */}
      <div style={{ 
        position: 'relative', 
        width: '100%', 
        height: '420px', 
        borderRadius: '16px', 
        overflow: 'hidden', 
        border: '1px solid rgba(255,255,255,0.08)', 
        zIndex: 1,
        marginBottom: '2rem'
      }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Entrega ativa abaixo do mapa se selecionou um entregador específico */}
      {selectedRiderId !== '' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '1.15rem' }}>
            Entrega Atribuída
          </h3>
          
          {activeOrders.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '650px', margin: '0 auto' }}>
              {activeOrders.map((activeOrder) => (
                <div key={activeOrder.id} className="admin-card-box" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                    <span className="auth-role-badge" style={{ backgroundColor: '#f59e0b20', color: 'var(--primary-gold)', fontSize: '0.8rem' }}>
                      EM ROTA DE ENTREGA {activeOrder.deliveryName ? `— ${activeOrder.deliveryName.toUpperCase()}` : ''}
                    </span>
                    <h3 style={{ margin: '0.5rem 0 0 0', fontSize: '1.25rem' }}>{formatOrderHeader(activeOrder)}</h3>
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
                    <span>Rastreamento em tempo real do entregador ativo.</span>
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
                    {(activeOrder.deliveryFee ?? 0) > 0 && (
                      <p style={{ margin: '0.3rem 0', fontSize: '0.88rem', color: 'var(--primary-gold)', fontStyle: 'italic' }}>
                        🛵 Taxa de Entrega: R$ {(activeOrder.deliveryFee ?? 0).toFixed(2).replace('.', ',')}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCompleteDelivery(activeOrder)}
                    className="btn-small btn-success"
                    style={{ width: '100%', padding: '0.75rem', gap: '0.5rem', fontWeight: 600, fontSize: '0.95rem' }}
                  >
                    <Check size={18} /> Concluir Entrega (Pago)
                  </button>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.03)', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ordem de Entrega:</label>
                    <select
                      value={activeOrder.routeOrder || ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : null;
                        updateDoc(doc(db, 'orders', activeOrder.id!), { routeOrder: val })
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
                        value={selectedDelivererMap[activeOrder.id!] || ''}
                        onChange={(e) => setSelectedDelivererMap(prev => ({ ...prev, [activeOrder.id!]: e.target.value }))}
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
                        {deliverers.filter(d => d.uid !== activeOrder.deliveryUid).map(d => (
                          <option key={d.uid} value={d.uid}>{d.name || d.displayName || d.email}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleChangeDeliverer(activeOrder.id!, selectedDelivererMap[activeOrder.id!] || '')}
                        className="btn-small btn-primary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveDeliverer(activeOrder.id!)}
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
              ))}
            </div>
          ) : (
            <div style={{
              background: 'rgba(255,255,255,0.01)',
              border: '1px dashed rgba(255,255,255,0.08)',
              borderRadius: '16px',
              padding: '2.5rem 1rem',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              maxWidth: '650px',
              margin: '0 auto',
              width: '100%'
            }}>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>Este entregador não possui nenhuma entrega ativa no momento.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
