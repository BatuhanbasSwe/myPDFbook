import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'masaustu-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
});
