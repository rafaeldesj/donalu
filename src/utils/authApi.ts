import { auth } from '../config/firebase';
import { API_BASE_URL } from '../config/api';

/** Chama uma função de servidor de /api/auth enviando o ID token do usuário logado. */
export async function callAuthApi<T = any>(action: string, body: Record<string, unknown>): Promise<T> {
  const current = auth.currentUser;
  if (!current) throw new Error('Você precisa estar logado.');
  const idToken = await current.getIdToken();
  const response = await fetch(`${API_BASE_URL}/api/auth/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.message || 'Não foi possível concluir a operação.');
  }
  return json as T;
}
