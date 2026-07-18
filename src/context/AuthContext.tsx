import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc, limit, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
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

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    const loadSession = async () => {
      const savedSession = localStorage.getItem('donalu_session');
      if (savedSession) {
        try {
          const { uid } = JSON.parse(savedSession);
          const userDocRef = doc(db, 'users', uid);
          const docSnap = await getDoc(userDocRef);
          if (docSnap.exists()) {
            const uData = docSnap.data() as UserDocument;
            setUserData(uData);
            setUser({
              uid: uData.uid || uid,
              email: uData.email,
              displayName: uData.name,
              emailVerified: true
            } as any);
            setLoading(false);

            // Estabelece sessão silenciosa no Firebase Auth no F5 se houver senha salva no Firestore
            if (uData.email && uData.password) {
              signInWithEmailAndPassword(auth, uData.email, uData.password).catch(authErr => {
                console.warn("Falha ao reestabelecer Auth silencioso no F5:", authErr);
              });
            }
            return true;
          }
        } catch (sessionErr) {
          console.error("Erro ao carregar sessão do localStorage:", sessionErr);
        }
      }
      return false;
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      const savedSession = localStorage.getItem('donalu_session');
      let isTempSession = false;
      if (savedSession) {
        try {
          const { uid } = JSON.parse(savedSession);
          isTempSession = uid && uid.length === 20;
        } catch (e) {}
      }

      const sessionLoaded = await loadSession();
      if (sessionLoaded && !isTempSession) return;

      setUser(currentUser);
      
      // Limpa listener do documento anterior caso exista
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        
        // Escuta o perfil do usuário em tempo real
        unsubscribeUserDoc = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            const uData = docSnap.data() as UserDocument;
            setUserData(uData);

            // Sincroniza e-mail no Firebase Auth caso o gerente o tenha alterado no Firestore
            if (currentUser.email && uData.email && currentUser.email.toLowerCase() !== uData.email.toLowerCase()) {
              try {
                const { updateEmail } = await import('firebase/auth');
                await updateEmail(currentUser, uData.email.toLowerCase());
                await updateDoc(userDocRef, { authEmail: uData.email.toLowerCase() });
                console.log("E-mail de autenticação sincronizado com sucesso no Firebase Auth!");
              } catch (authErr) {
                console.warn("Não foi possível atualizar e-mail no Auth silenciosamente (exige reautenticação recente):", authErr);
              }
            }
          } else {
            // Se o documento não existir no banco, busca pré-cadastro
            try {
              let foundPreRegistration = false;
              if (currentUser.email) {
                const emailLower = currentUser.email.toLowerCase();
                const preRegQuery = query(collection(db, 'users'), where('email', '==', emailLower), limit(1));
                let querySnapshot = await getDocs(preRegQuery);
                
                if (querySnapshot.empty && currentUser.email !== emailLower) {
                  const preRegQueryOrig = query(collection(db, 'users'), where('email', '==', currentUser.email), limit(1));
                  querySnapshot = await getDocs(preRegQueryOrig);
                }
                
                if (!querySnapshot.empty) {
                  const preRegDoc = querySnapshot.docs[0];
                  const preRegData = preRegDoc.data() as UserDocument;
                  
                  const finalUserData: UserDocument = {
                    ...preRegData,
                    uid: currentUser.uid,
                    updatedAt: new Date().toISOString(),
                  };
                  
                  await setDoc(userDocRef, finalUserData);
                  if (preRegDoc.id !== currentUser.uid) {
                    await deleteDoc(doc(db, 'users', preRegDoc.id));
                  }
                  
                  localStorage.setItem('donalu_session', JSON.stringify({ uid: currentUser.uid }));
                  setUserData(finalUserData);
                  foundPreRegistration = true;
                }
              }

              if (!foundPreRegistration) {
                setUserData(prev => prev ? prev : null);
              }
            } catch (err) {
              console.error("Erro ao buscar pré-cadastro do usuário:", err);
              setUserData(prev => prev ? prev : null);
            }
          }
          setLoading(false);
        }, (error) => {
          console.error("Erro na escuta em tempo real do perfil do usuário:", error);
          setLoading(false);
        });

      } else {
        // Só limpa o userData se não houver nenhuma sessão ativa salva no localStorage
        const savedSession = localStorage.getItem('donalu_session');
        if (!savedSession) {
          setUserData(null);
        }
        setLoading(false);
      }
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
      } catch (err: any) {
        console.warn("signInWithPopup falhou no celular, tentando redirect...", err);
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
          await signInWithRedirect(auth, provider);
        } else {
          throw err;
        }
      }
    } else {
      await signInWithPopup(auth, provider);
    }
  };

  const loginWithEmail = async (emailOrPhone: string, password: string) => {
    const trimmed = emailOrPhone.trim();
    let userDocData: any = null;
    let userDocId = '';

    const usersRef = collection(db, 'users');

    try {
      const trimmedLower = trimmed.toLowerCase();
      const isPhone = /^\d+$/.test(trimmed.replace(/\D/g, ''));

      if (trimmed.includes('@')) {
        const q = query(usersRef, where('email', '==', trimmedLower), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          userDocData = snap.docs[0].data();
          userDocId = snap.docs[0].id;
        }
      } else if (isPhone && trimmed.replace(/\D/g, '').length >= 8) {
        const clean = trimmed.replace(/\D/g, '');
        const qClean = query(usersRef, where('phoneNumber', '==', clean), limit(1));
        const snapClean = await getDocs(qClean);
        if (!snapClean.empty) {
          userDocData = snapClean.docs[0].data();
          userDocId = snapClean.docs[0].id;
        } else {
          const formatPhoneFilter = (numbers: string) => {
            if (numbers.length === 11) {
              return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
            } else if (numbers.length === 10) {
              return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
            }
            return numbers;
          };
          const formatted = formatPhoneFilter(clean);
          const qFormat = query(usersRef, where('phoneNumber', '==', formatted), limit(1));
          const snapFormat = await getDocs(qFormat);
          if (!snapFormat.empty) {
            userDocData = snapFormat.docs[0].data();
            userDocId = snapFormat.docs[0].id;
          }
        }
      } else {
        // Busca compatível com as regras rígidas do list (filtro de igualdade direta '==')
        // Tenta buscar pelo nome exato (como Rafael Jorge)
        const qName = query(usersRef, where('name', '==', trimmed), limit(1));
        const snapName = await getDocs(qName);
        if (!snapName.empty) {
          userDocData = snapName.docs[0].data();
          userDocId = snapName.docs[0].id;
        } else {
          // Tenta buscar com o nome todo em minúsculas
          const qNameLower = query(usersRef, where('name', '==', trimmedLower), limit(1));
          const snapNameLower = await getDocs(qNameLower);
          if (!snapNameLower.empty) {
            userDocData = snapNameLower.docs[0].data();
            userDocId = snapNameLower.docs[0].id;
          }
        }
      }
    } catch (dbErr) {
      console.warn("Erro de busca no Firestore antes do login, usando fallback:", dbErr);
    }

    if (userDocData) {
      if (userDocData.password || userDocData.tempPassword) {
        const dbPass = userDocData.password || userDocData.tempPassword;
        if (dbPass === password) {
          // Autentica de verdade no Firebase Auth para liberar privilégios administrativos
          try {
            await signInWithEmailAndPassword(auth, userDocData.email, password);
          } catch (authErr) {
            console.warn("Sessão Auth paralela não pôde ser estabelecida, operando com sessão Firestore local:", authErr);
          }

          const mockUser = {
            uid: userDocData.uid || userDocId,
            email: userDocData.email,
            displayName: userDocData.name,
            emailVerified: true
          } as any;

          setUser(mockUser);
          setUserData(userDocData);
          localStorage.setItem('donalu_session', JSON.stringify({ uid: userDocData.uid || userDocId }));
          return;
        } else {
          throw { code: 'auth/wrong-password', message: 'Senha incorreta.' };
        }
      } else {
        try {
          const credential = await signInWithEmailAndPassword(auth, userDocData.email, password);
          try {
            await updateDoc(doc(db, 'users', userDocId), { password });
          } catch (dbUpdateErr) {
            console.warn("Erro ao atualizar senha no Firestore após login do Auth:", dbUpdateErr);
          }
          const updatedData = { ...userDocData, password };
          setUser(credential.user);
          setUserData(updatedData);
          localStorage.setItem('donalu_session', JSON.stringify({ uid: userDocId }));
          return;
        } catch (authErr) {
          throw authErr;
        }
      }
    }

    if (trimmed.includes('@')) {
      const credential = await signInWithEmailAndPassword(auth, trimmed.toLowerCase(), password);
      
      try {
        const userDocRef = doc(db, 'users', credential.user.uid);
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          const uData = docSnap.data();
          try {
            await updateDoc(userDocRef, { password });
          } catch (dbUpdateErr) {
            console.warn("Erro ao salvar senha no Firestore:", dbUpdateErr);
          }
          setUserData({ ...uData, password } as any);
        }
      } catch (dbFetchErr) {
        console.error("Erro ao recuperar perfil pós-login do Auth:", dbFetchErr);
      }

      setUser(credential.user);
      localStorage.setItem('donalu_session', JSON.stringify({ uid: credential.user.uid }));
      return;
    }

    throw { code: 'auth/user-not-found', message: 'Usuário não encontrado.' };
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
      name: name,
      role: 'client',
      phoneNumber: phoneNumber || '',
      password: password,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(userDocRef, newUserData);
    setUserData(newUserData);
    localStorage.setItem('donalu_session', JSON.stringify({ uid: currentUser.uid }));
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
        console.error("Erro ao atualizar email no Firebase Auth:", authErr);
        // Prossegue com o Firestore mesmo se falhar no Auth (ex: exige reautenticação recente)
        finalEmail = emailVal.trim().toLowerCase();
      }
    }

    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);
    const existingData = userDocSnap.exists() ? userDocSnap.data() as UserDocument : null;
    
    const finalUserData: UserDocument = {
      role: existingData?.role || 'client',
      createdAt: existingData?.createdAt || new Date().toISOString(),
      ...(existingData || {}),
      uid: user.uid,
      email: finalEmail,
      name: name,
      phoneNumber: phone,
      updatedAt: new Date().toISOString()
    };
    
    await setDoc(userDocRef, finalUserData);
    setUserData(finalUserData);
    localStorage.setItem('donalu_session', JSON.stringify({ uid: user.uid }));
  };

  const logout = async () => {
    localStorage.removeItem('donalu_session');
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

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
};
