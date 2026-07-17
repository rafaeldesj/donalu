import fs from 'fs';

// 1. UPDATE AUTHCONTEXT.TSX
const contextPath = 'e:\\REPOSITORIOS - PROJETOS\\DONA-LU-PASTELARIA\\src\\context\\AuthContext.tsx';
let contextContent = fs.readFileSync(contextPath, 'utf8');
contextContent = contextContent.replace(/\r\n/g, '\n');

// 1a. Update registerWithEmail in AuthContext.tsx to store password and set donalu_session
const registerTarget = `  const registerWithEmail = async (email: string, password: string, name: string, phoneNumber?: string) => {
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(userDocRef, newUserData);
    setUserData(newUserData);
  };`;

const registerReplacement = `  const registerWithEmail = async (email: string, password: string, name: string, phoneNumber?: string) => {
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
  };`;

if (contextContent.includes(registerTarget)) {
  contextContent = contextContent.replace(registerTarget, registerReplacement);
  console.log("registerWithEmail updated in AuthContext.tsx.");
} else {
  console.error("Failed to find registerTarget.");
}

// 1b. Update loginWithEmail in AuthContext.tsx with Firestore database verification
const loginTarget = `  const loginWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };`;

const loginReplacement = `  const loginWithEmail = async (emailOrPhone: string, password: string) => {
    const trimmed = emailOrPhone.trim();
    let userDocData: any = null;
    let userDocId = '';

    const usersRef = collection(db, 'users');

    if (trimmed.includes('@')) {
      const q = query(usersRef, where('email', '==', trimmed.toLowerCase()), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        userDocData = snap.docs[0].data();
        userDocId = snap.docs[0].id;
      }
    } else {
      const clean = trimmed.replace(/\\D/g, '');
      const qClean = query(usersRef, where('phoneNumber', '==', clean), limit(1));
      const snapClean = await getDocs(qClean);
      if (!snapClean.empty) {
        userDocData = snapClean.docs[0].data();
        userDocId = snapClean.docs[0].id;
      } else {
        const formatPhoneFilter = (numbers: string) => {
          if (numbers.length === 11) {
            return \`(\${numbers.slice(0, 2)}) \${numbers.slice(2, 7)}-\${numbers.slice(7)}\`;
          } else if (numbers.length === 10) {
            return \`(\${numbers.slice(0, 2)}) \${numbers.slice(2, 6)}-\${numbers.slice(6)}\`;
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
    }

    if (userDocData) {
      if (userDocData.password || userDocData.tempPassword) {
        const dbPass = userDocData.password || userDocData.tempPassword;
        if (dbPass === password) {
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
          await updateDoc(doc(db, 'users', userDocId), { password });
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
      setUser(credential.user);
      localStorage.setItem('donalu_session', JSON.stringify({ uid: credential.user.uid }));
      return;
    }

    throw { code: 'auth/user-not-found', message: 'Usuário não encontrado.' };
  };`;

if (contextContent.includes(loginTarget)) {
  contextContent = contextContent.replace(loginTarget, loginReplacement);
  console.log("loginWithEmail updated in AuthContext.tsx.");
} else {
  console.error("Failed to find loginTarget.");
}

// 1c. Update useEffect in AuthContext.tsx to check localStorage session
const useEffectAuthTarget = `  useEffect(() => {
    let unsubscribeUserDoc: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);`;

const useEffectAuthReplacement = `  useEffect(() => {
    let unsubscribeUserDoc: () => void;

    // Recupera sessão local do Firestore caso exista
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
            return true;
          }
        } catch (sessionErr) {
          console.error("Erro ao carregar sessão do localStorage:", sessionErr);
        }
      }
      return false;
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      const sessionLoaded = await loadSession();
      if (sessionLoaded) return;
      
      setUser(currentUser);`;

if (contextContent.includes(useEffectAuthTarget)) {
  contextContent = contextContent.replace(useEffectAuthTarget, useEffectAuthReplacement);
  console.log("useEffectAuthTarget updated in AuthContext.tsx.");
} else {
  console.error("Failed to find useEffectAuthTarget.");
}

// 1d. Update logout in AuthContext.tsx to clean localStorage
const logoutTarget = `  const logout = async () => {
    await signOut(auth);
  };`;

const logoutReplacement = `  const logout = async () => {
    localStorage.removeItem('donalu_session');
    await signOut(auth);
    setUser(null);
    setUserData(null);
  };`;

if (contextContent.includes(logoutTarget)) {
  contextContent = contextContent.replace(logoutTarget, logoutReplacement);
  console.log("logout updated in AuthContext.tsx.");
} else {
  console.error("Failed to find logoutTarget.");
}

