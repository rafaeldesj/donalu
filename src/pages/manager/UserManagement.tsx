import { useEffect, useState } from 'react';
import { collection, query, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth as getSecondaryAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { sendPasswordResetEmail } from 'firebase/auth';
import type { UserDocument, UserRole, StaffFunctions } from '../../types/user';
import { Plus, Edit2, Trash2, X, Search, KeyRound, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { logAuditAction } from '../../utils/audit';

export const UserManagement = () => {
  const { user, userData } = useAuth();

  const createSecondaryAuthUser = async (emailVal: string, passwordVal: string) => {
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAzR9UQyV0xIwYgU9xoTuiEfqwhIiDvIrU",
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "dona-lu-4242d.firebaseapp.com",
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "dona-lu-4242d",
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "dona-lu-4242d.firebasestorage.app",
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "87878437306",
      appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:87878437306:web:6bb76b8dadd3e7dbd43583",
    };

    const appName = `SecondaryApp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    try {
      const secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getSecondaryAuth(secondaryApp);
      await createUserWithEmailAndPassword(secondaryAuth, emailVal, passwordVal);
      await deleteApp(secondaryApp);
      console.log("Secondary user account created in Firebase Auth successfully!");
    } catch (err) {
      console.warn("Secondary user account check or error:", err);
    }
  };
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Ordenamento states
  const [sortBy, setSortBy] = useState<'name' | 'role' | 'patente' | 'createdAt'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Excel-like filter states
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([]);
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>([]);


  // Estados do formulário
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserDocument | null>(null);
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('client');
  const [cook, setCook] = useState(false);
  const [attendant, setAttendant] = useState(false);
  const [cashier, setCashier] = useState(false);
  const [delivery, setDelivery] = useState(false);
  const [initialPassword, setInitialPassword] = useState('');
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneNumber(formatPhone(e.target.value));
  };

  // Estados para redefinição de senha provisória
  const [resetUser, setResetUser] = useState<UserDocument | null>(null);
  const [tempPassword, setTempPassword] = useState('');
  const [showTempPassword, setShowTempPassword] = useState(false);

  // Escuta usuários em tempo real no Firestore
  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: UserDocument[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          uid: docSnap.id, // o id do documento geralmente é o uid
          ...docSnap.data()
        } as UserDocument);
      });
      setUsers(fetched);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const openCreateForm = () => {
    setEditUser(null);
    setName('');
    setEmail('');
    setRole('client');
    setCook(false);
    setAttendant(false);
    setCashier(false);
    setDelivery(false);
    setPhoneNumber('');
    setInitialPassword('');
    setError(null);
    setSuccess(null);
    setShowForm(true);
  };

  const openEditForm = (user: UserDocument) => {
    setEditUser(user);
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setCook(user.staffFunctions?.cook || false);
    setAttendant(user.staffFunctions?.attendant || false);
    setCashier(user.staffFunctions?.cashier || false);
    setDelivery(user.staffFunctions?.delivery || false);
    setPhoneNumber(formatPhone(user.phoneNumber || ''));
    setInitialPassword('');
    setError(null);
    setSuccess(null);
    setShowForm(true);
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Tem certeza de que deseja excluir este usuário do sistema?')) return;
    const targetUser = users.find((u) => u.uid === userId);
    
    try {
      await deleteDoc(doc(db, 'users', userId));
      setSuccess('Usuário excluído com sucesso!');
      
      if (user) {
        await logAuditAction({
          userId: user.uid,
          userEmail: user.email || '',
          userName: userData?.name || user.displayName || 'Administrador',
          actionType: 'DELETE_USER',
          title: 'Exclusão de Usuário',
          description: `O administrador excluiu a conta do usuário "${targetUser?.name || 'Desconhecido'}" (E-mail: "${targetUser?.email || ''}", Papel: "${targetUser?.role || ''}").`
        });
      }
      
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error(err);
      setError('Erro ao excluir usuário.');
    }
  };

  const handleSaveTempPassword = async () => {
    if (!resetUser) return;
    if (!tempPassword || tempPassword.trim().length < 6) {
      setError('A senha provisória deve ter pelo menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      if (resetUser.uid.length === 20) {
        // Garante que a conta de login do Firebase Auth exista com essa nova senha provisória
        await createSecondaryAuthUser(resetUser.email, tempPassword.trim());
      }

      await updateDoc(doc(db, 'users', resetUser.uid), {
        tempPassword: tempPassword.trim()
      });
      setSuccess(`Senha provisória salva com sucesso para ${resetUser.name}!`);
      
      if (user) {
        await logAuditAction({
          userId: user.uid,
          userEmail: user.email || '',
          userName: userData?.name || user.displayName || 'Administrador',
          actionType: 'RESET_PASSWORD',
          title: 'Redefinição de Senha',
          description: `O administrador definiu uma nova senha provisória para o usuário "${resetUser.name}" (E-mail: "${resetUser.email}").`
        });
      }

      setResetUser(null);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      console.error(err);
      setError('Erro ao salvar senha provisória no Firestore.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name || !email) {
      setError('Preencha os campos obrigatórios (Nome e E-mail).');
      return;
    }

    if (!editUser && (!initialPassword || initialPassword.trim().length < 6)) {
      setError('A senha inicial é obrigatória para novos cadastros e deve ter pelo menos 6 caracteres.');
      return;
    }

    setSubmitting(true);

    const staffFunctions: StaffFunctions = {
      cook: role === 'staff' ? cook : false,
      attendant: role === 'staff' ? attendant : false,
      cashier: role === 'staff' ? cashier : false,
      delivery: role === 'staff' ? delivery : false
    };

    const payload: any = {
      name,
      email: email.trim().toLowerCase(),
      role,
      phoneNumber: phoneNumber.trim(),
      updatedAt: new Date().toISOString(),
      createdAt: editUser ? editUser.createdAt : new Date().toISOString()
    };

    if (role === 'staff') {
      payload.staffFunctions = staffFunctions;
    }

    try {
      if (editUser) {
        const isEmailChanged = email.trim().toLowerCase() !== editUser.email;

        // Se o e-mail mudou, a gente apenas atualiza no Firestore.
        // A lógica de login e onSnapshot do app do cliente se encarrega de sincronizar o Auth
        // na primeira oportunidade e usar o authEmail anterior por debaixo dos panos para logar.
        await updateDoc(doc(db, 'users', editUser.uid), payload as any);
        setSuccess('Usuário atualizado com sucesso!');
        
        if (user) {
          await logAuditAction({
            userId: user.uid,
            userEmail: user.email || '',
            userName: userData?.name || user.displayName || 'Administrador',
            actionType: 'UPDATE_USER',
            title: 'Edição de Usuário',
            description: isEmailChanged 
              ? `O administrador alterou o e-mail do usuário "${editUser.name}" de "${editUser.email}" para "${email.trim().toLowerCase()}" (Nível: "${role}").`
              : `O administrador atualizou os dados do usuário "${name}" (E-mail: "${email.trim().toLowerCase()}", Papel: "${role}").`
          });
        }
      } else {
        // Cria a conta de login no Auth secundário para que funcione de primeira
        await createSecondaryAuthUser(email.trim().toLowerCase(), initialPassword.trim());

        // Pré-cadastro do usuário (gerará um ID temporário aleatório no Firestore)
        const docRef = await addDoc(collection(db, 'users'), {
          ...payload,
          authEmail: email.trim().toLowerCase(),
          tempPassword: initialPassword.trim(),
          uid: '' // UID será preenchido quando o usuário fizer login
        });
        
        // Atualiza o campo uid do documento com o próprio ID do documento para manter a consistência
        await updateDoc(doc(db, 'users', docRef.id), { uid: docRef.id });
        setSuccess('Usuário pré-cadastrado! Ele terá acesso ao fazer login com este e-mail.');
        
        if (user) {
          await logAuditAction({
            userId: user.uid,
            userEmail: user.email || '',
            userName: userData?.name || user.displayName || 'Administrador',
            actionType: 'CREATE_USER',
            title: 'Pré-cadastro de Usuário',
            description: `O administrador pré-cadastrou o usuário "${name}" (E-mail: "${email.trim().toLowerCase()}", Papel: "${role}").`
          });
        }
      }
      
      setShowForm(false);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      console.error(err);
      setError('Erro ao salvar usuário no Firestore.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    // 1. Text search
    const matchesSearch = 
      u.name.toLowerCase().includes(search.toLowerCase()) || 
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.phoneNumber && u.phoneNumber.toLowerCase().includes(search.toLowerCase()));
      
    if (!matchesSearch) return false;
    
    // 2. Role filter
    if (selectedRoles.length > 0) {
      if (!selectedRoles.includes(u.role)) return false;
    }
    
    // 3. Patente (Function) filter
    if (selectedFunctions.length > 0) {
      if (u.role !== 'staff') {
        if (!selectedFunctions.includes('none')) return false;
      } else {
        const staffFuncs = u.staffFunctions || ({} as StaffFunctions);
        const matchesAny = 
          (staffFuncs.cook && selectedFunctions.includes('cook')) ||
          (staffFuncs.attendant && selectedFunctions.includes('attendant')) ||
          (staffFuncs.cashier && selectedFunctions.includes('cashier')) ||
          (staffFuncs.delivery && selectedFunctions.includes('delivery'));
          
        const hasNoFunctions = !staffFuncs.cook && !staffFuncs.attendant && !staffFuncs.cashier && !staffFuncs.delivery;
        if (hasNoFunctions && selectedFunctions.includes('none')) {
          // matches
        } else if (!matchesAny) {
          return false;
        }
      }
    }
    
    return true;
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let valA: any = '';
    let valB: any = '';

    if (sortBy === 'name') {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
    } else if (sortBy === 'role') {
      const roleWeight = { developer: 5, owner: 4, manager: 3, staff: 2, client: 1 };
      valA = roleWeight[a.role] || 0;
      valB = roleWeight[b.role] || 0;
    } else if (sortBy === 'patente') {
      const getPatenteWeight = (u: any) => {
        if (u.role !== 'staff' || !u.staffFunctions) return 0;
        if (u.staffFunctions.cashier) return 4;
        if (u.staffFunctions.attendant) return 3;
        if (u.staffFunctions.cook) return 2;
        if (u.staffFunctions.delivery) return 1;
        return 0;
      };
      valA = getPatenteWeight(a);
      valB = getPatenteWeight(b);
    } else if (sortBy === 'createdAt') {
      valA = a.createdAt || '';
      valB = b.createdAt || '';
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });



  const getRoleLabel = (r: UserRole) => {
    switch (r) {
      case 'developer': return 'Developer';
      case 'owner': return 'Proprietário';
      case 'manager': return 'Gerente';
      case 'staff': return 'Colaborador';
      case 'client':
      default:
        return 'Cliente';
    }
  };

  const getStaffBadge = (u: UserDocument) => {
    if (u.role !== 'staff' || !u.staffFunctions) return null;
    const f: string[] = [];
    if (u.staffFunctions.cook) f.push('Cozinha');
    if (u.staffFunctions.attendant) f.push('Balcão');
    if (u.staffFunctions.cashier) f.push('Caixa');
    if (u.staffFunctions.delivery) f.push('Entregador');
    return f.length > 0 ? f.join(', ') : 'Nenhuma';
  };

  return (
    <div className="dashboard-layout animate-fade-in">
      {/* Modal de Redefinição de Senha */}
      {resetUser && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="admin-card-box" style={{
            width: '90%',
            maxWidth: '500px',
            border: '1px solid var(--primary-gold)',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
            position: 'relative'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <KeyRound size={18} style={{ color: 'var(--primary-gold)' }} />
                <h3 style={{ margin: 0 }}>Redefinir Senha de {resetUser.name}</h3>
              </div>
              <button type="button" onClick={() => setResetUser(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.4' }}>
              Escolha uma das opções abaixo para redefinir a senha do usuário.
            </p>

            {/* Opção 1: E-mail */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1.25rem'
            }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '0.9rem' }}>Opção A: Enviar E-mail de Recuperação</h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                O usuário receberá um link oficial do Firebase por e-mail para escolher sua própria senha com segurança.
              </p>
              <button
                type="button"
                onClick={async () => {
                  const email = resetUser.email;
                  setResetUser(null);
                  try {
                    await sendPasswordResetEmail(auth, email);
                    setSuccess(`E-mail de redefinição de senha enviado com sucesso para ${email}!`);
                    setTimeout(() => setSuccess(null), 4000);
                  } catch (err: any) {
                    console.error(err);
                    setError('Erro ao enviar e-mail de redefinição de senha.');
                  }
                }}
                className="btn-small btn-primary"
                style={{ width: '100%' }}
              >
                Enviar E-mail de Recuperação
              </button>
            </div>

            {/* Opção 2: Senha Provisória */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '8px',
              padding: '1rem'
            }}>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '0.9rem' }}>Opção B: Definir Senha Provisória</h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                A senha será gravada temporariamente no banco de dados. 
                {resetUser.uid.length === 20 ? (
                  <span style={{ display: 'block', marginTop: '0.4rem', color: '#10b981', fontWeight: 500 }}>
                    💡 Este usuário ainda não logou no sistema (pré-cadastro). O primeiro login com a senha provisória ativará a conta automaticamente.
                  </span>
                ) : (
                  <span style={{ display: 'block', marginTop: '0.4rem', color: '#f59e0b', fontWeight: 500 }}>
                    ⚠️ Este usuário já está ativo. Para que a senha provisória funcione, você deverá antes excluir a conta dele na aba "Authentication" do console do Firebase.
                  </span>
                )}
              </p>

              <div className="input-group" style={{ marginBottom: '1rem' }}>
                <div className="input-wrapper">
                  <input
                    type={showTempPassword ? 'text' : 'password'}
                    placeholder="Mínimo de 6 caracteres"
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    style={{
                      padding: '0.5rem 2.5rem 0.5rem 0.75rem',
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      color: '#fff',
                      width: '100%',
                      boxSizing: 'border-box'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTempPassword(!showTempPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {showTempPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveTempPassword}
                disabled={submitting}
                className="btn-small"
                style={{ width: '100%', background: 'var(--primary-gold)', color: '#0b0f19', fontWeight: 600 }}
              >
                {submitting ? 'Salvando...' : 'Salvar Senha Provisória'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Gestão de Usuários e Permissões 👥</h2>
          <p>Cadastre novos colaboradores e gerencie privilégios em tempo real.</p>
        </div>
        <button type="button" onClick={openCreateForm} className="btn-small btn-primary" style={{ padding: '0.6rem 1.2rem', gap: '0.5rem', flex: 'none' }}>
          <Plus size={16} /> Novo Usuário
        </button>
      </div>

      {success && <div className="alert-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderLeftColor: '#10b981', marginBottom: '1.5rem' }}>{success}</div>}
      {error && <div className="auth-error-message" style={{ marginBottom: '1.5rem' }}>{error}</div>}

      {/* Formulário de Criar/Editar Usuário */}
      {showForm && (
        <div className="admin-card-box" style={{ marginBottom: '2rem', border: '1px solid var(--primary-gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
            <h3>{editUser ? 'Editar Usuário' : 'Novo Cadastro de Usuário'}</h3>
            <button type="button" onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
          </div>

          <form onSubmit={handleSubmit} className="auth-form" style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="input-group">
              <label>Nome Completo</label>
              <input type="text" placeholder="Nome do colaborador ou cliente" value={name} onChange={(e) => setName(e.target.value)} required style={{ padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none' }} />
            </div>

            <div className="input-group">
              <label>Endereço de E-mail</label>
              <input type="email" placeholder="email@donalupastelaria.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none' }} />
            </div>

            <div className="input-group">
              <label>Celular (WhatsApp)</label>
              <input type="text" placeholder="Ex: (21) 99999-9999" value={phoneNumber} onChange={handlePhoneChange} style={{ padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none' }} />
            </div>

            {!editUser && (
              <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                <label>Senha de Acesso Inicial</label>
                <input type="password" placeholder="Mínimo de 6 caracteres para o primeiro login" value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} required style={{ padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none' }} />
              </div>
            )}

            <div className="input-group" style={{ gridColumn: '1 / -1' }}>
              <label>Nível de Acesso (Privilégio)</label>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={{ padding: '0.6rem 1rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', outline: 'none', cursor: 'pointer' }}>
                <option value="client">Cliente</option>
                <option value="staff">Colaborador (Staff)</option>
                <option value="manager">Gerente</option>
                <option value="owner">Proprietário (Owner)</option>
                <option value="developer">Desenvolvedor (Developer/Root)</option>
              </select>
            </div>

            {role === 'staff' && (
              <div className="input-group" style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <label style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>Funções Operacionais na Pastelaria:</label>
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={cook} onChange={(e) => setCook(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                    Cozinheiro
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={attendant} onChange={(e) => setAttendant(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                    Atendente (Balcão/Mesa)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={cashier} onChange={(e) => setCashier(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                    Caixa / Recebimentos
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                    Entregador
                  </label>
                </div>
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setShowForm(false)} className="btn-small" style={{ width: '100px', background: 'rgba(255,255,255,0.05)', color: '#fff' }}>Cancelar</button>
              <button type="submit" disabled={submitting} className="btn-small btn-primary" style={{ width: '150px' }}>
                {submitting ? 'Gravando...' : 'Salvar Usuário'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista / Tabela de Usuários */}
      <div className="admin-card-box">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <h3 style={{ margin: 0 }}>Usuários Cadastrados ({sortedUsers.length})</h3>
            
            {/* Barra de Busca Avançada */}
            <div className="input-wrapper" style={{ width: '100%', maxWidth: '280px' }}>
              <Search size={16} className="input-icon" />
              <input 
                type="text" 
                placeholder="Buscar por nome, e-mail ou celular..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                style={{ padding: '0.55rem 0.5rem 0.55rem 2.2rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', borderRadius: '8px' }} 
              />
            </div>
          </div>

          {/* Painel de Filtros e Ordenamento */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '10px', padding: '0.75rem' }}>
            
            {/* Filtro por Nível de Acesso */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 140px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Nível de Acesso</span>
              <select 
                value={selectedRoles[0] || ''} 
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedRoles(val ? [val as UserRole] : []);
                }} 
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                <option value="">Todos os Níveis</option>
                <option value="developer">Developer</option>
                <option value="owner">Proprietário</option>
                <option value="manager">Gerente</option>
                <option value="staff">Colaborador</option>
                <option value="client">Cliente</option>
              </select>
            </div>

            {/* Filtro por Patente */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 140px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Patente</span>
              <select 
                value={selectedFunctions[0] || ''} 
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedFunctions(val ? [val] : []);
                }} 
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                <option value="">Todas as Patentes</option>
                <option value="cook">Cozinha</option>
                <option value="attendant">Balcão</option>
                <option value="cashier">Caixa</option>
                <option value="delivery">Entregador</option>
                <option value="none">Nenhuma (-)</option>
              </select>
            </div>

            {/* Ordenamento */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: '1 1 180px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Ordenar por</span>
              <select 
                value={`${sortBy}-${sortOrder}`} 
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-') as [any, any];
                  setSortBy(field);
                  setSortOrder(order);
                }} 
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                <option value="name-asc">Nome (A - Z)</option>
                <option value="name-desc">Nome (Z - A)</option>
                <option value="role-desc">Nível de Acesso (Maior privilégio)</option>
                <option value="role-asc">Nível de Acesso (Menor privilégio)</option>
                <option value="patente-desc">Patente (Maior prioridade)</option>
                <option value="patente-asc">Patente (Menor prioridade)</option>
                <option value="createdAt-desc">Cadastro (Mais Recente)</option>
                <option value="createdAt-asc">Cadastro (Mais Antigo)</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Carregando dados...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Celular (WhatsApp)</th>
                  <th>Nível Acesso</th>
                  <th>Patente</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum usuário localizado.</td>
                  </tr>
                ) : (
                  sortedUsers.map((u) => (
                    <tr key={u.uid}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td>{u.email}</td>
                      <td>{u.phoneNumber || <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.85rem' }}>-</span>}</td>
                      <td>
                        <span className="auth-role-badge" style={{ 
                          backgroundColor: 
                            u.role === 'developer' ? '#7c3aed20' : 
                            u.role === 'owner' ? '#d9770620' : 
                            u.role === 'manager' ? '#2563eb20' : 
                            u.role === 'staff' ? '#05966920' : '#0284c720', 
                          color: 
                            u.role === 'developer' ? '#a78bfa' : 
                            u.role === 'owner' ? 'var(--primary-gold)' : 
                            u.role === 'manager' ? '#60a5fa' : 
                            u.role === 'staff' ? '#34d399' : '#38bdf8',
                          fontSize: '0.75rem',
                          padding: '0.15rem 0.5rem'
                        }}>
                          {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td>
                        {u.role === 'staff' ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {getStaffBadge(u)}
                          </span>
                        ) : (
                          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.85rem' }}>-</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => { setResetUser(u); setTempPassword(''); setShowTempPassword(false); }} className="btn-small" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--primary-gold)', flex: 'none', padding: '0.35rem 0.6rem' }} title="Redefinir senha" aria-label={`Redefinir senha de ${u.name}`}>
                            <KeyRound size={12} />
                          </button>
                          <button type="button" onClick={() => openEditForm(u)} className="btn-small" style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', flex: 'none', padding: '0.35rem 0.6rem' }} aria-label={`Editar ${u.name}`}>
                            <Edit2 size={12} />
                          </button>
                          <button type="button" onClick={() => handleDeleteUser(u.uid)} className="btn-small" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', flex: 'none', padding: '0.35rem 0.6rem' }} aria-label={`Deletar ${u.name}`}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
export default UserManagement;
