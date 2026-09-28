import { defineConfig, devices } from '@playwright/test';

// PWA e2e'si: service worker yalnızca derlemede olduğu için `vite build` + `vite preview` üzerinde koşar
// (geliştirme sunucusundaki e2e: playwright.config.ts). Alt yol (GitHub Pages gibi) da burada sınanır.
// Çalıştırma: pnpm e2e:pwa   —   WebKit de denensin: PWA_WEBKIT=1 pnpm e2e:pwa
const PORT = 5175;
const BASE_PATH = '/myPDFbook/';
const url = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.pwa.ts',
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Sayfa adresleri göreli verilir ('./'): alt yolun altında kalır
  use: { baseURL: url, trace: 'retain-on-failure', serviceWorkers: 'allow' },
  webServer: {
    command: `pnpm exec vite build --outDir dist-e2e --emptyOutDir && pnpm exec vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    env: { BASE_PATH },
    url,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.PWA_WEBKIT ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
