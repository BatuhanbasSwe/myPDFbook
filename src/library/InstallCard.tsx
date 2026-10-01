import { Download, Share } from 'lucide-react';
import { dismissInstallCard, iosInstallHint, promptInstall, useInstallCard } from '../app/install';
import { InfoStrip, stripAction } from '../ui/InfoStrip';

/** Kütüphanede "ana ekrana kur" şeridi: yalnızca kurulu değilken ve kapatılmamışken görünür (bkz. app/install.ts). */
export function InstallCard() {
  const { kind, device } = useInstallCard();
  if (!kind) return null;
  return (
    <InfoStrip
      testId="install-card"
      label="Uygulamayı kur"
      Icon={kind === 'ios' ? Share : Download}
      title={kind === 'ios' ? iosInstallHint(device) : 'Uygulama olarak kur'}
      onClose={dismissInstallCard}
      closeLabel="Kurulum kartını kapat"
      action={
        kind === 'prompt' && (
          <button type="button" onClick={() => void promptInstall()} className={stripAction}>
            Uygulamayı yükle
          </button>
        )
      }
    >
      Tam ekran açılır, internetsiz çalışır; kitapların tarayıcı temizliğine karşı daha güvende
      kalır.
    </InfoStrip>
  );
}
