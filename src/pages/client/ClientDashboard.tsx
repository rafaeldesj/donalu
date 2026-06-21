import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ShoppingBag, MapPin, Plus, Minus, Trash2, CheckCircle } from 'lucide-react';
import { collection, addDoc } from 'firebase/firestore';
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
}

export const ClientDashboard = ({ showOnly, isVisitor = false, onLoginRequired }: ClientDashboardProps) => {
  const { user, userData } = useAuth();

  const mockPastels = [
    { id: 1, name: 'Pastel de Carne com Queijo', price: 12.00, description: 'Carne moída temperada com queijo mussarela derretido.' },
    { id: 2, name: 'Pastel de Frango Catupiry', price: 11.50, description: 'Peito de frango desfiado com o autêntico Catupiry.' },
    { id: 3, name: 'Pastel de Vento Especial', price: 6.00, description: 'Aquele clássico dourado e crocante de feira.' },
    { id: 4, name: 'Pastel Doce de Nutella com Morango', price: 14.00, description: 'Sobremesa perfeita recheada com Nutella e morangos frescos.' },
  ];

  // Estados
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [street, setStreet] = useState(userData?.clientAddress?.street || '');
  const [number, setNumber] = useState(userData?.clientAddress?.number || '');
  const [neighborhood, setNeighborhood] = useState(userData?.clientAddress?.neighborhood || '');
  const [complement, setComplement] = useState(userData?.clientAddress?.complement || '');
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addToCart = (item: typeof mockPastels[0]) => {
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

    if (!street || !number || !neighborhood) {
      setError('Por favor, preencha os dados de entrega obrigatórios (Rua, Número e Bairro).');
      return;
    }

    setSubmitting(true);
    try {
      const orderData = {
        clientUid: user?.uid || '',
        clientName: user?.displayName || user?.email || 'Cliente Anônimo',
        items: cart,
        total: cartTotal,
        status: 'pending',
        createdAt: new Date().toISOString(),
        address: {
          street,
          number,
          neighborhood,
          city: 'Rio de Janeiro',
          zipCode: '23000-000',
          complement,
        },
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
          <h3>Pastéis Fritos na Hora</h3>
          <div className="pastels-list">
            {mockPastels.map((pastel) => (
              <div key={pastel.id} className="pastel-card">
                <div className="pastel-details">
                  <h4>{pastel.name}</h4>
                  <p>{pastel.description}</p>
                  <span className="pastel-price">R$ {pastel.price.toFixed(2).replace('.', ',')}</span>
                </div>
                <button type="button" onClick={() => addToCart(pastel)} className="add-to-cart-btn" aria-label={`Adicionar ${pastel.name} ao carrinho`}>
                  <ShoppingBag size={18} />
                </button>
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
            <div className="input-group">
              <label htmlFor="address-street" style={{ fontSize: '0.8rem' }}>Rua</label>
              <div className="input-wrapper">
                <MapPin size={16} className="input-icon" />
                <input id="address-street" type="text" placeholder="Rua das Flores" value={street} onChange={(e) => setStreet(e.target.value)} style={{ padding: '0.5rem 0.5rem 0.5rem 2.2rem', fontSize: '0.85rem' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div className="input-group" style={{ flex: 1 }}>
                <label htmlFor="address-number" style={{ fontSize: '0.8rem' }}>Número</label>
                <input id="address-number" type="text" placeholder="123" value={number} onChange={(e) => setNumber(e.target.value)} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none', fontSize: '0.85rem' }} />
              </div>
              <div className="input-group" style={{ flex: 2 }}>
                <label htmlFor="address-neighborhood" style={{ fontSize: '0.8rem' }}>Bairro</label>
                <input id="address-neighborhood" type="text" placeholder="Centro" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none', fontSize: '0.85rem' }} />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="address-complement" style={{ fontSize: '0.8rem' }}>Complemento</label>
              <input id="address-complement" type="text" placeholder="Apto / Bloco" value={complement} onChange={(e) => setComplement(e.target.value)} style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none', fontSize: '0.85rem' }} />
            </div>

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
    </div>
  );
};
export default ClientDashboard;
