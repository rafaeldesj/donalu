import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc, limit, onSnapshot } from 'firebase/firestore';
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
  completeRegistration: (name: string, phone: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
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
            setUserData(docSnap.data() as UserDocument);
          } else {
            // Se o documento não existir no banco, busca pré-cadastro
            try {
              let foundPreRegistration = false;
              if (currentUser.email) {
                const preRegQuery = query(collection(db, 'users'), where('email', '==', currentUser.email), limit(1));
                const querySnapshot = await getDocs(preRegQuery);
                
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
                  
                  setUserData(finalUserData);
                  foundPreRegistration = true;
                }
              }

              if (!foundPreRegistration) {
                setUserData(null);
              }
            } catch (err) {
              console.error("Erro ao buscar pré-cadastro do usuário:", err);
              setUserData(null);
            }
          }
          setLoading(false);
        }, (error) => {
          console.error("Erro na escuta em tempo real do perfil do usuário:", error);
          setLoading(false);
        });

      } else {
        setUserData(null);
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

  const loginWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const registerWithEmail = async (email: string, password: string, name: string, phoneNumber?: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const currentUser = userCredential.user;
    
    await updateProfile(currentUser, { displayName: name });
    
    const userDocRef = doc(db, 'users', currentUser.uid);
    const newUserData: UserDocument = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      name: name,
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

  const completeRegistration = async (name: string, phone: string) => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);
    const existingData = userDocSnap.exists() ? userDocSnap.data() as UserDocument : null;
    
    const finalUserData: UserDocument = {
      uid: user.uid,
      email: user.email || '',
      name: name,
      role: existingData?.role || 'client',
      phoneNumber: phone,
      createdAt: existingData?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(existingData || {})
    };
    
    await setDoc(userDocRef, finalUserData);
    setUserData(finalUserData);
  };

  const logout = async () => {
    await signOut(auth);
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
