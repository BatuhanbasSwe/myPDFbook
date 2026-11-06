import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/browser/**'],
          environment: 'node',
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        // DOM ölçümü gereken kod (sayfalayıcı) ve yapay zekâ sesinin worker'ı gerçek tarayıcıda: Chromium ve iPad
        // Safari'nin motoru WebKit. Worker'ın ONNX Runtime'ı önceden paketlenir (test sürerken paketlenince Vite
        // sayfayı yeniden yükler).
        optimizeDeps: { include: ['onnxruntime-web/wasm'] },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
