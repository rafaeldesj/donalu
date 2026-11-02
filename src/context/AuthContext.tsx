import { createContext, useContext, useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut,
  signInWithEmailAndPassword, signInWithCustomToken, createUserWithEmailAndPassword, updateProfile
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { API_BASE_URL } from '../config/api';
import type { UserDocument } from '../types/user';

interface AuthContextType {
  user: User | null;
  userData: UserDocument | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string, phoneNumber?: string) => Promise<void>;
  logout: () => Promise<void>;
  updatePhoneNumber: (phone: string) => Promise<void>;
  completeRegistration: (name: string, phone: string, email?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Remove qualquer resquício de senha que ainda exista em documentos antigos.
const stripSecrets = <T extends object>(data: T): T => {
  const rest = { ...data } as Record<string, unknown>;
  delete rest.password;
  delete rest.tempPassword;
  return rest as T;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const claimAttemptedRef = useRef(false);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    // Sessões do modelo antigo (sem login real) deixam de valer.
    try { localStorage.removeItem('donalu_session'); } catch { /* ignore */ }

    // O Firebase Authentication é a única fonte de sessão.
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);

      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (!currentUser) {
        claimAttemptedRef.current = false;
        setUserData(null);
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'users', currentUser.uid);
      unsubscribeUserDoc = onSnapshot(userDocRef, async (docSnap) => {
        if (docSnap.exists()) {
          setUserData(stripSecrets(docSnap.data() as UserDocument));
          setLoading(false);
          return;
        }

        // Sem perfil: pede ao servidor para assumir um pré-cadastro feito por um gerente (mesmo e-mail verificado).
        if (!claimAttemptedRef.current) {
          claimAttemptedRef.current = true;
          try {
            const idToken = await currentUser.getIdToken();
            await fetch(`${API_BASE_URL}/api/auth/claim-profile`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
              body: '{}'
            });
            // se houve pré-cadastro, o onSnapshot dispara de novo com o documento criado
          } catch (err) {
            console.error('Erro ao buscar pré-cadastro do usuário:', err);
          }
        }
        setUserData(null);
        setLoading(false);
      }, (error) => {
        console.error('Erro na escuta em tempo real do perfil do usuário:', error);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;

    if (isMobile && !isLocalhost) {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.warn('signInWithPopup falhou no celular, tentando redirect...', err);
        const code = (err as { code?: string }).code;
        if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
          await signInWithRedirect(auth, provider);
        } else {
          throw err;
        }
      }
    } else {
      await signInWithPopup(auth, provider);
    }
  };

  /**
   * Login por e-mail (direto no Firebase Auth) ou por telefone (função de servidor que valida a senha
   * no Firebase Auth e devolve um token de sessão). Nenhuma senha é lida ou comparada no navegador.
   */
  const loginWithEmail = async (emailOrPhone: string, password: string) => {
    const trimmed = emailOrPhone.trim();

    if (trimmed.includes('@')) {
      await signInWithEmailAndPassword(auth, trimmed.toLowerCase(), password);
      return;
    }

    const phoneDigits = trimmed.replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      throw { code: 'auth/invalid-credential', message: 'Telefone ou senha incorretos.' };
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/auth/login-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneDigits, password })
      });
    } catch {
      throw { code: 'auth/network-request-failed', message: 'Sem conexão. Tente novamente.' };
    }

    if (response.status === 429) throw { code: 'auth/too-many-requests', message: 'Muitas tentativas.' };
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.token) {
      throw { code: 'auth/invalid-credential', message: 'Telefone ou senha incorretos.' };
    }
    await signInWithCustomToken(auth, json.token);
  };

  const registerWithEmail = async (email: string, password: string, name: string, phoneNumber?: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const currentUser = userCredential.user;

    await updateProfile(currentUser, { displayName: name });

    const userDocRef = doc(db, 'users', currentUser.uid);
    const newUserData: UserDocument = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      authEmail: currentUser.email || '',
      name,
      role: 'client',
      phoneNumber: phoneNumber || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(userDocRef, newUserData);
    setUserData(newUserData);
  };

  const updatePhoneNumber = async (phone: string) => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    await setDoc(userDocRef, { phoneNumber: phone, updatedAt: new Date().toISOString() }, { merge: true });
    setUserData(prev => prev ? { ...prev, phoneNumber: phone } : null);
  };

  const completeRegistration = async (name: string, phone: string, emailVal?: string) => {
    if (!user) return;

    let finalEmail = user.email || '';
    if (emailVal && emailVal.trim().toLowerCase() !== finalEmail.toLowerCase()) {
      try {
        const { updateEmail } = await import('firebase/auth');
        await updateEmail(user, emailVal.trim().toLowerCase());
        finalEmail = emailVal.trim().toLowerCase();
      } catch (authErr) {
        console.error('Erro ao atualizar email no Firebase Auth:', authErr);
        // Prossegue com o Firestore mesmo se falhar no Auth (ex: exige reautenticação recente)
        finalEmail = emailVal.trim().toLowerCase();
      }
    }

    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);
    const existingData = userDocSnap.exists() ? stripSecrets(userDocSnap.data() as UserDocument) : null;

    const finalUserData: UserDocument = {
      role: existingData?.role || 'client',
      createdAt: existingData?.createdAt || new Date().toISOString(),
      ...(existingData || {}),
      uid: user.uid,
      email: finalEmail,
      name,
      phoneNumber: phone,
      updatedAt: new Date().toISOString()
    };

    await setDoc(userDocRef, finalUserData);
    setUserData(finalUserData);
  };

  const logout = async () => {
    try { localStorage.removeItem('donalu_session'); } catch { /* ignore */ }
    await signOut(auth);
    setUser(null);
    setUserData(null);
  };

  return (
    <AuthContext.Provider value={{ user, userData, loading, loginWithGoogle, loginWithEmail, registerWithEmail, logout, updatePhoneNumber, completeRegistration }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
};
