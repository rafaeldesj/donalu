import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAzR9UQyV0xIwYgU9xoTuiEfqwhIiDvIrU",
  authDomain: "dona-lu-4242d.firebaseapp.com",
  projectId: "dona-lu-4242d",
  storageBucket: "dona-lu-4242d.firebasestorage.app",
  messagingSenderId: "87878437306",
  appId: "1:87878437306:web:6bb76b8dadd3e7dbd43583"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkOrders() {
  console.log('Checking recent orders...');
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(5));
  const snap = await getDocs(q);
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`Order ${doc.id}: Status=${data.status}, Method=${data.paymentMethod}, MP_ID=${data.mercadoPagoOrderId}, Time=${data.createdAt}`);
  });
  process.exit(0);
}

checkOrders().catch(console.error);