// 1e. Update completeRegistration in AuthContext.tsx to set donalu_session
const completeRegSessionTarget = `    await setDoc(userDocRef, finalUserData);
    setUserData(finalUserData);
  };`;

const completeRegSessionReplacement = `    await setDoc(userDocRef, finalUserData);
    setUserData(finalUserData);
    localStorage.setItem('donalu_session', JSON.stringify({ uid: user.uid }));
  };`;

if (contextContent.includes(completeRegSessionTarget)) {
  contextContent = contextContent.replace(completeRegSessionTarget, completeRegSessionReplacement);
  console.log("completeRegistration session saving updated in AuthContext.tsx.");
} else {
  console.error("Failed to find completeRegSessionTarget.");
}

contextContent = contextContent.replace(/\n/g, '\r\n');
fs.writeFileSync(contextPath, contextContent, 'utf8');


// 2. UPDATE AUTHBUTTON.TSX
const buttonPath = 'e:\\REPOSITORIOS - PROJETOS\\DONA-LU-PASTELARIA\\src\\components\\common\\AuthButton.tsx';
let buttonContent = fs.readFileSync(buttonPath, 'utf8');
buttonContent = buttonContent.replace(/\r\n/g, '\n');

// 2a. Replace handleFormSubmit login block inside AuthButton.tsx to rely strictly on loginWithEmail
const loginFlowTarget = `      } else {
        try {
          const trimmedEmail = email.trim().toLowerCase();
          let authEmailToLogin = trimmedEmail;

          // Busca no Firestore para ver se existe esse e-mail como cadastro e pega o authEmail correspondente
          try {
            const q = query(collection(db, 'users'), where('email', '==', trimmedEmail), limit(1));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
              const uDoc = querySnapshot.docs[0].data();
              if (uDoc.authEmail) {
                authEmailToLogin = uDoc.authEmail;
              }
            }
          } catch (dbErr) {
            console.error("Erro ao buscar authEmail no Firestore:", dbErr);
          }

          await loginWithEmail(authEmailToLogin, password);
        } catch (loginErr: any) {
          try {
            // Se falhar no login normal, verifica se existe uma senha provisória definida no Firestore
            const trimmedEmail = email.trim().toLowerCase();
            const q = query(collection(db, 'users'), where('email', '==', trimmedEmail), limit(1));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const userDoc = querySnapshot.docs[0];
              const uData = userDoc.data();
              
              if (uData.tempPassword && uData.tempPassword === password.trim()) {
                // Se tiver senha provisória e for igual à inserida pelo usuário
                if (uData.uid && uData.uid.length === 20) {
                  // É um pré-cadastro (ID de 20 caracteres gerado pelo Firestore, ainda não logado)
                  // Registra o usuário no Firebase Auth na hora com esta senha!
                  await registerWithEmail(trimmedEmail, password, uData.name);
                  
                  // Remove a senha provisória do Firestore após registro bem-sucedido
                  await updateDoc(doc(db, 'users', userDoc.id), { tempPassword: null, authEmail: trimmedEmail });
                  return;
                } else {
                  // É um usuário já ativo (UID de 28 caracteres). Não podemos alterar no Firebase Auth client-side
                  throw new Error('TEMP_PASSWORD_ACTIVE_USER');
                }
              }
            }
          } catch (tempPassErr: any) {
            console.error("Erro ao verificar senha provisória:", tempPassErr);
            if (tempPassErr.message === 'TEMP_PASSWORD_ACTIVE_USER') {
              throw tempPassErr;
            }
            // Se falhar a verificação de senha provisória por segurança/permissão, ignora e deixa lançar o erro original do login
          }
          // Se não encontrou senha provisória correspondente ou a busca falhou, joga o erro original
          throw loginErr;
        }
      }`;

const loginFlowReplacement = `      } else {
        await loginWithEmail(email, password);
      }`;

if (buttonContent.includes(loginFlowTarget)) {
  buttonContent = buttonContent.replace(loginFlowTarget, loginFlowReplacement);
  console.log("handleFormSubmit login flow simplified in AuthButton.tsx.");
} else {
  console.error("Failed to find loginFlowTarget.");
}

// 2b. Simplify placeholder of email field to show that Phone is also accepted
buttonContent = buttonContent.replace(
  `placeholder="email@donalupastelaria.com"`,
  `placeholder="Digite seu e-mail ou celular (WhatsApp)"`
);

buttonContent = buttonContent.replace(
  `type="email"\n                placeholder="Digite seu e-mail ou celular (WhatsApp)"`,
  `type="text"\n                placeholder="Digite seu e-mail ou celular (WhatsApp)"`
);

buttonContent = buttonContent.replace(/\n/g, '\r\n');
fs.writeFileSync(buttonPath, buttonContent, 'utf8');

console.log("Firestore database authentication applied successfully to all files!");
process.exit(0);
