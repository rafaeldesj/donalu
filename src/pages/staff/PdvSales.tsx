import React, { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, doc, setDoc, getDocs } from 'firebase/firestore';
import { User, Plus, Search, X } from 'lucide-react';
import { ClientDashboard } from '../client/ClientDashboard';

// Para o Cadastro Rápido sem deslogar
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { firebaseConfig } from '../../config/firebase';

const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

interface ClientUser {
  uid: string;
  name: string;
  email: string;
  phoneNumber?: string;
}

export const PdvSales = () => {
  const [clients, setClients] = useState<ClientUser[]>([]);
  const [searchClient, setSearchClient] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientUser | null>(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  
  const [showFastRegister, setShowFastRegister] = useState(false);
  const [fastName, setFastName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Carregar Clientes
  useEffect(() => {
    const fetchClients = async () => {
      const usersSnap = await getDocs(collection(db, 'users'));
      const clientsList: ClientUser[] = [];
      usersSnap.forEach(doc => {
        const data = doc.data();
        if (data.role === 'client') {
          clientsList.push({
            uid: data.uid || doc.id,
            name: data.name || 'Sem nome',
            email: data.email || '',
            phoneNumber: data.phoneNumber || ''
          });
        }
      });
      setClients(clientsList);
    };
    fetchClients();
  }, []);

  const handleFastRegister = async () => {
    if (!fastName.trim()) {
      alert("Por favor, digite o nome do cliente.");
      return;
    }
    setIsSubmitting(true);
    try {
      const generatedEmail = `cliente_${Date.now()}@donalu.com`;
      const generatedPassword = 'donalu';
      
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, generatedEmail, generatedPassword);
      const newUid = userCredential.user.uid;
      
      // Criar doc no Firestore
      const newUserDoc = {
        uid: newUid,
        email: generatedEmail,
        name: fastName,
        role: 'client',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phoneNumber: '', // celular em branco, conforme solicitado
        authEmail: generatedEmail // email como padrão cliente em branco (mas válido para auth)
      };
      
      await setDoc(doc(db, 'users', newUid), newUserDoc);
      
      const newClient = {
        uid: newUid,
        name: fastName,
        email: generatedEmail,
        phoneNumber: ''
      };
      
      setClients(prev => [...prev, newClient]);
      setSelectedClient(newClient);
      setShowFastRegister(false);
      setFastName('');
      alert("Cliente cadastrado com sucesso!");
    } catch (err) {
      console.error("Erro no cadastro rápido:", err);
      alert("Erro ao cadastrar cliente.");
    } finally {
      // Logout secondary auth just to be safe
      secondaryAuth.signOut();
      setIsSubmitting(false);
    }
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchClient.toLowerCase()) || 
    (c.phoneNumber && c.phoneNumber.includes(searchClient))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh', background: 'var(--bg-main)' }}>
      {/* Cabeçalho de Seleção do PDV */}
      <div style={{ padding: '2rem 2rem 0 2rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>PDV Vendas 🥟</h2>
        
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>
            <User size={20} color="var(--primary-gold)" /> Selecione o Cliente para a Venda
          </h3>
          
          {selectedClient ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245, 158, 11, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--primary-gold)' }}>
              <div>
                <strong style={{ fontSize: '1.1rem' }}>{selectedClient.name}</strong>
                {selectedClient.phoneNumber && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedClient.phoneNumber}</p>}
              </div>
              <button onClick={() => setSelectedClient(null)} className="btn-secondary" style={{ padding: '0.5rem 1rem' }}>
                <X size={16} /> Trocar Cliente
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input
                    type="text"
                    placeholder="Buscar cliente cadastrado por nome ou celular..."
                    value={searchClient}
                    onChange={(e) => {
                      setSearchClient(e.target.value);
                      setShowClientDropdown(true);
                    }}
                    onFocus={() => setShowClientDropdown(true)}
                    style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 2.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)', color: '#fff' }}
                  />
                </div>
              </div>
              
              {showClientDropdown && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', marginTop: '4px', zIndex: 10, maxHeight: '300px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  
                  <div 
                    onClick={() => { setShowFastRegister(true); setShowClientDropdown(false); }}
                    style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary-gold)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Plus size={18} /> <strong>Cadastro Rápido (Apenas Nome)</strong>
                  </div>

                  {filteredClients.length > 0 ? (
                    filteredClients.map(c => (
                      <div 
                        key={c.uid}
                        onClick={() => { setSelectedClient(c); setShowClientDropdown(false); }}
                        style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <strong>{c.name}</strong> {c.phoneNumber && <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>- {c.phoneNumber}</span>}
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '1rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Nenhum cliente encontrado.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Cadastro Rápido */}
        {showFastRegister && !selectedClient && (
          <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1rem', border: '1px solid var(--primary-gold)' }}>
            <h4>Cadastro Rápido</h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Preencha apenas o nome. Uma conta será gerada em background.</p>
            <input 
              type="text" 
              placeholder="Nome do Cliente" 
              value={fastName}
              onChange={e => setFastName(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)', color: '#fff', marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn-primary" onClick={handleFastRegister} disabled={isSubmitting}>
                {isSubmitting ? 'Cadastrando...' : 'Confirmar Cadastro'}
              </button>
              <button className="btn-secondary" onClick={() => setShowFastRegister(false)} disabled={isSubmitting}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Se o cliente não estiver selecionado, podemos ocultar o ClientDashboard ou desabilitá-lo. 
          Neste caso, renderizamos com um overlay se não houver cliente, ou o mostramos normalmente, mas o PDV exige cliente no final. */}
      
      <div style={{ flex: 1, opacity: selectedClient ? 1 : 0.4, pointerEvents: selectedClient ? 'auto' : 'none', transition: 'all 0.3s ease' }}>
        {!selectedClient && (
          <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--primary-gold)', fontWeight: 'bold' }}>
            Selecione ou cadastre um cliente acima para liberar o cardápio.
          </div>
        )}
        <ClientDashboard 
          isPdvMode={true} 
          pdvClientOverride={selectedClient} 
        />
      </div>

    </div>
  );
};

export default PdvSales;
