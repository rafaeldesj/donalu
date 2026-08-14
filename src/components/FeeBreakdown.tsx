import React, { useState } from 'react';

import { API_BASE_URL } from '../config/api';

interface FeeBreakdownProps {
  transactionId: string | null;
  token?: string;
}

export const FeeBreakdown: React.FC<FeeBreakdownProps> = ({ transactionId, token = 'mock' }) => {
  const [fees, setFees] = useState<{ mpFee: number; devFee: number; netAmount: number; grossAmount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadFees = async () => {
    if (!transactionId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/pagamentos/get-payment-fees?transactionId=${transactionId}&token=${token}`);
      const data = await res.json();
      if (data.success) {
        setFees(data.fees);
      } else {
        setError(data.message || 'Erro ao carregar taxas.');
      }
    } catch (e: any) {
      setError('Erro de conexão ao carregar taxas.');
    } finally {
      setLoading(false);
    }
  };

  if (!transactionId) return null;

  if (fees) {
    return (
      <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span>Venda Bruta:</span>
          <span>R$ {fees.grossAmount.toFixed(2).replace('.', ',')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#ef4444' }}>
          <span>Taxa MP Oficial:</span>
          <span>- R$ {fees.mpFee.toFixed(2).replace('.', ',')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#f59e0b' }}>
          <span>Taxa Split (Dev):</span>
          <span>- R$ {fees.devFee.toFixed(2).replace('.', ',')}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', color: '#10b981', fontWeight: 700, marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
          <span>Você Recebe:</span>
          <span>R$ {fees.netAmount.toFixed(2).replace('.', ',')}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '0.5rem', width: '100%' }}>
      <button 
        type="button"
        onClick={loadFees} 
        disabled={loading}
        style={{ 
          width: '100%', 
          padding: '0.5rem', 
          background: 'transparent', 
          color: 'var(--text-secondary)', 
          border: '1px dashed rgba(255,255,255,0.1)', 
          borderRadius: '8px', 
          cursor: 'pointer',
          fontSize: '0.85rem'
        }}
      >
        {loading ? 'Carregando taxas...' : 'Ver Detalhamento de Taxas e Recebíveis'}
      </button>
      {error && <span style={{ display: 'block', color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem', textAlign: 'center' }}>{error}</span>}
    </div>
  );
};
