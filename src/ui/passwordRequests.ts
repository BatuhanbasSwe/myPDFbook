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

/** Şifre sorar; kullanıcı vazgeçerse null */
export function requestPassword(request: PasswordRequest): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ ...request, id: nextId++, resolve });
    if (queue.length === 1) notify();
  });
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
