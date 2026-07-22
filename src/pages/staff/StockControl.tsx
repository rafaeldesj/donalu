import { useEffect, useState } from 'react';
import { collection, query, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Boxes, Search, Plus, Minus, EyeOff, Eye, AlertTriangle } from 'lucide-react';

interface Product {
  id: number;
  name: string;
  price: number;
  description: string;
  image?: string;
  category: string;
  stock?: number;
  hideWhenOutOfStock?: boolean;
}

export const StockControl = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  // 1. Listen to products in Firestore
  useEffect(() => {
    const q = query(collection(db, 'products'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsList: Product[] = [];
      const cats = new Set<string>();
      
      snapshot.forEach((docSnap) => {
        const prod = docSnap.data() as Product;
        itemsList.push(prod);
        if (prod.category) {
          cats.add(prod.category);
        }
      });
      
      itemsList.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(itemsList);
      setCategories(Array.from(cats).sort());
      setLoading(false);
    }, (err) => {
      console.error("Erro ao carregar estoque:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Update product stock and settings in Firestore
  const updateProductData = async (product: Product, updates: Partial<Product>) => {
    setSavingId(product.id);
    try {
      const docId = product.id.toString();
      const updatedProduct = {
        ...product,
        ...updates
      };
      // Clean undefined fields for Firestore
      if (updatedProduct.stock === undefined) updatedProduct.stock = 0;
      if (updatedProduct.hideWhenOutOfStock === undefined) updatedProduct.hideWhenOutOfStock = false;
      
      await setDoc(doc(db, 'products', docId), updatedProduct);
    } catch (err) {
      console.error("Erro ao salvar estoque no Firestore:", err);
    } finally {
      setTimeout(() => {
        setSavingId(null);
      }, 500);
    }
  };

  // Filtered list
  const filteredProducts = products.filter((p) => {
    const matchesCategory = activeCategory === 'todos' || p.category === activeCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  // Stock Summary statistics
  const totalItems = products.length;
  const outOfStockItems = products.filter(p => p.stock !== undefined && p.stock <= 0).length;
  const hiddenWhenEmptyItems = products.filter(p => p.hideWhenOutOfStock === true).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '0.2rem' }} className="animate-fade-in">
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Boxes size={24} style={{ color: 'var(--primary-gold)' }} />
            Controle de Estoque
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Monitore a quantidade de ingredientes e produtos do cardápio digital em tempo real.
          </p>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
      }}>
        <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total de Itens</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: '#fff' }}>{totalItems}</span>
        </div>
        <div style={{ background: 'rgba(239, 68, 68, 0.04)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#fca5a5' }}>Sem Estoque (Zerar)</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {outOfStockItems}
            {outOfStockItems > 0 && <AlertTriangle size={18} />}
          </span>
        </div>
        <div style={{ background: 'rgba(245, 158, 11, 0.04)', border: '1px solid rgba(245, 158, 11, 0.15)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#fde047' }}>Config. Ocultar se Zerar</span>
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary-gold)' }}>{hiddenWhenEmptyItems}</span>
        </div>
      </div>

      {/* Controles: Busca e Filtro de Categoria */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.01)',
        border: '1px solid rgba(255, 255, 255, 0.04)',
        borderRadius: '12px',
        padding: '1rem'
      }}>
        {/* Barra de Busca */}
        <div style={{ position: 'relative', flex: '1 1 250px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input
            type="text"
            placeholder="Buscar produto ou descrição..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 1rem 0.65rem 2.25rem',
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#fff',
              outline: 'none',
              fontSize: '0.9rem',
              transition: 'border-color 0.2s'
            }}
          />
        </div>

        {/* Abas de Categorias */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setActiveCategory('todos')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: activeCategory === 'todos' ? '1px solid var(--primary-gold)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: activeCategory === 'todos' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.02)',
              color: activeCategory === 'todos' ? 'var(--primary-gold)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              transition: 'all 0.2s'
            }}
          >
            Todos
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: activeCategory === cat ? '1px solid var(--primary-gold)' : '1px solid rgba(255, 255, 255, 0.08)',
                background: activeCategory === cat ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                color: activeCategory === cat ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                transition: 'all 0.2s'
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Produtos do Estoque */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem', width: '30px', height: '30px' }}></div>
          Carregando dados de estoque...
        </div>
      ) : filteredProducts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(255,255,255,0.01)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
          Nenhum produto encontrado com os filtros selecionados.
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          {filteredProducts.map((product) => {
            const isOutOfStock = product.stock !== undefined && product.stock <= 0;
            const isSaving = savingId === product.id;

            return (
              <div
                key={product.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: isOutOfStock ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '12px',
                  padding: '1rem',
                  transition: 'background 0.2s, border-color 0.2s'
                }}
              >
                
                {/* Info do Produto */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: '1 1 280px' }}>
                  {product.image ? (
                    <img 
                      src={product.image} 
                      alt={product.name} 
                      style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', border: '1px solid rgba(255, 255, 255, 0.08)' }} 
                    />
                  ) : (
                    <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                      🥟
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#fff', fontSize: '1rem' }}>{product.name}</span>
                      <span style={{
                        fontSize: '0.72rem',
                        background: 'rgba(255, 255, 255, 0.06)',
                        color: 'var(--text-secondary)',
                        padding: '0.15rem 0.4rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(255,255,255,0.03)'
                      }}>
                        {product.category}
                      </span>
                      {isOutOfStock && (
                        <span style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.1)' }}>
                          Esgotado
                        </span>
                      )}
                    </div>
                    {product.description && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.2' }}>
                        {product.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* Preço de referência */}
                <div style={{ minWidth: '80px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Preço</span>
                  <span style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>R$ {product.price.toFixed(2).replace('.', ',')}</span>
                </div>

                {/* Controle de Estoque Qtd */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '150px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Qtd. em Estoque</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        const currentVal = product.stock !== undefined ? Number(product.stock) : 0;
                        if (currentVal > 0) {
                          updateProductData(product, { stock: currentVal - 1 });
                        }
                      }}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s',
                        opacity: isSaving ? 0.5 : 1
                      }}
                      title="Diminuir"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      defaultValue={product.stock !== undefined ? product.stock : 0}
                      key={product.stock} // reload value when db updates
                      disabled={isSaving}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) {
                          updateProductData(product, { stock: Math.max(0, val) });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = parseInt((e.target as HTMLInputElement).value);
                          if (!isNaN(val)) {
                            updateProductData(product, { stock: Math.max(0, val) });
                            (e.target as HTMLInputElement).blur();
                          }
                        }
                      }}
                      style={{
                        width: '55px',
                        height: '28px',
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        borderRadius: '6px',
                        color: '#fff',
                        textAlign: 'center',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        outline: 'none'
                      }}
                    />
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        const currentVal = product.stock !== undefined ? Number(product.stock) : 0;
                        updateProductData(product, { stock: currentVal + 1 });
                      }}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s',
                        opacity: isSaving ? 0.5 : 1
                      }}
                      title="Aumentar"
                    >
                      <Plus size={14} />
                    </button>
                    {isSaving && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--primary-gold)', marginLeft: '0.25rem' }}>
                        ✓
                      </span>
                    )}
                  </div>
                </div>

                {/* Configuração de Exibição */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '180px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Configuração de Ocultação</span>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.85rem',
                    color: product.hideWhenOutOfStock ? 'var(--primary-gold)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '0.25rem 0'
                  }}>
                    <input
                      type="checkbox"
                      checked={product.hideWhenOutOfStock === true}
                      onChange={(e) => {
                        updateProductData(product, { hideWhenOutOfStock: e.target.checked });
                      }}
                      style={{ cursor: 'pointer', width: '15px', height: '15px', margin: 0 }}
                    />
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {product.hideWhenOutOfStock ? (
                        <>
                          <EyeOff size={14} />
                          Ocultar no cardápio se zerar
                        </>
                      ) : (
                        <>
                          <Eye size={14} />
                          Manter visível se zerar
                        </>
                      )}
                    </span>
                  </label>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StockControl;
