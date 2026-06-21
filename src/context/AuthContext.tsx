import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type { UserDocument } from '../types/user';

interface AuthContextType {
  user: User | null;
  userData: UserDocument | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          let userDocSnap = await getDoc(userDocRef);
          
          if (userDocSnap.exists()) {
            setUserData(userDocSnap.data() as UserDocument);
          } else {
            let foundPreRegistration = false;
            if (currentUser.email) {
              const preRegQuery = query(collection(db, 'users'), where('email', '==', currentUser.email));
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
              const initialUserData: UserDocument = {
                uid: currentUser.uid,
                email: currentUser.email || '',
                name: currentUser.displayName || 'Novo Cliente',
                role: 'client',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              await setDoc(userDocRef, initialUserData);
              setUserData(initialUserData);
            }
          }
        } catch (error) {
          console.error("Erro ao buscar/criar dados do usuário no Firestore:", error);
          setUserData(null);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const loginWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const registerWithEmail = async (email: string, password: string, name: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const currentUser = userCredential.user;
    
    await updateProfile(currentUser, { displayName: name });
    
    const userDocRef = doc(db, 'users', currentUser.uid);
    const newUserData: UserDocument = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      name: name,
      role: 'client',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(userDocRef, newUserData);
    setUserData(newUserData);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, userData, loading, loginWithGoogle, loginWithEmail, registerWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  return context;
};
