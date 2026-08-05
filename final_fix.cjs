const fs = require('fs');
let content = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8');

// 1. Imports
content = content.replace(
    "import { User, Store, Shield, CreditCard, Save, Trash2, Clock, MapPin, AlertCircle, History, FileText, KeyRound, Plus, Camera, QrCode, Wallet, Printer } from 'lucide-react';",
    "import { User, Store, Shield, CreditCard, Save, Trash2, Clock, MapPin, AlertCircle, History, FileText, KeyRound, Plus, Camera, QrCode, Wallet, Printer, Settings, ClipboardList, ChefHat, X } from 'lucide-react';"
);

// 2. Interface StoreSettings
content = content.replace(
    "  paymentMethodsVisibility?: Record<string, 'client' | 'staff' | 'both'>;",
    "  paymentMethodsVisibility?: Record<string, 'client' | 'staff' | 'both'>;\n  paymentMethodsVisibilityByOrderType?: Record<string, Record<string, 'client' | 'staff' | 'both'>>;"
);

// 3. activeTab type
content = content.replace(
    "const [activeTab, setActiveTab] = useState<'profile' | 'store' | 'loyalty' | 'advanced' | 'audit_logs' | 'commissions' | 'security' | 'mesas' | 'point_guide' | 'payments' | 'printer'>('profile');",
    "const [activeTab, setActiveTab] = useState<'profile' | 'store' | 'loyalty' | 'advanced' | 'audit_logs' | 'commissions' | 'security' | 'mesas' | 'point_guide' | 'payments' | 'printer' | 'elgin_i8'>('profile');"
);

// 4. credito to credito_mp
content = content.replace(
    "{ id: 'credito', name: 'Crédito Online', desc: 'Pagamento via cartão de crédito ou débito online no checkout.', label: 'Crédito Online ??' },",
    "{ id: 'credito_mp', name: 'Crédito / Débito MP', desc: 'Pagamento via cartão de crédito ou débito online no checkout.', label: 'Crédito / Débito MP ??' },"
);

// 5. Sidebar button
const printerBtn =           {(isAdmin || role === 'staff') && (
            <button
              type="button"
              onClick={() => setActiveTab('printer')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'printer' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'printer' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'printer' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <Printer size={18} />
              Impressora Bluetooth
            </button>
          )};

const elginBtn = 
          {(isAdmin || role === 'staff') && (
            <button
              type="button"
              onClick={() => setActiveTab('elgin_i8')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'elgin_i8' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'elgin_i8' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'elgin_i8' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <Printer size={18} />
              Impressora Bematech Elgin i8
            </button>
          )};

content = content.replace(printerBtn, printerBtn + elginBtn);

// 6. Add Elgin i8 block
const elginBlock = \
          {/* Aba 9: Impressora Bematech Elgin i8 */}
          {activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Printer size={22} style={{ color: 'var(--primary-gold)' }} />
                  Configuração da Impressora Bematech Elgin i8
                </h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  Configure e teste a sua impressora térmica Bematech Elgin i8 (bobina de 80mm). Certifique-se de que a impressora está conectada e ligada.
                </p>
              </div>

              {printError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ?? {printError}
                </div>
              )}

              {printSuccess && (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', borderLeft: '4px solid #10b981', color: '#34d399', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ? Ação executada com sucesso na impressora!
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#fff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings size={18} style={{ color: 'var(--text-secondary)' }} />
                    Método de Comunicação
                  </h4>
                  
                  <select
                    value={printerSettings.method}
                    onChange={(e) => handleSavePrinterSettings({ ...printerSettings, method: e.target.value as 'browser' | 'serial' })}
                    style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem', marginBottom: '0.75rem' }}
                  >
                    <option value="browser">Navegador (Padrão do Sistema Windows/Android)</option>
                    <option value="serial">Cabo USB (Web Serial API - Sem Telas)</option>
                  </select>
                  <p style={{ margin: '0', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {printerSettings.method === 'browser' ? 
                      'Utiliza o gerenciador de impressão do próprio sistema (Windows/Android/iOS). Altamente compatível com qualquer impressora pareada por Bluetooth clássico ou conectada por cabo USB.' :
                      'Envia dados brutos ESC/POS direto via cabo USB (COM). Mais rápido e silencioso, não abre janela do Windows. Requer autorização do navegador.'
                    }
                  </p>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#fff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings size={18} style={{ color: 'var(--text-secondary)' }} />
                    Conexão {printerSettings.method === 'serial' ? 'USB Direta' : 'Navegador'}
                  </h4>
                  
                  {printerSettings.method === 'serial' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: isSerialConn ? '#10b981' : '#ef4444', display: 'inline-block' }}></span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
                          {isSerialConn ? \Conectado via USB: \\ : 'Impressora USB/Cabo Desconectada'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {!isSerialConn ? (
                          <button
                            type="button"
                            onClick={handleConnectSerial}
                            disabled={isSerialPairing}
                            className="primary-button"
                            style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                          >
                            {isSerialPairing ? <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid #0b0f19', borderTopColor: 'transparent' }} /> : <Printer size={16} />}
                            Conectar Impressora USB (Cabo)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleDisconnectSerial}
                            style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '12px', fontWeight: 600 }}
                          >
                            <X size={16} />
                            Desconectar
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {printerSettings.method === 'browser' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        Como você está usando o método **Navegador (Padrão do Sistema)**, a conexão direta não é necessária. O sistema utilizará o driver e as impressoras instaladas no seu sistema operacional (perfeito para cabos USB comuns).
                      </p>
                      
                      <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px dashed rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '1rem', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary-gold)', display: 'block', marginBottom: '0.3rem' }}>
                          ?? DICA: IMPRESSÃO DIRETA/SILENCIOSA
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'block', lineHeight: '1.3', marginBottom: '0.6rem' }}>
                          Para imprimir direto sem abrir a janela de confirmação de impressão do navegador, adicione o parâmetro abaixo no final do campo <strong>Destino</strong> nas propriedades do atalho do Chrome:
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.5rem 0.75rem', justifyContent: 'space-between' }}>
                          <code style={{ fontSize: '0.85rem', color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>--kiosk-printing</code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText('--kiosk-printing');
                              alert('Parâmetro copiado para a área de transferência!');
                            }}
                            style={{ padding: '0.3rem 0.6rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                          >
                            Copiar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      style={{ padding: '0.75rem', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--primary-gold)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      <Printer size={16} />
                      Imprimir Cupom de Teste (80mm) ???
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
\;

content = content.replace("        </main>", elginBlock + "\n        </main>");

fs.writeFileSync('src/pages/SettingsPage.tsx', content, 'utf8');
