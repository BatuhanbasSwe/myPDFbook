import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Açık tema kâğıt rengi (src/app/theme.ts, index.html ile aynı): manifest ve açılış ekranı */
const PAPER = '#f7f3ea';

/**
 * Uygulamanın yayınlandığı alt yol. Ör. GitHub Pages: `BASE_PATH=/myPDFbook/ pnpm build` (bkz. docs/deploy.md).
 * Router, pdf.js varlıkları, manifest ve service worker kapsamı bundan türetilir (`import.meta.env.BASE_URL`).
 */
function basePath(raw = '/'): string {
  // Git Bash, `/myPDFbook/` gibi değerleri Windows yoluna çevirir (C:/Program Files/Git/myPDFbook/)
  if (/^[a-z]:/i.test(raw))
    throw new Error(
      `BASE_PATH bir Windows yoluna dönüşmüş: "${raw}". Git Bash'te MSYS_NO_PATHCONV=1 ekleyin (bkz. docs/deploy.md).`,
    );
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

// `pnpm dev:ipad` → HTTPS + ağ erişimi. iPad'de crypto.subtle, service worker ve wake lock HTTPS ister.
export default defineConfig(({ mode }) => {
  const base = basePath(process.env.BASE_PATH);
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      mode === 'ipad' && basicSsl(),
      // Service worker yalnızca derlemede üretilir (geliştirme sunucusu ve e2e'si etkilenmez).
      // 'prompt': yeni sürüm kendiliğinden devreye girmez; kütüphanede "Yeni sürüm hazır — Yenile" gösterilir.
      VitePWA({
        registerType: 'prompt',
        injectRegister: false, // kayıt src/app/pwa.ts'te (virtual:pwa-register/react)
        includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon-180.png'],
        manifest: {
          id: base,
          name: 'mypdfbook',
          short_name: 'mypdfbook',
          description:
            'PDF kitaplarını kitap gibi oku: sayfa ve metin görünümü, notlar, sesli ve hızlı okuma. İnternetsiz çalışır.',
          lang: 'tr',
          dir: 'ltr',
          display: 'standalone',
          orientation: 'any',
          theme_color: PAPER,
          background_color: PAPER,
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: [
            // Uygulama kabuğu ve pdf.js worker'ı (assets/pdf.worker.min-*.mjs)
            'index.html',
            // (simgeler ve manifest: includeAssets ve manifest.icons'tan kendiliğinden eklenir)
            'assets/*.{js,mjs,css}',
            // Arayüz ve kitap fontları: yalnızca Latin ve Latin Genişletilmiş (Türkçe) alt kümeleri
            'assets/*-latin-*.woff2',
            // pdf.js varlıkları: Asya fontları için cmap, gömülmemiş fontlar, taranmış görüntü çözücüleri ve
            // renk profili. quickjs-eval (PDF içi JavaScript) kullanılmıyor.
            'pdfjs/cmaps/*.bcmap',
            'pdfjs/standard_fonts/*.{pfb,ttf}',
            'pdfjs/wasm/{jbig2,openjpeg,qcms_bg}.wasm',
            'pdfjs/wasm/*_nowasm_fallback.js',
            'pdfjs/iccs/*.icc',
          ],
          // En büyük dosyalar pdf.js worker'ı (~1,3 MB) ve uygulama paketi (~1 MB); büyümeye pay bırakıldı
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // /read/:id gibi adresler çevrimdışı da index.html ile açılır
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Önbellekte olmayan font alt kümeleri (Kiril, Yunan, Vietnam) ilk kullanımda saklanır
              urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === 'font',
              handler: 'CacheFirst',
              options: { cacheName: 'fonts', expiration: { maxEntries: 60 } },
            },
          ],
        },
      }),
    ],
    // Çalışma ağaçları (.worktrees) ayrı kopyalardır: onlardaki değişiklik açık uygulamayı yeniden yüklemesin
    server: { watch: { ignored: ['**/.worktrees/**'] } },
    optimizeDeps: { entries: ['index.html'] },
  };
});
