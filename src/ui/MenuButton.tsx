import { Check, type LucideIcon } from 'lucide-react';
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { IconButton } from './IconButton';

/** Menünün bir öğesi (üst çubuğun eylemi) */
export interface MenuAction {
  /** başlıktaki düğmenin data-testid'si; menü öğesininki `more-${id}` */
  id: string;
  /** menü öğesinin yazısı (erişilebilir adı) */
  menuLabel: string;
  Icon: LucideIcon;
  /** açılıp kapanan eylem: menüde işaretli öğe (menuitemcheckbox) */
  pressed?: boolean;
  /** klavye kısayolu: klavyeli cihazda öğenin sağında */
  shortcut?: string;
  /** öğeden önce ayırıcı çizgi (öbekler) */
  divider?: boolean;
  /** geri alınamayan eylem (sil): kırmızı */
  destructive?: boolean;
  run(): void;
}

export const MENU_ITEM = '[role^="menuitem"]';

/**
 * Açılır menü (okuyucuda ⋯ "Diğer" ve "Okuma modları", kütüphanede ⋯ ve kitabın seçenekleri): düğme ve altında
 * açılan liste; sağa hizalı, ekranın solundan taşacaksa sola hizalı. Açılınca odak ilk öğede;
 * oklar öğeler arasında dolaşır (Home/End: ilk/son), Esc kapatıp odağı düğmeye verir, Tab menüden çıkar. Oklar ve
 * Esc sayfa çevirmeye ve üst çubuğa gitmez. Dışarıya dokununca kapanır (`keepOpen` doğruysa o dokunuş hariç: kitaba
 * dokunma kitabın kendi yoluyla kapatır).
 *
 * Düğmenin `data-actions`'ı menüdeki eylemlerin kimlikleridir (testler eylemin hangi menüde olduğunu buradan bulur).
 */
export function MenuButton({
  label,
  testId,
  menuTestId,
  Icon,
  actions,
  open,
  onOpenChange,
  active,
  dataActive,
  keepOpen,
  buttonRef,
  tipSide,
}: {
  label: string;
  testId: string;
  menuTestId: string;
  Icon: LucideIcon;
  actions: MenuAction[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** düğme vurgulu (menüdeki bir kip açık) */
  active?: boolean;
  /** düğmenin data-active'i: açık olan eylemin kimliği */
  dataActive?: string;
  /** dışarıdaki bu dokunuş menüyü kapatmaz */
  keepOpen?(target: Element): boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** düğmenin ipucunun yanı */
  tipSide?: 'below' | 'above';
}) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [open]);
  // Sağa hizalı menü ekranın solundan taşarsa sola hizalanır (kütüphanede soldaki kitabın menüsü)
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return;
    if (el.getBoundingClientRect().left < 8) {
      el.style.right = 'auto';
      el.style.left = '0';
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && boxRef.current?.contains(target)) return;
      if (target && keepOpen?.(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, keepOpen, onOpenChange]);

  // Öğe seçilince menü kapanır, odak düğmeye döner (açılan panel ya da pencere odağı sonra kendine alır)
  const select = (a: MenuAction) => {
    onOpenChange(false);
    buttonRef.current?.focus();
    a.run();
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') to = at <= 0 ? items.length - 1 : at - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      onOpenChange(false);
      buttonRef.current?.focus();
      // Tab düğmeden sonraki denetime geçer (Shift+Tab düğmede kalır)
      if (e.key === 'Tab' && !e.shiftKey) return;
    } else if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    if (to !== null) items[to]?.focus();
  };

  return (
    <div ref={boxRef} className="relative">
      <IconButton
        ref={buttonRef}
        testId={testId}
        label={label}
        Icon={Icon}
        data-actions={actions.map((a) => a.id).join(' ')}
        data-active={dataActive}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        active={open || active}
        noTip={open}
        tipSide={tipSide}
        onClick={() => onOpenChange(!open)}
      />
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          data-testid={menuTestId}
          onKeyDown={onMenuKey}
          className="material ui-pop absolute top-full right-0 z-(--ui-z-menu) mt-2 min-w-60 overflow-hidden rounded-panel py-1.5"
        >
          {actions.map((a) => (
            <Fragment key={a.id}>
              {a.divider && <div role="separator" className="mx-4 my-1.5 h-px bg-hairline" />}
              <button
                type="button"
                role={a.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={a.pressed}
                aria-keyshortcuts={a.shortcut}
                data-shortcut={a.shortcut}
                tabIndex={-1}
                data-testid={`more-${a.id}`}
                onClick={() => select(a)}
                className={`ui-shortcut mx-1.5 flex min-h-[46px] w-[calc(100%-0.75rem)] items-center gap-3 rounded-inner px-3 text-left text-[15px] hover:bg-fill focus-visible:bg-fill focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid ${a.destructive ? 'text-danger' : a.pressed ? 'text-accent' : 'text-ink'}`}
              >
                <a.Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1">{a.menuLabel}</span>
                {a.pressed && <Check className="size-4 shrink-0" strokeWidth={2.25} />}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
