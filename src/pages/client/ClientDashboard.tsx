import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ShoppingBag, MapPin, Plus, Minus, Trash2, CheckCircle, Edit2, Check, X, Upload } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { OrderItem } from '../../types/order';
import pastelCrocante from '../../assets/pastel_crocante.png';
import pastelFrito from '../../assets/pastel_frito.png';
import pastelRefri from '../../assets/pastel_refri.png';
import pastelCombo from '../../assets/pastel_combo.png';

interface ClientDashboardProps {
  showOnly?: 'menu' | 'loyalty';
  isVisitor?: boolean;
  onLoginRequired?: () => void;
}

export const ClientDashboard = ({ showOnly, isVisitor = false, onLoginRequired }: ClientDashboardProps) => {
  const { user, userData } = useAuth();

  const defaultPastels = [
    { id: 1, name: 'Pastel de Carne com Queijo', price: 12.00, description: 'Carne moída temperada com queijo mussarela derretido.', image: pastelCrocante },
    { id: 2, name: 'Pastel de Frango Catupiry', price: 11.50, description: 'Peito de frango desfiado com o autêntico Catupiry.', image: pastelFrito },
    { id: 3, name: 'Pastel de Vento Especial', price: 6.00, description: 'Aquele clássico dourado e crocante de feira.', image: pastelRefri },
    { id: 4, name: 'Pastel Doce de Nutella com Morango', price: 14.00, description: 'Sobremesa perfeita recheada com Nutella e morangos frescos.', image: pastelCombo },
  ];

  // Estados
  const [pastels, setPastels] = useState(() => {
    const saved = localStorage.getItem('donalu_pastels');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Erro ao carregar cardápio salvo:", e);
      }
    }
    return defaultPastels;
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrice, setEditPrice] = useState(0);
  const [editImage, setEditImage] = useState('');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [isNewItem, setIsNewItem] = useState<number | null>(null);

  const role = userData?.role || 'client';
  const canEdit = ['developer', 'owner', 'manager'].includes(role);

  const [cart, setCart] = useState<OrderItem[]>([]);
  const [complement, setComplement] = useState(userData?.clientAddress?.complement || '');
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados e referências para geolocalização e autocomplete do cliente
  const [addressInput, setAddressInput] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressCoords, setAddressCoords] = useState<[number, number] | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  
  const miniMapContainerRef = useRef<HTMLDivElement>(null);
  const miniMapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Algoritmo de decomposição do endereço completo (Rua, Número - Bairro)
  const parseAddress = (inputStr: string) => {
    let parsedStreet = '';
    let parsedNumber = '';
    let parsedNeighborhood = 'Campo Grande';

    const parts = inputStr.split(',').map((p) => p.trim());
    if (parts.length > 0) {
      parsedStreet = parts[0];
    }

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (/^\d+/.test(part)) {
        parsedNumber = part.split(/\s|-/)[0]; // Pega a primeira parte numérica
      } else if (part.includes('-')) {
        const subParts = part.split('-').map((s) => s.trim());
        if (subParts.length > 0 && /^\d+/.test(subParts[0])) {
          parsedNumber = subParts[0];
        }
        if (subParts.length > 1) {
          parsedNeighborhood = subParts[1];
        }
      } else {
        parsedNeighborhood = part;
      }
    }

    if (!parsedNumber && inputStr.includes('-')) {
      const partsDash = inputStr.split('-').map(p => p.trim());
      for (const p of partsDash) {
        if (/^\d+/.test(p)) {
          parsedNumber = p.split(/\s/)[0];
        }
      }
    }

    return { street: parsedStreet, number: parsedNumber, neighborhood: parsedNeighborhood };
  };

  // Sincroniza dados do endereço ao carregar dados do usuário
  useEffect(() => {
    if (userData?.clientAddress) {
      const addr = userData.clientAddress;
      const formatted = addr.street 
        ? `${addr.street}${addr.number ? `, ${addr.number}` : ''}${addr.neighborhood ? ` - ${addr.neighborhood}` : ''}`
        : '';
      setAddressInput(formatted);
    }
  }, [userData]);

  // Busca sugestões de ruas (Autocomplete) via Photon API
  useEffect(() => {
    if (!addressInput.trim() || addressInput.includes(',')) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(addressInput)}&lat=-22.9112951&lon=-43.5602961&limit=5`;
      fetch(url)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.features) {
            const filtered = data.features.filter((f: any) => {
              const name = f.properties.name || '';
              return name && f.properties.countrycode === 'BR';
            });
            setSuggestions(filtered);
            setShowSuggestions(filtered.length > 0);
          }
        })
        .catch((err) => console.error("Erro ao buscar sugestões:", err));
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [addressInput]);

  // Helper: verifica se coordenadas estão próximas a Campo Grande (~15km)
  const isNearDonaLu = (lat: number, lng: number): boolean => {
    const DONA_LU_LAT = -22.9112951;
    const DONA_LU_LON = -43.5602961;
    const MAX_DIST_DEG = 0.15; // ~15km
    return Math.abs(lat - DONA_LU_LAT) < MAX_DIST_DEG && Math.abs(lng - DONA_LU_LON) < MAX_DIST_DEG;
  };

  // Helper: seleciona o melhor segmento de rua baseado no número da casa
  // Ruas brasileiras tipicamente têm números crescendo para longe do centro
  const pickBestSegment = (segments: any[], houseNumber: number): any => {
    const DONA_LU_LAT = -22.9112951;
    const DONA_LU_LON = -43.5602961;

    // Calcula distância de cada segmento até a Dona Lu
    const withDist = segments.map((seg: any) => {
      const [lng, lat] = seg.geometry ? seg.geometry.coordinates : [parseFloat(seg.lon), parseFloat(seg.lat)];
      const dist = Math.sqrt(Math.pow(lat - DONA_LU_LAT, 2) + Math.pow(lng - DONA_LU_LON, 2));
      return { seg, lat, lng, dist };
    });

    // Ordena por distância
    withDist.sort((a, b) => a.dist - b.dist);

    // Heurística: números maiores ficam mais longe do centro da rua
    // Números ≥ 200: prefere o segmento MAIS DISTANTE da Dona Lu
    // Números < 200: prefere o segmento MAIS PRÓXIMO da Dona Lu
    if (houseNumber >= 200) {
      return withDist[withDist.length - 1].seg; // mais distante
    }
    return withDist[0].seg; // mais próximo
  };

  // Geocodificação em tempo real do endereço com debounce de 800ms ao digitar a vírgula + número
  useEffect(() => {
    const parsed = parseAddress(addressInput);
    if (!parsed.street.trim() || !parsed.number.trim()) {
      setAddressCoords(null);
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      const houseNumber = parseInt(parsed.number) || 0;
      setGeocoding(true);

      // Usa Nominatim para pegar TODOS os segmentos da rua (até 10)
      // e depois seleciona o mais adequado pelo número da casa
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(parsed.street + ', Campo Grande, Rio de Janeiro')}&countrycodes=br&limit=10`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.length > 0) {
            // Filtra por proximidade a Campo Grande
            const local = data.filter((d: any) => isNearDonaLu(parseFloat(d.lat), parseFloat(d.lon)));
            if (local.length > 0) {
              const best = pickBestSegment(local, houseNumber);
              setAddressCoords([parseFloat(best.lat), parseFloat(best.lon)]);
              return;
            }
          }

          // Fallback: Photon
          fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(parsed.street)}&lat=-22.9112951&lon=-43.5602961&limit=10`)
            .then((res) => res.json())
            .then((photonData) => {
              if (photonData && photonData.features && photonData.features.length > 0) {
                const filtered = photonData.features.filter((f: any) => {
                  if (f.properties?.countrycode !== 'BR') return false;
                  const [fLng, fLat] = f.geometry.coordinates;
                  return isNearDonaLu(fLat, fLng);
                });
                if (filtered.length > 0) {
                  // Adapta formato para pickBestSegment
                  const adapted = filtered.map((f: any) => ({
                    ...f,
                    lat: String(f.geometry.coordinates[1]),
                    lon: String(f.geometry.coordinates[0])
                  }));
                  const best = pickBestSegment(adapted, houseNumber);
                  setAddressCoords([parseFloat(best.lat), parseFloat(best.lon)]);
                  return;
                }
              }
              setAddressCoords(null);
            })
            .catch(() => setAddressCoords(null));
        })
        .catch(() => setAddressCoords(null))
        .finally(() => setGeocoding(false));
    }, 800);

    return () => clearTimeout(delayDebounceFn);
  }, [addressInput]);

  // Gerencia a instância do mapa Leaflet e o marcador do endereço do cliente
  useEffect(() => {
    if (!addressCoords || !miniMapContainerRef.current) {
      if (miniMapInstanceRef.current) {
        miniMapInstanceRef.current.remove();
        miniMapInstanceRef.current = null;
        markerRef.current = null;
      }
      return;
    }

    if (!miniMapInstanceRef.current) {
      const map = L.map(miniMapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false
      }).setView(addressCoords, 15);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      miniMapInstanceRef.current = map;
    } else {
      miniMapInstanceRef.current.setView(addressCoords, 15);
    }

    const map = miniMapInstanceRef.current;

    if (markerRef.current) {
      markerRef.current.setLatLng(addressCoords);
    } else {
      const clientIcon = L.divIcon({
        html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); transform: translate(-2px, -6px);">📍</div>`,
        className: 'leaflet-div-icon-emoji',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const m = L.marker(addressCoords, { icon: clientIcon })
        .addTo(map)
        .bindPopup('<b>Seu Endereço de Entrega</b>');
      markerRef.current = m;
    }

    setTimeout(() => {
      if (miniMapInstanceRef.current) {
        miniMapInstanceRef.current.invalidateSize();
      }
    }, 100);

  }, [addressCoords]);

  // Destrói o mapa ao desmontar
  useEffect(() => {
    return () => {
      if (miniMapInstanceRef.current) {
        miniMapInstanceRef.current.remove();
        miniMapInstanceRef.current = null;
      }
    };
  }, []);

  const handleSelectSuggestion = (feature: any) => {
    const prop = feature.properties;
    const streetName = prop.name || '';
    const neighborhoodName = prop.district || prop.suburb || 'Campo Grande';
    const formatted = `${streetName}, ${neighborhoodName}`;
    setAddressInput(formatted);
    setSuggestions([]);
    setShowSuggestions(false);

    // Salva imediatamente as coordenadas do Photon ao selecionar da lista
    // (coords 100% precisas, pois vieram do resultado de autocomplete)
    if (feature.geometry?.coordinates) {
      const [lng, lat] = feature.geometry.coordinates;
      setAddressCoords([lat, lng]);
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

  const saveEdit = () => {
    if (!editName.trim()) {
      alert("O nome do pastel não pode ser vazio.");
      return;
    }
    const updatedPastels = pastels.map((p: any) => 
      p.id === editingId 
        ? { ...p, name: editName, description: editDescription, price: editPrice, image: editImage }
        : p
    );
    setPastels(updatedPastels);
    localStorage.setItem('donalu_pastels', JSON.stringify(updatedPastels));
    setEditingId(null);
    if (editingId === isNewItem) {
      setIsNewItem(null);
    }
  };

  const cancelEdit = () => {
    if (isNewItem === editingId) {
      setPastels(pastels.filter((p: any) => p.id !== isNewItem));
      setIsNewItem(null);
    }
    setEditingId(null);
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
      image: ''
    };
    setPastels([newPastel, ...pastels]);
    setEditingId(newId);
    setEditName('');
    setEditDescription('');
    setEditPrice(0);
    setEditImage('');
    setIsNewItem(newId);
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

  const addToCart = (item: typeof defaultPastels[0]) => {
    if (isVisitor) {
      if (onLoginRequired) {
        alert('Para adicionar itens ao carrinho e realizar compras, você precisa estar logado. Redirecionando para a tela de login...');
        onLoginRequired();
      }
      return;
    }
    setCart((prevCart) => {
      const existing = prevCart.find((i) => i.id === item.id);
      if (existing) {
        return prevCart.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prevCart, { id: item.id, name: item.name, price: item.price, quantity: 1 }];
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

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (cart.length === 0) {
      setError('O seu carrinho está vazio.');
      return;
    }

    const parsed = parseAddress(addressInput);
    if (!parsed.street.trim() || !parsed.number.trim()) {
      setError('Por favor, digite o endereço completo contendo rua e número separados por vírgula (ex: Rua Jícara, 239).');
      return;
    }

    setSubmitting(true);
    try {
      const orderData: any = {
        clientUid: user?.uid || '',
        clientName: user?.displayName || user?.email || 'Cliente Anônimo',
        items: cart,
        total: cartTotal,
        status: 'pending',
        createdAt: new Date().toISOString(),
        address: {
          street: parsed.street,
          number: parsed.number,
          neighborhood: parsed.neighborhood,
          city: 'Rio de Janeiro',
          zipCode: '23000-000',
          complement,
        },
        // Salva as coordenadas geocodificadas para uso no mapa do entregador
        ...(addressCoords ? { clientCoords: { lat: addressCoords[0], lng: addressCoords[1] } } : {}),
      };

      await addDoc(collection(db, 'orders'), orderData);
      setCart([]);
      setOrderPlaced(true);
      setTimeout(() => setOrderPlaced(false), 5000);
    } catch (err: any) {
      console.error(err);
      setError('Erro ao enviar pedido para a cozinha. Tente novamente.');
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
        <div className="client-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
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

  // Padrão: exibe o cardápio e carrinho
  return (
    <div className="dashboard-layout animate-fade-in">
      <div className="dashboard-header">
        <h2>Cardápio Digital 🥟</h2>
        <p>Monte seu carrinho e faça seu pedido!</p>
      </div>

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

      {orderPlaced && (
        <div className="alert-box" style={{ background: 'rgba(16, 185, 129, 0.1)', borderLeft: '3px solid #10b981', color: '#10b981', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <CheckCircle size={24} />
          <div>
            <strong>Pedido Confirmado com Sucesso!</strong> A cozinha já recebeu o alerta em tempo real.
          </div>
        </div>
      )}

      {error && <div className="auth-error-message" style={{ marginBottom: '1.5rem' }}>{error}</div>}

      <div className="client-grid">
        {/* Lista de Pastéis */}
        <div className="menu-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, border: 'none', padding: 0 }}>Pastéis Fritos na Hora</h3>
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
          <div className="pastels-list">
            {pastels.map((pastel: any) => (
              <div key={pastel.id} className="pastel-card">
                {/* Foto do Pastel */}
                <div className="pastel-img-container" onClick={() => pastel.image && setZoomedImage(pastel.image)} title="Clique para ampliar">
                  {pastel.image ? (
                    <img src={pastel.image} alt={pastel.name} className="pastel-card-img" />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Sem foto</div>
                  )}
                </div>

                <div className="pastel-details" style={{ flex: 1, marginLeft: '1.25rem' }}>
                  {editingId === pastel.id ? (
                    // Modo Edição
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
                      <input 
                        type="text" 
                        className="pastel-edit-input" 
                        value={editName} 
                        onChange={(e) => setEditName(e.target.value)} 
                        placeholder="Nome do pastel" 
                      />
                      <textarea 
                        className="pastel-edit-textarea" 
                        value={editDescription} 
                        onChange={(e) => setEditDescription(e.target.value)} 
                        placeholder="Descrição do pastel" 
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
                      <h4>{pastel.name}</h4>
                      <p>{pastel.description}</p>
                      <span className="pastel-price">R$ {pastel.price.toFixed(2).replace('.', ',')}</span>
                    </>
                  )}
                </div>

                <div className="pastel-actions" style={{ marginLeft: '1rem' }}>
                  {editingId === pastel.id ? (
                    // Botões para salvar/cancelar em edição
                    <>
                      <button type="button" onClick={saveEdit} className="pastel-action-btn save-btn" title="Salvar Alterações" style={{ marginBottom: '0.5rem' }}>
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
                        <button type="button" onClick={() => startEdit(pastel)} className="pastel-action-btn edit-btn" title="Editar Pastel" style={{ marginBottom: '0.5rem' }}>
                          <Edit2 size={16} />
                        </button>
                      )}
                      <button type="button" onClick={() => addToCart(pastel)} className="add-to-cart-btn" aria-label={`Adicionar ${pastel.name} ao carrinho`}>
                        <ShoppingBag size={18} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Carrinho e Endereço */}
        <div className="profile-section">
          <div className="loyalty-card">
            <h3>Carrinho de Compras</h3>
            {cart.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '2rem 0' }}>Seu carrinho está vazio.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="cart-items-list" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {cart.map((item) => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
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
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem', fontWeight: 700 }}>
                  <span>Total:</span>
                  <span style={{ color: 'var(--primary-gold)' }}>R$ {cartTotal.toFixed(2).replace('.', ',')}</span>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handlePlaceOrder} className="loyalty-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <h3 style={{ fontSize: '1.1rem', margin: '0' }}>Endereço de Entrega</h3>
            
            <div className="input-group" style={{ position: 'relative' }}>
              <label htmlFor="address-autocomplete" style={{ fontSize: '0.8rem' }}>Endereço</label>
              <div className="input-wrapper">
                <MapPin size={16} className="input-icon" />
                <input 
                  id="address-autocomplete" 
                  type="text" 
                  placeholder="Digite a rua, depois vírgula e número (ex: Rua Jícara, 239)" 
                  value={addressInput} 
                  onChange={(e) => setAddressInput(e.target.value)} 
                  style={{ padding: '0.5rem 0.5rem 0.5rem 2.2rem', fontSize: '0.85rem' }} 
                  autoComplete="off"
                />
              </div>

              {/* Dropdown de Sugestões Autocomplete */}
              {showSuggestions && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#151010',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  zIndex: 1000,
                  marginTop: '4px',
                  maxHeight: '180px',
                  overflowY: 'auto'
                }}>
                  {suggestions.map((feature, idx) => {
                    const prop = feature.properties;
                    const streetName = prop.name || '';
                    const districtName = prop.district || prop.suburb || '';
                    const cityName = prop.city || '';
                    const label = [streetName, districtName, cityName].filter(Boolean).join(', ');

                    return (
                      <div 
                        key={idx} 
                        onClick={() => handleSelectSuggestion(feature)}
                        style={{
                          padding: '0.6rem 1rem',
                          fontSize: '0.85rem',
                          color: '#e0e0e0',
                          cursor: 'pointer',
                          borderBottom: idx < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        {label}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="input-group">
              <label htmlFor="address-complement" style={{ fontSize: '0.8rem' }}>Complemento</label>
              <input id="address-complement" type="text" placeholder="Apto / Bloco" value={complement} onChange={(e) => setComplement(e.target.value)} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none', fontSize: '0.85rem' }} />
            </div>

            {/* Minimapa para geolocalização do cliente */}
            {(addressCoords || geocoding) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem', width: '100%' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
                  <span className="pulse-dot" style={{ width: '6px', height: '6px', backgroundColor: 'var(--primary-gold)', borderRadius: '50%' }}></span>
                  {geocoding ? 'Localizando endereço no mapa...' : 'Confirme sua localização no mapa:'}
                </span>
                <div 
                  ref={miniMapContainerRef} 
                  style={{ 
                    width: '100%', 
                    height: '180px', 
                    borderRadius: '10px', 
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    zIndex: 1,
                    opacity: geocoding ? 0.6 : 1,
                    transition: 'opacity 0.2s'
                  }} 
                />
              </div>
            )}

            <button type="submit" disabled={submitting || cart.length === 0} className="auth-btn auth-btn-login" style={{ marginTop: '0.5rem', padding: '0.6rem' }}>
              {submitting ? (
                <>
                  <span className="spinner"></span>
                  <span>Confirmando...</span>
                </>
              ) : (
                <span>Confirmar Pedido</span>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Novidades do Instagram */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Novidades no Instagram 📸
          </h3>
          <a href="https://www.instagram.com/donalupastelaria/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-gold)', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600 }}>
            @donalupastelaria
          </a>
        </div>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1rem',
          marginTop: '1rem'
        }}>
          {[
            { img: pastelCrocante, text: 'Borda recheada e crocante irresistível! 🧀' },
            { img: pastelFrito, text: 'Pastéis quentinhos fritos na hora! 🔥' },
            { img: pastelRefri, text: 'A combinação perfeita com refrigerante gelado! 🥤' },
            { img: pastelCombo, text: 'Conheça nossos combos promocionais da semana! 🥟' }
          ].map((post, idx) => (
            <div key={idx} style={{
              background: 'var(--bg-card)',
              borderRadius: '12px',
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.03)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
              transition: 'transform 0.2s',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-3px)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            onClick={() => window.open('https://www.instagram.com/donalupastelaria/', '_blank')}
            >
              <div style={{ position: 'relative', paddingTop: '100%' }}>
                <img src={post.img} alt="Instagram Post" style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }} />
              </div>
              <div style={{ padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                {post.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox Modal para fotos ampliada */}
      {zoomedImage && (
        <div className="lightbox-overlay" onClick={() => setZoomedImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lightbox-close-btn" onClick={() => setZoomedImage(null)} aria-label="Fechar imagem">
              <X size={20} />
            </button>
            <img src={zoomedImage} alt="Pastel Expandido" className="lightbox-img" />
          </div>
        </div>
      )}
    </div>
  );
};
export default ClientDashboard;
