import React, { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';
import { Star, MessageSquareQuote, TrendingUp, Calendar } from 'lucide-react';

export const CustomerReviews: React.FC = () => {
  const [reviews, setReviews] = useState<OrderDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setLoading(true);
      setError(null);
      // Busca apenas pedidos finalizados
      const q = query(collection(db, 'orders'), where('status', '==', 'completed'));
      const snapshot = await getDocs(q);
      
      const loadedReviews: OrderDocument[] = [];
      snapshot.forEach(doc => {
        const data = doc.data() as OrderDocument;
        if (data.satisfactionRating && data.satisfactionRating > 0) {
          loadedReviews.push({ ...data, id: doc.id });
        }
      });
      
      // Ordena por data mais recente localmente (evita índice composto no Firebase)
      loadedReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setReviews(loadedReviews);
    } catch (err: any) {
      console.error("Erro ao buscar avaliações:", err);
      setError("Não foi possível carregar as avaliações dos clientes.");
    } finally {
      setLoading(false);
    }
  };

  const averageRating = reviews.length > 0
    ? (reviews.reduce((acc, curr) => acc + (curr.satisfactionRating || 0), 0) / reviews.length).toFixed(1)
    : '0.0';

  const fiveStarsCount = reviews.filter(r => r.satisfactionRating === 5).length;
  const percentageFiveStars = reviews.length > 0 ? Math.round((fiveStarsCount / reviews.length) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh', background: 'var(--bg-main)', padding: '2rem' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Avaliações dos Clientes ⭐</h2>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', color: '#f87171', padding: '1rem', marginBottom: '1.5rem', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      {/* Cards de Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Star size={16} color="var(--primary-gold)" /> Média Geral
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--primary-gold)' }}>
            {averageRating}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            De {reviews.length} avaliações recebidas
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={16} color="#10b981" /> Excelência (5 Estrelas)
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#10b981' }}>
            {percentageFiveStars}%
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {fiveStarsCount} clientes amaram a experiência
          </div>
        </div>
      </div>

      {/* Lista de Avaliações */}
      <div style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MessageSquareQuote size={20} color="var(--primary-gold)" /> 
          <h3 style={{ margin: 0 }}>Últimos Feedbacks</h3>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Carregando avaliações...
          </div>
        ) : reviews.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Nenhuma avaliação encontrada até o momento.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {reviews.map(review => (
              <div key={review.id} style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{review.clientName}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                      <Calendar size={14} />
                      {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(review.createdAt))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star 
                        key={star} 
                        size={18} 
                        fill={star <= (review.satisfactionRating || 0) ? 'var(--primary-gold)' : 'transparent'} 
                        color={star <= (review.satisfactionRating || 0) ? 'var(--primary-gold)' : 'rgba(255,255,255,0.2)'} 
                      />
                    ))}
                  </div>
                </div>
                
                {review.satisfactionFeedback && review.satisfactionFeedback.trim() !== '' && (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', borderLeft: '3px solid var(--primary-gold)', color: 'var(--text-primary)', fontStyle: 'italic', fontSize: '0.95rem' }}>
                    "{review.satisfactionFeedback}"
                  </div>
                )}
                
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                  Pedido #{review.id?.slice(-4).toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default CustomerReviews;
