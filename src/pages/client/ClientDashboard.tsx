import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ShoppingBag, MapPin, Plus, Minus, Trash2, Edit2, Check, X, Upload } from 'lucide-react';
import { DeliveryMap } from '../../components/DeliveryMap';
import type { MapAddress } from '../../components/DeliveryMap';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderItem } from '../../types/order';
import pastelCrocante from '../../assets/pastel_crocante.png';
import pastelFrito from '../../assets/pastel_frito.png';
import pastelRefri from '../../assets/pastel_refri.png';
import pastelCombo from '../../assets/pastel_combo.png';



interface ClientDashboardProps {
  showOnly?: 'menu' | 'loyalty';
  isVisitor?: boolean;
  onLoginRequired?: () => void;
  onNavigate?: (view: string) => void;
}

export const ClientDashboard = ({ showOnly, isVisitor = false, onLoginRequired, onNavigate }: ClientDashboardProps) => {
  const { user, userData, updatePhoneNumber } = useAuth();

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
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState<MapAddress | null>(null);
  const [orderType, setOrderType] = useState<'pickup' | 'delivery'>('pickup');
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'credito' | 'debito' | 'dinheiro'>('pix');
  const [changeFor, setChangeFor] = useState('');
  const [showOrderSummary, setShowOrderSummary] = useState(false);

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

  const paymentLabels: Record<string, string> = {
    pix: 'Pix',
    credito: 'Cartão de Crédito',
    debito: 'Cartão de Débito',
    dinheiro: 'Dinheiro',
  };

  const handleOpenSummary = () => {
    setError(null);
    if (cart.length === 0) { setError('O seu carrinho está vazio.'); return; }
    if (orderType === 'delivery' && (!deliveryAddress || !deliveryAddress.street)) {
      setError('Selecione o endereço de entrega no mapa antes de continuar.');
      return;
    }
    if (!paymentMethod) { setError('Selecione a forma de pagamento.'); return; }
    
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

  const handlePlaceOrder = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Calcula o número sequencial do pedido para o dia de negócios atual (inicia às 6h da manhã)
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
        total: cartTotal,
        status: 'pending',
        createdAt: new Date().toISOString(),
        orderType,
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
      setShowOrderSummary(false);
      setPaymentMethod('pix');
      setChangeFor('');
      setOrderType('pickup');
      setOrderPlaced(true);
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.5rem' }}>
            <h3 style={{ margin: 0, border: 'none', padding: 0 }}>Pastéis Gourmet Especiais</h3>
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

          {/* Seleção: Retirada ou Entrega */}
          <div className="loyalty-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--primary-gold)' }}>🛵</span> Como deseja retirar?
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => { setOrderType('pickup'); setDeliveryAddress(null); }}
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
                  gap: '0.4rem',
                }}
              >
                <span style={{ fontSize: '1.6rem' }}>🏪</span>
                <span>Vou na loja retirar</span>
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
                  gap: '0.4rem',
                }}
              >
                <span style={{ fontSize: '1.6rem' }}>🛵</span>
                <span>Quero que me entregue</span>
              </button>
            </div>

            {orderType === 'pickup' && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '0.5rem 0.75rem', lineHeight: '1.5' }}>
                📍 <strong style={{ color: '#fff' }}>Dona Lu Pastelaria</strong> &mdash; Rua Jícara, 239 · Campo Grande · RJ
              </div>
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
                  onAddressSelect={(addr) => setDeliveryAddress(addr)}
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
                {([['pix','Pix 🟡'],['credito','Crédito 💳'],['debito','Débito 💴'],['dinheiro','Dinheiro 💵']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPaymentMethod(val)}
                    style={{
                      padding: '0.6rem 0.5rem',
                      borderRadius: '10px',
                      border: paymentMethod === val
                        ? '2px solid var(--primary-gold)'
                        : '1px solid rgba(255,255,255,0.08)',
                      background: paymentMethod === val
                        ? 'rgba(245,158,11,0.12)'
                        : 'rgba(255,255,255,0.02)',
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
                <div style={{ marginTop: '0.6rem' }}>
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
            </div>

            <button
              type="submit"
              disabled={cart.length === 0 || (orderType === 'delivery' && !deliveryAddress)}
              className="auth-btn auth-btn-login"
              style={{ marginTop: '6px', padding: '0.7rem', fontSize: '0.95rem', fontWeight: 700 }}
            >
              <span>🛒 Ver Resumo do Pedido</span>
            </button>
          </form>
        </div>
      </div>

      {/* Lightbox Modal para fotos ampliadas */}
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
              padding: '2rem',
              width: '100%',
              maxWidth: '480px',
              maxHeight: '90vh',
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
                {cart.map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                    <span style={{ color: '#fff' }}>
                      <strong style={{ color: 'var(--primary-gold)' }}>{item.quantity}x</strong> {item.name}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      R$ {(item.price * item.quantity).toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.75rem', paddingTop: '0.75rem', fontWeight: 700, fontSize: '1.05rem' }}>
                <span>Total</span>
                <span style={{ color: 'var(--primary-gold)' }}>R$ {cartTotal.toFixed(2).replace('.', ',')}</span>
              </div>
            </div>

            {/* Retirada ou Entrega */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
              <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                {orderType === 'delivery' ? '📍 Entrega em' : '🏪 Retirada em'}
              </h4>
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
                </>
              ) : (
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>
                  Dona Lu Pastelaria &mdash; Rua Jícara, 239 · Campo Grande · RJ
                </p>
              )}
            </div>

            {/* Forma de Pagamento */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
              <h4 style={{ margin: '0 0 0.4rem 0', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>💳 Pagamento</h4>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>{paymentLabels[paymentMethod]}</p>
              {paymentMethod === 'dinheiro' && changeFor && (
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Troco para R$ {parseFloat(changeFor.replace(',', '.')).toFixed(2).replace('.', ',')} · Troco: R$ {Math.max(0, parseFloat(changeFor.replace(',', '.')) - cartTotal).toFixed(2).replace('.', ',')}
                </p>
              )}
            </div>

            {error && <div className="auth-error-message">{error}</div>}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
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
    </div>
  );
};
export default ClientDashboard;
