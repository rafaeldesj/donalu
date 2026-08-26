import { useState, useEffect } from 'react';
import { X, QrCode, CreditCard, Wallet, Smartphone, Landmark } from 'lucide-react';
import { MercadoPagoCardForm } from '../../../components/MercadoPagoCardForm';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { API_BASE_URL } from '../../../config/api';
import type { OrderDocument } from '../../../types/order';
import { processOrderLoyaltyStamps } from '../../../utils/loyalty';

interface CheckoutTabModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: OrderDocument[];
  storeConfig: any;
  user: any;
  userData: any;
}

export function CheckoutTabModal({ isOpen, onClose, orders, storeConfig, user, userData }: CheckoutTabModalProps) {
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // States for Pix
  const [pixQrCodeBase64, setPixQrCodeBase64] = useState('');
  const [pixQrCode, setPixQrCode] = useState('');
  const [pixPaymentId, setPixPaymentId] = useState<number | null>(null);
  const [pixStatus, setPixStatus] = useState<string | null>(null);

  const total = orders.reduce((sum, o) => sum + o.total, 0);
  const allItems = orders.flatMap(o => o.items || []);

  const allowedMethods = storeConfig?.payAtEndSubMethods || [];

  // Polling for Pix
  useEffect(() => {
    if (!pixPaymentId || pixStatus !== 'pending') return;

    let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
    if (!token || token === 'null' || token === 'undefined' || 
        token.startsWith('APP_USR-MOCK-') || token.includes('-MOCK-')) {
      token = 'mock';
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/pagamentos/check-pix?paymentId=${pixPaymentId}&token=${token}`);
        const result = await res.json();
        console.log('[DEBUG PIX POLL]', result);
        
        if (result.success && result.status === 'approved') {
          setPixStatus('approved');
          clearInterval(interval);
          await finishCheckout('pix', 'completed');
        } else if (result.success && result.status === 'rejected') {
          setPixStatus('rejected');
          clearInterval(interval);
          setError("Pagamento Pix recusado.");
        } else if (result.success && result.status !== 'pending') {
          setPixStatus('rejected');
          clearInterval(interval);
          setError("Pagamento Pix recusado.");
        }
      } catch (err) {
        console.error("Erro ao verificar Pix:", err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [pixPaymentId, pixStatus]);

  if (!isOpen) return null;

  const handlePhysicalPayment = async (method: string) => {
    setLoading(true);
    setError(null);
    try {
      await finishCheckout(method, 'aguardando_caixa');
    } catch (err: any) {
      setError(err.message || 'Erro ao processar o pagamento presencial.');
      setLoading(false);
    }
  };

  const handleGeneratePix = async () => {
    setLoading(true);
    setError(null);
    try {
      let token = storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock';
      if (!token || token === 'null' || token === 'undefined' || 
          token.startsWith('APP_USR-MOCK-') || token.includes('-MOCK-')) {
        token = 'mock';
      }

      const isStoreOwnerConnected = storeConfig?.storeOwnerAccessToken && 
                                    !storeConfig.storeOwnerAccessToken.includes('MOCK') &&
                                    storeConfig.storeOwnerAccessToken !== 'mock';

      const secureToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

      const response = await fetch(`${API_BASE_URL}/api/pagamentos/create-pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          amount: total,
          email: 'comprador.donalu@gmail.com', // Fixado para evitar rejected_high_risk em testes
          name: 'Cliente Dona Lu',
          cpf: userData?.cpf || '80288053702',
          devPercentage: isStoreOwnerConnected ? (storeConfig?.devPercentage || 0) : 0,
          orderId: `FECHAR_CONTA_${Date.now()}`,
          paymentVerificationToken: secureToken
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Erro ao gerar Pix.');

      setPixPaymentId(result.paymentId);
      setPixQrCodeBase64(result.qrCodeBase64);
      setPixQrCode(result.qrCode);
      setPixStatus('pending');
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar Pix.');
    } finally {
      setLoading(false);
    }
  };

  const finishCheckout = async (method: string, targetStatus: 'completed' | 'aguardando_caixa') => {
    try {
      // 1. Create aggregate Fatura order
      const faturaOrder: Partial<OrderDocument> = {
        clientUid: user.uid,
        clientName: user.displayName || 'Cliente',
        clientPhone: userData?.phone || '',
        orderType: orders[0]?.orderType || 'dine_in_table',
        tableNumber: orders[0]?.tableNumber,
        status: targetStatus,
        paymentMethod: method,
        items: allItems,
        total: total,
        createdAt: new Date().toISOString(),
      };
      
      const newOrderRef = await addDoc(collection(db, 'orders'), faturaOrder);

      // 2. Mark old orders as merged
      const batchPromises = orders.map(async (o) => {
        await updateDoc(doc(db, 'orders', o.id!), {
          status: 'merged',
          mergedInto: newOrderRef.id,
          updatedAt: new Date().toISOString()
        });
      });
      await Promise.all(batchPromises);

      // 3. Clear table from user if applicable
      if (targetStatus === 'completed' && user) {
        await updateDoc(doc(db, 'users', user.uid), { tableNumber: null });
        await processOrderLoyaltyStamps(newOrderRef.id, faturaOrder as OrderDocument);
      }

      alert("Conta fechada com sucesso!");
      onClose();
    } catch (err) {
      console.error(err);
      throw new Error("Erro ao finalizar os pedidos.");
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 99999, padding: '1rem'
    }}>
      <div style={{
        background: '#1a1f2e', width: '100%', maxWidth: '450px',
        borderRadius: '20px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', position: 'relative'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>Fechar Conta</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '0.5rem' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', marginBottom: '1.5rem', textAlign: 'center' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Total a pagar</span>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary-gold)', marginTop: '0.5rem' }}>
              R$ {total.toFixed(2).replace('.', ',')}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', marginTop: '0.5rem' }}>
              Referente a {orders.length} pedido(s)
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', marginBottom: '1rem', textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!selectedMethod ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem' }}>Como deseja pagar?</h3>
              
              {allowedMethods.includes('pix') && (
                <button onClick={() => setSelectedMethod('pix')} className="auth-btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <QrCode size={18} /> Pix Rápido
                </button>
              )}
              {allowedMethods.includes('credito_mp') && (
                <button onClick={() => setSelectedMethod('credito_mp')} className="auth-btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <CreditCard size={18} /> Cartão de Crédito
                </button>
              )}
              {allowedMethods.includes('dinheiro') && (
                <button onClick={() => handlePhysicalPayment('dinheiro')} disabled={loading} className="auth-btn" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Wallet size={18} /> Pagar com Dinheiro no Caixa
                </button>
              )}
              {allowedMethods.includes('pix_point') && (
                <button onClick={() => handlePhysicalPayment('pix_point')} disabled={loading} className="auth-btn" style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Smartphone size={18} /> Pix na Maquininha
                </button>
              )}
              {allowedMethods.includes('credito_point') && (
                <button onClick={() => handlePhysicalPayment('credito_point')} disabled={loading} className="auth-btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Landmark size={18} /> Crédito na Maquininha
                </button>
              )}
              {allowedMethods.includes('debito_point') && (
                <button onClick={() => handlePhysicalPayment('debito_point')} disabled={loading} className="auth-btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <CreditCard size={18} /> Débito na Maquininha
                </button>
              )}
              {allowedMethods.includes('cartao') && (
                <button onClick={() => handlePhysicalPayment('cartao')} disabled={loading} className="auth-btn" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <CreditCard size={18} /> Pagamento no Balcão
                </button>
              )}
            </div>
          ) : selectedMethod === 'pix' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
              {!pixPaymentId ? (
                <button onClick={handleGeneratePix} disabled={loading} className="auth-btn" style={{ background: 'var(--primary-gold)', color: '#000' }}>
                  {loading ? 'Gerando...' : 'Gerar Código Pix'}
                </button>
              ) : (
                <div style={{ background: '#fff', padding: '1rem', borderRadius: '12px', width: '100%', maxWidth: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <img src={`data:image/png;base64,${pixQrCodeBase64}`} alt="QR Code Pix" style={{ width: '200px', height: '200px' }} />
                  
                  {pixQrCode && (
                    <div style={{ marginTop: '1rem', width: '100%' }}>
                      <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.3rem', textAlign: 'center' }}>Pix Copia e Cola</div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input 
                          type="text" 
                          value={pixQrCode} 
                          readOnly 
                          style={{ flex: 1, padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '0.75rem', color: '#000', background: '#f9fafb' }}
                        />
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(pixQrCode);
                            alert("Código Pix copiado!");
                          }}
                          style={{ background: 'var(--primary-gold)', border: 'none', borderRadius: '6px', padding: '0 0.8rem', cursor: 'pointer', color: '#000', fontWeight: 600, fontSize: '0.8rem' }}
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                  )}

                  <p style={{ color: '#000', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem', fontWeight: 600 }}>Aguardando pagamento...</p>
                </div>
              )}
              <button onClick={() => setSelectedMethod(null)} className="auth-btn" style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
                Voltar
              </button>
            </div>
          ) : selectedMethod === 'credito_mp' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <MercadoPagoCardForm
                amount={total}
                publicKey={storeConfig?.mpPublicKey || 'APP_USR-da72e390-0c33-4e4d-98e0-4d0fbbe22147'}
                accessToken={storeConfig?.storeOwnerAccessToken || storeConfig?.devAccessToken || 'mock'}
                payer={{ email: user?.email || '', name: user?.displayName || '', cpf: userData?.cpf || '' }}
                onSuccess={async () => {
                  await finishCheckout('credito_mp', 'completed');
                }}
                onError={(msg) => setError(msg)}
              />
              <button onClick={() => setSelectedMethod(null)} className="auth-btn" style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
                Voltar
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
