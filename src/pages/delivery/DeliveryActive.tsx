import { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { OrderDocument } from '../../types/order';
import { Play, Check, AlertTriangle, MapPin, ShoppingBag } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

interface AvailableOrderMapProps {
  orderId: string;
  address: any;
  clientCoords?: { lat: number; lng: number };
}

const AvailableOrderMap = ({ orderId, address, clientCoords: savedClientCoords }: AvailableOrderMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; destination?: L.Marker; polyline?: L.Polyline }>({});
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);

  const getFallbackCoords = (id: string): [number, number] => {
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const latOffset = ((hash % 20) - 10) / 400;
    const lngOffset = ((hash % 17) - 8) / 400;
    return [DONA_LU_COORDS[0] + latOffset, DONA_LU_COORDS[1] + lngOffset];
  };

  useEffect(() => {
    // Se o pedido já tem coordenadas salvas, usa direto sem geocodificar
    if (savedClientCoords) {
      setDestCoords([savedClientCoords.lat, savedClientCoords.lng]);
      return;
    }

    // Fallback: geocodifica o endereço salvo com precisão melhorada
    if (!address) return;

    // Evita duplicar "Campo Grande" no query
    const neighborhood = address.neighborhood || '';
    const isFieldSameAsCity = neighborhood.toLowerCase().includes('campo grande');
    const locationSuffix = isFieldSameAsCity
      ? 'Campo Grande, Rio de Janeiro, Brasil'
      : `${neighborhood}, Campo Grande, Rio de Janeiro, Brasil`;

    // Query 1: com número completo + bounding box de Campo Grande (mais preciso)
    const queryWithNumber = `${address.street}, ${address.number}, ${locationSuffix}`;
    // Viewbox aproximado de Campo Grande, RJ
    const viewbox = '-43.65,-22.88,-43.45,-23.00';

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryWithNumber)}&limit=1&countrycodes=br&viewbox=${viewbox}&bounded=1`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.length > 0) {
          setDestCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        } else {
          // Query 2: sem bounded, mas com número
          return fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryWithNumber)}&limit=1&countrycodes=br`)
            .then((res) => res.json())
            .then((data2) => {
              if (data2 && data2.length > 0) {
                setDestCoords([parseFloat(data2[0].lat), parseFloat(data2[0].lon)]);
              } else {
                // Query 3: somente rua + localidade (sem número)
                const queryStreetOnly = `${address.street}, ${locationSuffix}`;
                return fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStreetOnly)}&limit=1&countrycodes=br&viewbox=${viewbox}&bounded=1`)
                  .then((res) => res.json())
                  .then((data3) => {
                    if (data3 && data3.length > 0) {
                      setDestCoords([parseFloat(data3[0].lat), parseFloat(data3[0].lon)]);
                    } else {
                      setDestCoords(getFallbackCoords(orderId));
                    }
                  });
              }
            });
        }
      })
      .catch(() => {
        setDestCoords(getFallbackCoords(orderId));
      });
  }, [address, orderId, savedClientCoords]);

  useEffect(() => {
    if (!mapContainerRef.current || !destCoords) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        doubleClickZoom: false
      }).setView(DONA_LU_COORDS, 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Remove camadas antigas
    if (markersRef.current.origin) map.removeLayer(markersRef.current.origin);
    if (markersRef.current.destination) map.removeLayer(markersRef.current.destination);
    if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

    const originIcon = L.divIcon({
      html: `<div style="font-size: 20px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -4px);">🏠</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const destIcon = L.divIcon({
      html: `<div style="font-size: 20px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -4px);">📍</div>`,
      className: 'leaflet-div-icon-emoji',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    markersRef.current.origin = L.marker(DONA_LU_COORDS, { icon: originIcon })
      .addTo(map)
      .bindPopup('<b>Dona Lu Pastelaria</b>');

    markersRef.current.destination = L.marker(destCoords, { icon: destIcon })
      .addTo(map)
      .bindPopup('<b>Destino de Entrega</b>');

    // Busca rota real pelas ruas via OSRM API
    const coordsStr = `${DONA_LU_COORDS[1]},${DONA_LU_COORDS[0]};${destCoords[1]},${destCoords[0]}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        let routePoints: [number, number][] = [DONA_LU_COORDS, destCoords];
        if (data.routes && data.routes.length > 0) {
          const rawCoords = data.routes[0].geometry.coordinates;
          routePoints = rawCoords.map((c: any) => [c[1], c[0]]);
        }
        
        if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

        const polyline = L.polyline(routePoints, {
          color: '#e28743',
          weight: 4,
          opacity: 0.85
        }).addTo(map);
        markersRef.current.polyline = polyline;

        const bounds = L.latLngBounds(routePoints);
        map.fitBounds(bounds, { padding: [25, 25] });
      })
      .catch(err => {
        console.error("Erro rota OSRM minimapa:", err);
        if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

        const points = [DONA_LU_COORDS, destCoords];
        const polyline = L.polyline(points, {
          color: '#e28743',
          weight: 4,
          opacity: 0.85
        }).addTo(map);
        markersRef.current.polyline = polyline;

        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [25, 25] });
      });

    // Adiciona evento de clique para abrir o Google Maps com rota completa
    map.off('click');
    map.on('click', () => {
      window.open(
        `https://www.google.com/maps/dir/?api=1&origin=${DONA_LU_COORDS[0]},${DONA_LU_COORDS[1]}&destination=${destCoords[0]},${destCoords[1]}&travelmode=driving`,
        '_blank'
      );
    });

  }, [destCoords]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '140px', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', marginTop: '0.4rem', zIndex: 1 }} title="Clique para ver no Google Maps">
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', bottom: '5px', right: '5px', zIndex: 999, background: 'rgba(10,7,7,0.85)', padding: '0.2rem 0.5rem', borderRadius: '12px', fontSize: '0.65rem', color: 'var(--primary-gold)', border: '1px solid rgba(245, 158, 11, 0.3)', pointerEvents: 'none' }}>
        Ver no Maps 🗺️
      </div>
    </div>
  );
};

