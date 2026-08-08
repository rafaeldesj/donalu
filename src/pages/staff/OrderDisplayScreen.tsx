import React, { useEffect, useState, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { OrderDocument } from '../../types/order';
import { Maximize, Minimize } from 'lucide-react';

const OrderDisplayScreen: React.FC = () => {
  const [preparingOrders, setPreparingOrders] = useState<OrderDocument[]>([]);
  const [readyOrders, setReadyOrders] = useState<OrderDocument[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ordersRef = collection(db, 'orders');
    
    // Pegar pedidos de hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfDayStr = today.toISOString();

    const q = query(
      ordersRef,
      where('status', 'in', ['preparing', 'prepared', 'ready'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allActive: OrderDocument[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        // Filtro local da data para evitar necessidade de índice composto no Firestore
        if (data.createdAt >= startOfDayStr) {
          allActive.push({ id: doc.id, ...data } as OrderDocument);
        }
      });

      const preparing = allActive.filter(o => o.status === 'preparing' || o.status === 'prepared')
                                 .sort((a, b) => (a.dailySeq || 0) - (b.dailySeq || 0));
      const ready = allActive.filter(o => o.status === 'ready')
                             .sort((a, b) => new Date(b.kitchenFinishedAt || b.createdAt).getTime() - new Date(a.kitchenFinishedAt || a.createdAt).getTime());

      setPreparingOrders(preparing);
      setReadyOrders(ready);
      setErrorMsg(null);
    }, (error) => {
      console.error("Erro na consulta de pedidos (Mostrador):", error);
      setErrorMsg(error.message);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const latestReady = readyOrders.length > 0 ? readyOrders[0] : null;
  const otherReady = readyOrders.slice(1);

  return (
    <div 
      ref={containerRef}
      style={{ 
        display: 'flex', 
        width: '100%', 
        height: isFullscreen ? '100vh' : 'calc(100vh - 120px)', // adjust for padding if not fullscreen
        backgroundColor: '#fff',
        fontFamily: 'Inter, sans-serif',
        color: '#000',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Botão de Tela Cheia */}
      <button 
        onClick={toggleFullscreen}
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          background: isFullscreen ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
          border: 'none',
          borderRadius: '50%',
          width: isFullscreen ? '30px' : '40px',
          height: isFullscreen ? '30px' : '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: isFullscreen ? 0.3 : 0.7,
          transition: 'all 0.2s ease',
          zIndex: 50
        }}
        title={isFullscreen ? "Sair da Tela Cheia" : "Tela Cheia"}
      >
        {isFullscreen ? <Minimize size={14} color="#000" /> : <Maximize size={20} color="#000" />}
      </button>

      {errorMsg && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1rem', background: '#ff4c4c', color: 'white', textAlign: 'center', fontSize: '1.2rem', fontWeight: 'bold', zIndex: 100 }}>
          ERRO: {errorMsg}
        </div>
      )}

      {/* Lado Esquerdo - Preparando */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '4px solid #ddd' }}>
        <div style={{ 
          backgroundColor: '#9ca3af', // cinza chumbo / prateado
          color: '#fff', 
          padding: '1.5rem', 
          textAlign: 'center', 
          fontSize: '3vw', 
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '-1px'
        }}>
          Preparando
        </div>
        <div style={{ 
          flex: 1, 
          padding: '2rem', 
          display: 'flex', 
          flexWrap: 'wrap', 
          alignContent: 'flex-start',
          gap: '2rem',
          overflowY: 'auto'
        }}>
          {preparingOrders.map(order => (
            <div key={order.id} style={{ 
              fontSize: '4.5vw', 
              fontWeight: 800, 
              color: '#374151', 
              width: '45%',
              textAlign: 'center'
            }}>
              {order.dailySeq?.toString().padStart(3, '0') || '---'}
            </div>
          ))}
        </div>
      </div>

      {/* Lado Direito - Pronto */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ 
          backgroundColor: '#ef4444', // vermelho bem forte
          color: '#fff', 
          padding: '1.5rem', 
          textAlign: 'center', 
          fontSize: '3vw', 
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '-1px'
        }}>
          Pronto
        </div>
        
        <div style={{ 
          flex: 1, 
          padding: '2rem', 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center',
          overflowY: 'auto'
        }}>
          {/* Destaque para o último */}
          {latestReady && (
            <div style={{
              fontSize: '12vw',
              fontWeight: 900,
              color: '#111827',
              lineHeight: 1,
              marginBottom: '3rem',
              animation: 'pulse 2s infinite',
              borderBottom: '4px solid #ef4444',
              padding: '0 2rem 1rem 2rem'
            }}>
              {latestReady.dailySeq?.toString().padStart(3, '0') || '---'}
            </div>
          )}

          {/* Lista dos demais prontos */}
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            justifyContent: 'center',
            gap: '2rem'
          }}>
            {otherReady.map(order => (
              <div key={order.id} style={{ 
                fontSize: '4.5vw', 
                fontWeight: 800, 
                color: '#4b5563', 
                textAlign: 'center'
              }}>
                {order.dailySeq?.toString().padStart(3, '0') || '---'}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); color: #ef4444; }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default OrderDisplayScreen;
