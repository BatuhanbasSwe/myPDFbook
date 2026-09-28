import { Download, Share, X } from 'lucide-react';
import { dismissInstallCard, iosInstallHint, promptInstall, useInstallCard } from '../app/install';

/** Kütüphanede "ana ekrana kur" kartı: yalnızca kurulu değilken ve kapatılmamışken görünür (bkz. app/install.ts). */
export function InstallCard() {
  const { kind, device } = useInstallCard();
  if (!kind) return null;
  return (
    <section
      data-testid="install-card"
      aria-label="Uygulamayı kur"
      className="mb-8 flex items-center gap-4 rounded-xl border border-line bg-surface p-4"
    >
      {kind === 'ios' ? (
        <Share className="size-6 shrink-0 text-accent" aria-hidden />
      ) : (
        <Download className="size-6 shrink-0 text-accent" aria-hidden />
      )}
      {/* Dar ekranda düğme metnin altına iner */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <p className="font-book text-lg">
            {kind === 'ios' ? iosInstallHint(device) : 'Uygulama olarak kur'}
          </p>
          <p className="text-xs text-muted">
            Tam ekran açılır, internetsiz çalışır; kitapların tarayıcı temizliğine karşı daha
            güvende kalır.
          </p>
        </div>
        {kind === 'prompt' && (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper"
          >
            Uygulamayı yükle
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismissInstallCard}
        aria-label="Kurulum kartını kapat"
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-paper"
      >
        <X className="size-5" />
      </button>
    </section>
  );
}