export const DeliveryActive = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [gpsCoords, setGpsCoords] = useState<[number, number] | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [destCoords, setDestCoords] = useState<[number, number] | null>(null);
  const [loadingDest, setLoadingDest] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ origin?: L.Marker; current?: L.Marker; destination?: L.Marker; polyline?: L.Polyline }>({});

  // Escuta todos os pedidos em tempo real
  useEffect(() => {
    const q = collection(db, 'orders');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: OrderDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        } as OrderDocument);
      });
      setOrders(fetched);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao carregar pedidos:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Determina o pedido ativo do entregador conectado
  const activeOrder = orders.find(
    (o) => o.status === 'delivering' && o.deliveryUid === user?.uid
  );

  // Pedidos disponíveis para entrega (status pronto, com endereço e sem entregador)
  const availableOrders = orders.filter(
    (o) => o.status === 'ready' && o.address && !o.deliveryUid
  );

  // Gera coordenadas de fallback determinísticas perto de Dona Lu
  const getFallbackCoords = (orderId: string): [number, number] => {
    const hash = orderId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const latOffset = ((hash % 20) - 10) / 400; // ~ -0.025 a +0.025
    const lngOffset = ((hash % 17) - 8) / 400;
    return [DONA_LU_COORDS[0] + latOffset, DONA_LU_COORDS[1] + lngOffset];
  };

  // Busca coordenadas do endereço via Nominatim (Geocoding)
  useEffect(() => {
    if (!activeOrder) {
      setDestCoords(null);
      return;
    }

    const addr = activeOrder.address;
    const queryStr = `${addr.street}, ${addr.number}, ${addr.neighborhood}, Campo Grande, Rio de Janeiro`;
    
    setLoadingDest(true);
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryStr)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.length > 0) {
          setDestCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
        } else {
          // Fallback se não encontrar o endereço fictício/real
          setDestCoords(getFallbackCoords(activeOrder.id || 'fallback'));
        }
      })
      .catch((err) => {
        console.error("Erro na geocodificação:", err);
        setDestCoords(getFallbackCoords(activeOrder.id || 'fallback'));
      })
      .finally(() => {
        setLoadingDest(false);
      });
  }, [activeOrder]);

  // Ativa watchPosition de geolocalização do Entregador
  // Ativa busca de geolocalização do Entregador de 1 em 1 segundo para precisão máxima
  useEffect(() => {
    if (!activeOrder) {
      setGpsCoords(null);
      setGpsError(null);
      return;
    }

    if (!navigator.geolocation) {
      setGpsError("Seu navegador não suporta geolocalização.");
      return;
    }

    const updateLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setGpsCoords([latitude, longitude]);
          setGpsError(null);

          // Atualiza coordenadas em tempo real no Firestore
          updateDoc(doc(db, 'orders', activeOrder.id!), {
            deliveryCoords: { lat: latitude, lng: longitude }
          }).catch((err) => console.error("Erro ao salvar coordenadas no banco:", err));
        },
        (error) => {
          console.error("Erro de GPS:", error);
          if (error.code === 1) {
            setGpsError("Acesso à localização negado. O rastreamento de GPS é obrigatório para as entregas!");
          }
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    };

    // Primeira execução imediata
    updateLocation();

    // Executa a cada 1 segundo
    const intervalId = setInterval(updateLocation, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeOrder]);

  // Efeito para gerenciar a instância do Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || !destCoords) return;

    // Inicializa o mapa caso não exista
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true
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

    // Limpa camadas antigas
    if (markersRef.current.origin) map.removeLayer(markersRef.current.origin);
    if (markersRef.current.current) map.removeLayer(markersRef.current.current);
    if (markersRef.current.destination) map.removeLayer(markersRef.current.destination);
    if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

    // Criação de DivIcons (Emojis) duráveis para Vite
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

    // Adiciona Marcadores
    const originMarker = L.marker(DONA_LU_COORDS, { icon: originIcon })
      .addTo(map)
      .bindPopup('<b>Dona Lu Pastelaria</b><br/>Ponto de Partida');
    markersRef.current.origin = originMarker;

    const destMarker = L.marker(destCoords, { icon: destIcon })
      .addTo(map)
      .bindPopup(`<b>Cliente: ${activeOrder?.clientName}</b><br/>Endereço de Entrega`);
    markersRef.current.destination = destMarker;

    const currentLoc = gpsCoords || DONA_LU_COORDS;
    const currentMarker = L.marker(currentLoc, { icon: deliveryIcon })
      .addTo(map)
      .bindPopup('<b>Você (GPS)</b>');
    markersRef.current.current = currentMarker;

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
          color: '#e28743',
          weight: 5,
          opacity: 0.8,
          dashArray: '8, 12'
        }).addTo(map);
        markersRef.current.polyline = polyline;

        // Enquadra a câmera na rota pelas ruas
        const bounds = L.latLngBounds(routePoints);
        map.fitBounds(bounds, { padding: [50, 50] });
      })
      .catch(err => {
        console.error("Erro ao buscar rota OSRM:", err);
        // Fallback para linha reta se falhar
        if (markersRef.current.polyline) map.removeLayer(markersRef.current.polyline);

        const points = [DONA_LU_COORDS, currentLoc, destCoords];
        const polyline = L.polyline(points, {
          color: '#e28743',
          weight: 5,
          opacity: 0.8,
          dashArray: '8, 12'
        }).addTo(map);
        markersRef.current.polyline = polyline;

        const bounds = L.latLngBounds(points);
        map.fitBounds(bounds, { padding: [50, 50] });
      });

  }, [destCoords, gpsCoords, activeOrder]);

  // Destrói o mapa ao desmontar
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Ação de aceitar entrega
  const handleAcceptDelivery = async (orderId: string) => {
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'delivering',
        deliveryUid: user?.uid,
        deliveryName: user?.displayName || user?.email || 'Entregador',
        deliveryCoords: { lat: DONA_LU_COORDS[0], lng: DONA_LU_COORDS[1] }
      });
    } catch (err) {
      console.error("Erro ao aceitar pedido:", err);
    }
  };

  // Ação de concluir entrega
  const handleCompleteDelivery = async (orderId: string) => {
    if (!window.confirm("Confirmar que a entrega foi realizada e o pagamento recebido?")) return;
    try {
      await updateDoc(doc(db, 'orders', orderId), {
        status: 'completed'
      });
      // Limpa os dados do mapa local
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      setDestCoords(null);
      setGpsCoords(null);
    } catch (err) {
      console.error("Erro ao concluir entrega:", err);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Carregando entregas...</div>;
  }

  return (
    <div className="dashboard-layout animate-fade-in">
      <div className="dashboard-header">
        <h2>Entrega em Andamento 🏍️</h2>
        <p>Monitore sua rota ativa e aceite novos pedidos de delivery.</p>
      </div>

      {activeOrder ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '2rem' }}>
          
          {/* Detalhes da entrega ativa */}
          <div className="admin-card-box" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <span className="auth-role-badge" style={{ backgroundColor: '#3b82f620', color: '#60a5fa', fontSize: '0.8rem' }}>
                EM ROTA DE ENTREGA
              </span>
              <h3 style={{ margin: '0.5rem 0 0 0', fontSize: '1.25rem' }}>Pedido #{activeOrder.id?.slice(-4).toUpperCase()}</h3>
            </div>

            {/* Alerta de GPS Obrigatório */}
            <div style={{
              background: gpsError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.08)',
              borderLeft: `4px solid ${gpsError ? '#ef4444' : '#10b981'}`,
              color: gpsError ? '#f87171' : '#34d399',
              padding: '0.85rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 500
            }}>
              {gpsError ? <AlertTriangle size={18} /> : <div className="pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34d399' }}></div>}
              <span>{gpsError ? gpsError : "Sinal de GPS Ativo: Rastreamento em tempo real obrigatório."}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.95rem' }}>
              <p><strong>Cliente:</strong> {activeOrder.clientName}</p>
              <p><strong>Total a Receber:</strong> <span style={{ color: 'var(--primary-gold)', fontWeight: 700 }}>R$ {activeOrder.total.toFixed(2).replace('.', ',')}</span></p>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.15)', padding: '1rem', borderRadius: '10px' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Endereço de Entrega:</h4>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                {activeOrder.address.street}, {activeOrder.address.number}<br/>
                {activeOrder.address.neighborhood} - Rio de Janeiro<br/>
                {activeOrder.address.complement && <span>Complemento: {activeOrder.address.complement}</span>}
              </p>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '10px', maxHeight: '150px', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Itens do Pedido:</h4>
              {activeOrder.items.map((item, idx) => (
                <p key={idx} style={{ margin: '0.35rem 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
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

          {/* Rota no Mapa */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="admin-card-box" style={{ padding: '0.5rem', height: '100%', minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <MapPin size={16} style={{ color: 'var(--primary-gold)' }} /> Rota de Entrega
                </span>
                {loadingDest && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Geocodificando...</span>}
              </div>
              <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div 
                  ref={mapContainerRef} 
                  style={{ 
                    flex: 1, 
                    width: '100%', 
                    borderRadius: '10px', 
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    zIndex: 1,
                    cursor: 'pointer'
                  }} 
                  title="Clique no mapa para abrir rota no Google Maps"
                />
                <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 999, background: 'rgba(10,7,7,0.85)', padding: '0.35rem 0.75rem', borderRadius: '20px', fontSize: '0.75rem', color: 'var(--primary-gold)', border: '1px solid rgba(245, 158, 11, 0.3)', pointerEvents: 'none', fontWeight: 600 }}>
                  Clique para abrir no Google Maps 🗺️
                </div>
              </div>
            </div>
          </div>

        </div>
      ) : (
        /* Lista de Pedidos Disponíveis para Aceitar */
        <div className="admin-card-box">
          <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingBag size={20} style={{ color: 'var(--primary-gold)' }} /> Entregas Disponíveis ({availableOrders.length})
          </h3>

          {availableOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              Nenhum pedido pronto para entrega no balcão. Aguardando a cozinha...
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1.25rem' }}>
              {availableOrders.map((order) => (
                <div key={order.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1.25rem', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <strong>Pedido #{order.id?.slice(-4).toUpperCase()}</strong>
                    <span style={{ fontWeight: 700, color: 'var(--primary-gold)' }}>R$ {order.total.toFixed(2).replace('.', ',')}</span>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.88rem' }}><strong>Cliente:</strong> {order.clientName}</p>

                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <strong>Bairro:</strong> {order.address.neighborhood}<br/>
                    <span style={{ color: 'var(--text-secondary)' }}>{order.address.street}, {order.address.number}</span>
                  </div>

                  {/* Minimapa mostrando rota da loja ao cliente antes de aceitar */}
                  <AvailableOrderMap orderId={order.id!} address={order.address} clientCoords={order.clientCoords} />

                  <div style={{ maxHeight: '80px', overflowY: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {order.items.map((it, idx) => (
                      <div key={idx}>{it.quantity}x {it.name}</div>
                    ))}
                  </div>

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
