/**
 * Yalnızca geliştirmede ve testte: e2e testi sayfaya `window.__renders = {}` koyarsa bileşenin çizim sayısı sayılır
 * (ör. RSVP'de okuyucu her kelimede yeniden çizilmesin). Çağıran `import.meta.env.DEV` ile korur: üretim derlemesinde
 * çağrı da bu dosya da yoktur.
 */
export function countRender(name: string): void {
  const counts = (window as { __renders?: Record<string, number> }).__renders;
  if (counts) counts[name] = (counts[name] ?? 0) + 1;
}
