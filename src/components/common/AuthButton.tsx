import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { LogIn, LogOut, User, ShieldCheck, Mail, Lock, UserPlus, Eye, EyeOff, KeyRound } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../config/firebase';

export const AuthButton = () => {
  const { user, userData, loading, loginWithGoogle, loginWithEmail, registerWithEmail, logout, completeRegistration } = useAuth();

  // Estados do formulário
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    setPhone(formatPhone(e.target.value));
  };

  const getRoleBadgeStyles = (role: string) => {
    switch (role) {
      case 'developer':
        return { backgroundColor: '#7c3aed', color: '#ffffff' };
      case 'owner':
        return { backgroundColor: '#d97706', color: '#ffffff' };
      case 'manager':
        return { backgroundColor: '#2563eb', color: '#ffffff' };
      case 'staff':
        return { backgroundColor: '#059669', color: '#ffffff' };
      case 'client':
      default:
        return { backgroundColor: '#0284c7', color: '#ffffff' };
    }
  };

  const getStaffSubroles = () => {
    if (!userData?.staffFunctions) return '';
    const roles: string[] = [];
    if (userData.staffFunctions.cook) roles.push('Cozinha');
    if (userData.staffFunctions.attendant) roles.push('Atendimento');
    if (userData.staffFunctions.cashier) roles.push('Caixa');
    if (userData.staffFunctions.delivery) roles.push('Entrega');
    return roles.length > 0 ? ` [${roles.join(', ')}]` : '';
  };

  const mapAuthErrorToPortuguese = (errorCode: string) => {
    switch (errorCode) {
      case 'auth/invalid-email':
        return 'Formato de e-mail inválido.';
      case 'auth/user-disabled':
        return 'Este usuário foi desativado.';
      case 'auth/user-not-found':
        return 'Este e-mail não está cadastrado no sistema.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'E-mail ou senha incorretos.';
      case 'auth/email-already-in-use':
        return 'Este e-mail já está em uso.';
      case 'auth/weak-password':
        return 'A senha deve ter pelo menos 6 caracteres.';
      case 'auth/popup-closed-by-user':
        return 'O login com Google foi cancelado.';
      case 'auth/operation-not-allowed':
        return 'O login com Google não está ativo no Firebase Console. Por favor, ative-o nas configurações de Authentication.';
      default:
        return 'Ocorreu um erro inesperado. Tente novamente.';
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (isRegisterMode) {
      if (!name) {
        setError('Por favor, informe o seu nome para cadastro.');
        return;
      }
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        setError('Por favor, informe um número de celular válido com DDD.');
        return;
      }
    }

    setActionLoading(true);
    try {
      if (isRegisterMode) {
        await registerWithEmail(email, password, name, phone);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      console.error(err);
      if (err.message === 'TEMP_PASSWORD_ACTIVE_USER') {
        setError('Esta senha provisória foi cadastrada no banco, mas sua conta anterior no Firebase ainda está ativa. Por favor, utilize o "Esqueceu a senha?" acima para redefinir ou peça ao administrador para recriar sua conta.');
      } else {
        const friendlyMsg = mapAuthErrorToPortuguese(err.code || '');
        if (friendlyMsg === 'Ocorreu um erro inesperado. Tente novamente.') {
          setError(`Erro: ${err.message || err.toString() || 'Erro inesperado'}`);
        } else {
          setError(friendlyMsg);
        }
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email) {
      setError('Por favor, informe o seu e-mail.');
      return;
    }

    setActionLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setSuccess('E-mail de redefinição de senha enviado com sucesso! Verifique sua caixa de entrada.');
    } catch (err: any) {
      console.error(err);
      setError(mapAuthErrorToPortuguese(err.code || ''));
    } finally {
      setActionLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setActionLoading(true);
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error(err);
      setError(mapAuthErrorToPortuguese(err.code || ''));
    } finally {
      setActionLoading(false);
    }
  };

  React.useEffect(() => {
    if (user) {
      if (!name) setName(user.displayName || '');
      if (!email) setEmail(user.email || '');
    }
  }, [user]);

  const handleCompleteProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setError('Por favor, informe um número de celular válido com DDD.');
      return;
    }

    const finalName = name.trim() || user?.displayName || 'Cliente Dona Lu';

    setActionLoading(true);
    try {
      await completeRegistration(finalName, phone, email);
    } catch (err: any) {
      console.error(err);
      setError('Ocorreu um erro ao concluir o cadastro. Tente novamente.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-btn auth-btn-loading" style={{ width: '100%' }}>
        <span className="spinner"></span>
        <span>Carregando sessão...</span>
      </div>
    );
  }

  const isProfileIncomplete = !!user && (!userData || !userData.phoneNumber);

  if (isProfileIncomplete) {
    return (
      <div className="hybrid-auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '1.25rem' }}>📋</span>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Concluir Cadastro</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
          Para continuar, precisamos de mais algumas informações para a entrega dos seus pastéis!
        </p>

        <form onSubmit={handleCompleteProfileSubmit} className="auth-form">
          {error && <div className="auth-error-message">{error}</div>}

          <div className="input-group">
            <label htmlFor="complete-name">Nome Completo</label>
            <div className="input-wrapper">
              <User size={18} className="input-icon" />
              <input 
                id="complete-name"
                type="text" 
                placeholder="Seu nome"
                value={name || ''} 
                onChange={(e) => setName(e.target.value)} 
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="complete-email">Endereço de E-mail</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input 
                id="complete-email"
                type="email" 
                placeholder="email@exemplo.com"
                value={email || ''} 
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="complete-phone">Número de Celular (WhatsApp)</label>
            <div className="input-wrapper">
              <span className="input-icon" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📞</span>
              <input 
                id="complete-phone"
                type="tel" 
                placeholder="(21) 99999-9999"
                value={phone} 
                onChange={handlePhoneChange} 
                required
              />
            </div>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: 'var(--primary-gold)', lineHeight: '1.4' }}>
              Precisamos do seu WhatsApp para confirmar a entrega e tirar dúvidas sobre o seu pedido!
            </p>
          </div>

          <button type="submit" disabled={actionLoading} className="auth-btn auth-btn-login">
            {actionLoading ? (
              <>
                <span className="spinner"></span>
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Salvar e Entrar</span>
              </>
            )}
          </button>
        </form>

        <button 
          type="button" 
          onClick={logout} 
          className="auth-tab-btn" 
          style={{ width: '100%', marginTop: '1.5rem', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'center', fontSize: '0.9rem' }}
        >
          Usar outra conta (Sair)
        </button>
      </div>
    );
  }

  // Visualizar painel de usuário logado
  if (user) {
    const badgeStyle = userData?.role ? getRoleBadgeStyles(userData.role) : { backgroundColor: '#6b7280', color: '#ffffff' };
    return (
      <div className="auth-container">
        <div className="auth-user-info">
          {user.photoURL ? (
            <img src={user.photoURL} alt={user.displayName || 'Avatar'} className="auth-avatar" decoding="async" />
          ) : (
            <div className="auth-avatar-fallback">
              <User size={18} />
            </div>
          )}
          <div className="auth-text-details">
            <span className="auth-name">{user.displayName || user.email}</span>
            {userData?.role && (
              <span className="auth-role-badge" style={badgeStyle}>
                <ShieldCheck size={12} style={{ marginRight: '4px' }} />
                {userData.role.toUpperCase()}
                {userData.role === 'staff' && getStaffSubroles()}
              </span>
            )}
          </div>
        </div>
        <button onClick={logout} className="auth-btn auth-btn-logout">
          <LogOut size={16} />
          <span>Sair da Conta</span>
        </button>
      </div>
    );
  }

  if (isForgotPasswordMode) {
    return (
      <div className="hybrid-auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <KeyRound size={20} style={{ color: 'var(--primary-gold)' }} />
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Redefinir Senha</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
          Digite o seu endereço de e-mail cadastrado e enviaremos um link para você redefinir sua senha.
        </p>

        <form onSubmit={handleForgotPasswordSubmit} className="auth-form">
          {error && <div className="auth-error-message">{error}</div>}
          {success && <div className="alert-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderLeftColor: '#10b981', marginBottom: '1.5rem', padding: '0.75rem', borderRadius: '8px', fontSize: '0.9rem' }}>{success}</div>}

          <div className="input-group">
            <label htmlFor="reset-email">Endereço de E-mail</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input 
                id="reset-email"
                type="email" 
                placeholder="exemplo@email.com" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required
              />
            </div>
          </div>

          <button type="submit" disabled={actionLoading} className="auth-btn auth-btn-login">
            {actionLoading ? (
              <>
                <span className="spinner"></span>
                <span>Enviando link...</span>
              </>
            ) : (
              <>
                <Mail size={16} />
                <span>Enviar Link de Redefinição</span>
              </>
            )}
          </button>
        </form>

        <button 
          type="button" 
          onClick={() => { setIsForgotPasswordMode(false); setError(null); setSuccess(null); }} 
          className="auth-tab-btn" 
          style={{ width: '100%', marginTop: '1.5rem', background: 'none', border: 'none', color: 'var(--primary-gold)', cursor: 'pointer', textAlign: 'center', fontSize: '0.9rem' }}
        >
          Voltar para o Login
        </button>
      </div>
    );
  }

  // Formulário de Login / Cadastro híbrido
  return (
    <div className="hybrid-auth-card">
      <div className="auth-tabs">
        <button 
          type="button" 
          className={`auth-tab-btn ${!isRegisterMode ? 'active' : ''}`}
          onClick={() => { setIsRegisterMode(false); setError(null); }}
        >
          Entrar
        </button>
        <button 
          type="button" 
          className={`auth-tab-btn ${isRegisterMode ? 'active' : ''}`}
          onClick={() => { setIsRegisterMode(true); setError(null); }}
        >
          Criar Conta
        </button>
      </div>

      <form onSubmit={handleFormSubmit} className="auth-form">
        {error && <div className="auth-error-message">{error}</div>}

        {isRegisterMode && (
          <>
            <div className="input-group">
              <label htmlFor="auth-name">Nome Completo</label>
              <div className="input-wrapper">
                <User size={18} className="input-icon" />
                <input 
                  id="auth-name"
                  type="text" 
                  placeholder="Seu nome"
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  required
                />
              </div>
            </div>

            <div className="input-group animate-fade-in">
              <label htmlFor="auth-phone">Número de Celular (WhatsApp)</label>
              <div className="input-wrapper">
                <span className="input-icon" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📞</span>
                <input 
                  id="auth-phone"
                  type="tel" 
                  placeholder="(21) 99999-9999"
                  value={phone} 
                  onChange={handlePhoneChange} 
                  required
                />
              </div>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: 'var(--primary-gold)', lineHeight: '1.4' }}>
                💡 <strong>Por que informar o celular?</strong> Precisamos de um contato direto para avisar sobre o andamento do seu pedido, tirar dúvidas sobre o endereço ou em caso de qualquer imprevisto com a entrega!
              </p>
            </div>
          </>
        )}

        <div className="input-group">
          <label htmlFor="auth-email">
            {isRegisterMode ? 'Endereço de E-mail' : 'E-mail, Celular (WhatsApp) ou Nome'}
          </label>
          <div className="input-wrapper">
            <Mail size={18} className="input-icon" />
            <input 
              id="auth-email"
              type={isRegisterMode ? 'email' : 'text'} 
              placeholder={isRegisterMode ? 'exemplo@email.com' : 'Digite seu e-mail, celular ou nome'} 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required
            />
          </div>
        </div>

        <div className="input-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="auth-password" style={{ margin: 0 }}>Senha de Acesso</label>
            {!isRegisterMode && (
              <button 
                type="button" 
                onClick={() => { setIsForgotPasswordMode(true); setError(null); setSuccess(null); }}
                style={{ background: 'none', border: 'none', color: 'var(--primary-gold)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
              >
                Esqueceu a senha?
              </button>
            )}
          </div>
          <div className="input-wrapper">
            <Lock size={18} className="input-icon" />
            <input 
              id="auth-password"
              type={showPassword ? 'text' : 'password'} 
              placeholder="Sua senha secreta" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
            />
            <button 
              type="button" 
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={actionLoading} className="auth-btn auth-btn-login">
          {actionLoading ? (
            <>
              <span className="spinner"></span>
              <span>Processando...</span>
            </>
          ) : isRegisterMode ? (
            <>
              <UserPlus size={16} />
              <span>Cadastrar Nova Conta</span>
            </>
          ) : (
            <>
              <LogIn size={16} />
              <span>Acessar Painel</span>
            </>
          )}
        </button>
      </form>

      <div className="auth-divider">
        <span>ou</span>
      </div>

      <button onClick={handleGoogleSignIn} disabled={actionLoading} className="google-auth-btn">
        <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
        </svg>
        <span>Entrar com o Google</span>
      </button>
    </div>
  );
};
