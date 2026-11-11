import { Download, Share, SquarePlus, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode, type RefObject } from 'react';
import { promptInstall, useInstallMenu } from '../app/install';
import { ListGroup } from '../ui/List';
import type { MenuAction } from '../ui/MenuButton';
import { Sheet } from '../ui/Sheet';

/**
 * Kütüphanenin ⋯ menüsünde "Uygulamayı yükle": kurulum şeridi kapatılmış olsa da kurulum yeniden gösterilir.
 * Chromium kurulum olayını yakaladıysa tarayıcının kurulum penceresi açılır; yoksa küçük pencerede adımlar (iPad ve
 * iPhone: Paylaş → Ana Ekrana Ekle). Uygulama olarak açıldıysa öğe yoktur.
 */
export function useInstallMenuAction(anchorRef: RefObject<HTMLElement | null>): {
  action: MenuAction | null;
  sheet: ReactNode;
} {
  const { kind, device } = useInstallMenu();
  const [open, setOpen] = useState(false);
  if (!kind) return { action: null, sheet: null };
  return {
    action: {
      id: 'library-install',
      menuLabel: 'Uygulamayı yükle',
      Icon: Download,
      run: () => (kind === 'prompt' ? void promptInstall() : setOpen(true)),
    },
    sheet: open && (
      <Sheet
        label="Uygulamayı yükle"
        testId="install-sheet"
        anchorRef={anchorRef}
        onDismiss={() => setOpen(false)}
      >
        <div className="max-h-[70dvh] overflow-y-auto bg-grouped p-3">
          <ListGroup
            title="Uygulamayı yükle"
            footer="Tam ekran açılır, internetsiz çalışır; kitapların tarayıcı temizliğine karşı daha güvende kalır."
          >
            <ol className="flex flex-col py-1 text-[15px]">
              {kind === 'ios' ? (
                <>
                  <Step n={1} Icon={Share}>
                    Safari'de {device === 'iPad' ? 'üstteki' : 'alttaki'} <b>Paylaş</b> düğmesine
                    dokun.
                  </Step>
                  <Step n={2} Icon={SquarePlus}>
                    <b>Ana Ekrana Ekle</b>'yi seç, sonra <b>Ekle</b>'ye dokun.
                  </Step>
                </>
              ) : (
                <Step n={1} Icon={Download}>
                  Tarayıcının menüsünden <b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>'yi
                  seç.
                </Step>
              )}
            </ol>
          </ListGroup>
        </div>
      </Sheet>
    ),
  };
}

function Step({ n, Icon, children }: { n: number; Icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <span className="w-4 shrink-0 text-secondary tabular-nums" aria-hidden="true">
        {n}.
      </span>
      <Icon className="size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
