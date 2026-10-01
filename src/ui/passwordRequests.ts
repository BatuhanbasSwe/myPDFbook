import { useSyncExternalStore } from 'react';

/**
 * Uygulama içi şifre sorusu. `window.prompt` ana ekrana eklenmiş iOS uygulamasında çalışmayabilir: şifre, kökte bir
 * kez kurulan pencereden (PasswordPrompt) sorulur. Sorular sıraya girer, aynı anda tek pencere açılır (iki kitap
 * aynı anda şifre isterse ikincisi birincisi cevaplanınca gelir).
 */

export interface PasswordRequest {
  /** kitabın adı (pencerenin başlığında) */
  title: string;
  /** önceki şifre yanlıştı ("Şifre yanlış, tekrar dene") */
  retry: boolean;
}

export interface PendingPassword extends PasswordRequest {
  id: number;
}

interface Entry extends PendingPassword {
  resolve(answer: string | null): void;
}

const queue: Entry[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
const notify = () => listeners.forEach((listener) => listener());

/**
 * Şifre sorar; kullanıcı vazgeçerse null. `signal`: soran vazgeçti (okuyucu kapandı): soru sıradan çıkar, pencere
 * kapanır ve null döner.
 */
export function requestPassword(
  request: PasswordRequest,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const entry: Entry = { ...request, id: nextId++, resolve };
    queue.push(entry);
    if (queue.length === 1) notify();
    signal?.addEventListener('abort', () => remove(entry.id), { once: true });
  });
}

/** Soruyu sıradan çıkarır ve null ile cevaplar (gösterilen soruysa sıradaki gösterilir) */
function remove(id: number): void {
  const index = queue.findIndex((e) => e.id === id);
  if (index < 0) return;
  const [entry] = queue.splice(index, 1);
  entry.resolve(null);
  if (index === 0) notify();
}

/** Bütün soruları null ile cevaplayıp sırayı boşaltır (testler arasında) */
export function resetPasswordRequests(): void {
  for (const entry of queue.splice(0)) entry.resolve(null);
  notify();
}

/** Şu an gösterilen soru (sıranın başı) */
export function currentPasswordRequest(): PendingPassword | null {
  return queue[0] ?? null;
}

/** Gösterilen soruyu cevaplar (null: vazgeçildi); sıradaki soru gösterilir */
export function answerPasswordRequest(id: number, answer: string | null): void {
  if (queue[0]?.id !== id) return;
  queue.shift()!.resolve(answer);
  notify();
}

export function subscribePasswordRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const usePasswordRequest = () =>
  useSyncExternalStore(subscribePasswordRequests, currentPasswordRequest, currentPasswordRequest);
