import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Processa o acúmulo e resgate de carimbos fidelidade do cliente ao finalizar um pedido.
 * Garante que apenas pastéis (doces/salgados) sejam contabilizados.
 * Desconta os carimbos caso tenha sido feito resgate de fidelidade.
 * O pastel resgatado de graça não soma carimbos novos.
 * Previne dupla contabilização usando uma transação e a tag 'loyaltyProcessed' no pedido.
 */
export const processOrderLoyaltyStamps = async (orderId: string, orderData: any) => {
  if (!orderId || !orderData || !orderData.clientUid || orderData.loyaltyProcessed) {
    return;
  }

  // Apenas processa se o status for 'completed'
  if (orderData.status !== 'completed') {
    return;
  }

  try {
    const userDocRef = doc(db, 'users', orderData.clientUid);
    const orderDocRef = doc(db, 'orders', orderId);

    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderDocRef);
      if (!orderSnap.exists()) return;

      const currentOrder = orderSnap.data();
      if (currentOrder.loyaltyProcessed || currentOrder.status !== 'completed') return;

      const userSnap = await transaction.get(userDocRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      
      // Fallback migration: if loyaltyStamps exists and loyaltyStampsGrande doesn't, migrate it.
      let currentStampsGrande = userData.loyaltyStampsGrande !== undefined ? userData.loyaltyStampsGrande : (userData.loyaltyStamps || 0);
      let currentStampsKids = userData.loyaltyStampsKids || 0;

      // Contabilizar pastéis doces e salgados no pedido
      let totalPastelsGrande = 0;
      let totalPastelsKids = 0;
      
      const items = currentOrder.items || [];
      items.forEach((item: any) => {
        const nameLower = (item.name || '').toLowerCase();
        const isPastel = 
          item.category === 'Pastéis Salgados' || 
          item.category === 'Pastéis Doces' ||
          nameLower.includes('pastel') || 
          nameLower.includes('ninho') || 
          nameLower.includes('kitkat') || 
          nameLower.includes('banana') || 
          nameLower.includes('morango') || 
          nameLower.includes('carne') || 
          nameLower.includes('queijo') || 
          nameLower.includes('frango') || 
          nameLower.includes('bacon') || 
          nameLower.includes('calabresa') || 
          nameLower.includes('palmito');

        if (isPastel) {
          const isKid = item.size === 'kids' || nameLower.includes('kids');
          if (isKid) {
            totalPastelsKids += (item.quantity || 1);
          } else {
            totalPastelsGrande += (item.quantity || 1);
          }
        }
      });

      let stampsToAddGrande = totalPastelsGrande;
      let stampsToAddKids = totalPastelsKids;
      let stampsToSubtractGrande = 0;
      let stampsToSubtractKids = 0;

      // Legacy fallback
      if (currentOrder.usedFidelityRescue) {
        stampsToAddGrande = Math.max(0, totalPastelsGrande - 1);
        stampsToSubtractGrande = 10;
      }
      
      if (currentOrder.usedFidelityRescueGrande) {
        stampsToAddGrande = Math.max(0, totalPastelsGrande - 1);
        stampsToSubtractGrande = 10;
      }

      if (currentOrder.usedFidelityRescueKids) {
        stampsToAddKids = Math.max(0, totalPastelsKids - 1);
        stampsToSubtractKids = 10;
      }

      const newStampsGrande = Math.max(0, currentStampsGrande - stampsToSubtractGrande + stampsToAddGrande);
      const newStampsKids = Math.max(0, currentStampsKids - stampsToSubtractKids + stampsToAddKids);

      // 1. Atualizar o saldo de carimbos do usuário
      transaction.update(userDocRef, { 
        loyaltyStampsGrande: newStampsGrande,
        loyaltyStampsKids: newStampsKids,
        // Mantém a propriedade legacy apenas para não quebrar outras partes, se houver
        loyaltyStamps: newStampsGrande,
        updatedAt: new Date().toISOString()
      });

      // 2. Marcar o pedido como processado pelo programa de fidelidade
      transaction.update(orderDocRef, { 
        loyaltyProcessed: true,
        updatedAt: new Date().toISOString()
      });
    });

    console.log(`Loyalty stamps processed successfully for order ${orderId}`);
  } catch (err) {
    console.error("Erro ao processar carimbos de fidelidade na transação:", err);
  }
};
