import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface LogAuditParams {
  userId: string;
  userEmail: string;
  userName: string;
  actionType: string;
  title: string;
  description: string;
  userRole?: string;
  metadata?: any;
  timestamp?: any;
}

export const logAuditAction = async (params: LogAuditParams) => {
  try {
    const logsRef = collection(db, 'audit_logs');
    await addDoc(logsRef, {
      ...params,
      userRole: params.userRole || 'guest',
      metadata: params.metadata || null,
      timestamp: serverTimestamp ? serverTimestamp() : new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro ao registrar log de auditoria:', error);
  }
};
