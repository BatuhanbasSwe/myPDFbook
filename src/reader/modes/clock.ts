/** Okuma modlarının saati: tarayıcıda gerçek saat, testlerde sahte zamanlayıcı */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * Tarayıcının saati. `now` tekdüze saattir (performance.now): cihazın saati ayarlanınca ya da eşitlenince geri gitmez,
 * atlamaz. Bu saatle ölçülen anlar (ör. `since`, `sleepAt`) yalnızca yine bu saatle karşılaştırılır, Date.now ile değil.
 */
export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
