import { useState, useEffect, useRef } from 'react';
import { ClientSupportChat } from './ClientSupportChat';
import { X, Bot } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const VirtualAssistantBubble = () => {
  const { userData } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  
  // Dragging states
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    hasMoved: false
  });

  const role = userData?.role || 'client';
  const staff = userData?.staffFunctions;
  const isClientOrVisitor = role === 'client' || (role === 'staff' && staff?.delivery);

  useEffect(() => {
    if (!isClientOrVisitor) return;
    
    const timerShow = setTimeout(() => {
      setShowGreeting(true);
    }, 4000);

    const timerHide = setTimeout(() => {
      setShowGreeting(false);
    }, 10000);

    return () => {
      clearTimeout(timerShow);
      clearTimeout(timerHide);
    };
  }, [isClientOrVisitor]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: PointerEvent) => {
      e.preventDefault(); // prevent scrolling while dragging on touch
      dragRef.current.hasMoved = true;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setOffset({
        x: dragRef.current.startOffsetX + dx,
        y: dragRef.current.startOffsetY + dy
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // only left click
    
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
      hasMoved: false
    };
    setIsDragging(true);
    // Optionally capture pointer to prevent losing drag on touch
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (dragRef.current.hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setIsOpen(!isOpen);
    setShowGreeting(false);
  };

  if (!isClientOrVisitor) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      transform: `translate(${offset.x}px, ${offset.y}px)`,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      fontFamily: 'system-ui, sans-serif'
    }}>
      
      {/* Floating Chat Box Panel */}
      {isOpen && (
        <div style={{
          marginBottom: '12px',
          width: '340px',
          maxWidth: 'calc(100vw - 48px)',
          animation: 'fade-in 0.25s ease-out'
        }}>
          <ClientSupportChat isFloating={true} onClose={() => setIsOpen(false)} />
        </div>
      )}

      {/* Welcome Tooltip Greeting Bubble */}
      {showGreeting && !isOpen && (
        <div style={{
          background: 'var(--primary-gold, #f59e0b)',
          color: '#000',
          padding: '0.5rem 0.85rem',
          borderRadius: '10px 10px 2px 10px',
          fontSize: '0.82rem',
          fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          marginBottom: '10px',
          marginRight: '6px',
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          animation: 'bounce 2s infinite',
          pointerEvents: 'none'
        }}>
          <span>🥟 Dúvidas? Fale comigo!</span>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setShowGreeting(false);
            }} 
            style={{ pointerEvents: 'auto', background: 'none', border: 'none', color: '#000', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', padding: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Floating Action Button Bubble */}
      <button
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: isOpen ? '#1e293b' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          border: 'none',
          color: isOpen ? '#fff' : '#000',
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          transition: isDragging ? 'none' : 'background 0.2s',
          outline: 'none',
          touchAction: 'none' // important for touch dragging
        }}
        onMouseEnter={(e) => { if(!isDragging) e.currentTarget.style.transform = 'scale(1.08)' }}
        onMouseLeave={(e) => { if(!isDragging) e.currentTarget.style.transform = 'scale(1)' }}
        title={isOpen ? "Fechar Chat" : "Falar com Atendente Virtual (Arraste para mover)"}
      >
        {isOpen ? <X size={24} /> : <Bot size={26} />}
      </button>

      {/* Keyframe animations injected inline */}
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
      `}</style>

    </div>
  );
};
