import { useEffect, useState } from 'react';
import { collection, query, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';
import type { UserDocument, UserRole, StaffFunctions } from '../../types/user';
import { Plus, Edit2, Trash2, X, Search, KeyRound, Eye, EyeOff, Filter } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { logAuditAction } from '../../utils/audit';

export const UserManagement = () => {
  const { user, userData } = useAuth();
  const [users, setUsers] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Excel-like filter states
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([]);
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>([]);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showFuncDropdown, setShowFuncDropdown] = useState(false);

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

    const payload: Omit<UserDocument, 'uid'> = {
      name,
      email: email.trim().toLowerCase(),
      role,
      updatedAt: new Date().toISOString(),
      createdAt: editUser ? editUser.createdAt : new Date().toISOString()
    };

    if (role === 'staff') {
      payload.staffFunctions = staffFunctions;
    }

    try {
      if (editUser) {
        // Atualiza usuário existente no Firestore
        await updateDoc(doc(db, 'users', editUser.uid), payload as any);
        setSuccess('Usuário atualizado com sucesso!');
        
        if (user) {
          await logAuditAction({
            userId: user.uid,
            userEmail: user.email || '',
            userName: userData?.name || user.displayName || 'Administrador',
            actionType: 'UPDATE_USER',
            title: 'Edição de Usuário',
            description: `O administrador atualizou os dados do usuário "${name}" (E-mail: "${email.trim().toLowerCase()}", Papel: "${role}").`
          });
        }
      } else {
        // Pré-cadastro do usuário (gerará um ID temporário aleatório no Firestore)
        const docRef = await addDoc(collection(db, 'users'), {
          ...payload,
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
      u.email.toLowerCase().includes(search.toLowerCase());
      
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

  const toggleRoleFilter = (roleVal: UserRole) => {
    setSelectedRoles(prev => 
      prev.includes(roleVal) ? prev.filter(r => r !== roleVal) : [...prev, roleVal]
    );
  };

  const toggleFuncFilter = (funcVal: string) => {
    setSelectedFunctions(prev => 
      prev.includes(funcVal) ? prev.filter(f => f !== funcVal) : [...prev, funcVal]
    );
  };

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
          <h2>Gestão de Usuários e Permissões (RBAC) 👥</h2>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', marginBottom: '0.5rem' }}>
          <h3>Usuários Cadastrados ({filteredUsers.length})</h3>
          <div className="input-wrapper" style={{ width: '250px' }}>
            <Search size={16} className="input-icon" />
            <input type="text" placeholder="Filtrar por nome/e-mail" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: '0.5rem 0.5rem 0.5rem 2.2rem', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }} />
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
                  <th style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>Nível Acesso</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowRoleDropdown(!showRoleDropdown);
                          setShowFuncDropdown(false);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: selectedRoles.length > 0 ? 'var(--primary-gold)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '2px',
                          borderRadius: '4px',
                          transition: 'all 0.2s'
                        }}
                        title="Filtrar por nível de acesso"
                      >
                        <Filter size={12} />
                      </button>
                    </div>

                    {showRoleDropdown && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        background: '#141824',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                        padding: '0.75rem',
                        zIndex: 100,
                        minWidth: '180px',
                        fontWeight: 'normal',
                        fontSize: '0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        marginTop: '4px'
                      }}>
                        <div style={{ fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem', color: '#fff' }}>Filtrar Nível</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={selectedRoles.length === 0}
                              onChange={() => setSelectedRoles([])}
                            />
                            <span>(Mostrar Todos)</span>
                          </label>
                          {[
                            { val: 'developer', label: 'Developer' },
                            { val: 'owner', label: 'Proprietário' },
                            { val: 'manager', label: 'Gerente' },
                            { val: 'staff', label: 'Colaborador' },
                            { val: 'client', label: 'Cliente' }
                          ].map((opt) => (
                            <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                              <input
                                type="checkbox"
                                checked={selectedRoles.includes(opt.val as UserRole)}
                                onChange={() => toggleRoleFilter(opt.val as UserRole)}
                              />
                              <span>{opt.label}</span>
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowRoleDropdown(false)}
                          style={{
                            marginTop: '0.25rem',
                            padding: '0.35rem',
                            background: 'var(--primary-gold)',
                            color: '#0b0f19',
                            border: 'none',
                            borderRadius: '4px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'center'
                          }}
                        >
                          Aplicar
                        </button>
                      </div>
                    )}
                  </th>
                  <th style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>Patente</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowFuncDropdown(!showFuncDropdown);
                          setShowRoleDropdown(false);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: selectedFunctions.length > 0 ? 'var(--primary-gold)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '2px',
                          borderRadius: '4px',
                          transition: 'all 0.2s'
                        }}
                        title="Filtrar por patente/atividade"
                      >
                        <Filter size={12} />
                      </button>
                    </div>

                    {showFuncDropdown && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        background: '#141824',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                        padding: '0.75rem',
                        zIndex: 100,
                        minWidth: '180px',
                        fontWeight: 'normal',
                        fontSize: '0.8rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        marginTop: '4px'
                      }}>
                        <div style={{ fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem', color: '#fff' }}>Filtrar Patente</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={selectedFunctions.length === 0}
                              onChange={() => setSelectedFunctions([])}
                            />
                            <span>(Mostrar Todos)</span>
                          </label>
                          {[
                            { val: 'cook', label: 'Cozinha' },
                            { val: 'attendant', label: 'Balcão' },
                            { val: 'cashier', label: 'Caixa' },
                            { val: 'delivery', label: 'Entregador' },
                            { val: 'none', label: 'Nenhuma (-)' }
                          ].map((opt) => (
                            <label key={opt.val} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                              <input
                                type="checkbox"
                                checked={selectedFunctions.includes(opt.val)}
                                onChange={() => toggleFuncFilter(opt.val)}
                              />
                              <span>{opt.label}</span>
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowFuncDropdown(false)}
                          style={{
                            marginTop: '0.25rem',
                            padding: '0.35rem',
                            background: 'var(--primary-gold)',
                            color: '#0b0f19',
                            border: 'none',
                            borderRadius: '4px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'center'
                          }}
                        >
                          Aplicar
                        </button>
                      </div>
                    )}
                  </th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Nenhum usuário localizado.</td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr key={u.uid}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td>{u.email}</td>
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
