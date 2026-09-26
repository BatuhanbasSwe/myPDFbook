import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev:ipad` → HTTPS + ağ erişimi. iPad'de crypto.subtle, service worker ve wake lock HTTPS ister.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), mode === 'ipad' && basicSsl()],
  // Çalışma ağaçları (.worktrees) ayrı kopyalardır: onlardaki değişiklik açık uygulamayı yeniden yüklemesin
  server: { watch: { ignored: ['**/.worktrees/**'] } },
  optimizeDeps: { entries: ['index.html'] },
}));
