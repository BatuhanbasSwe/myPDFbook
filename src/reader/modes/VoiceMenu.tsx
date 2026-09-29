import { Check, ChevronDown, Headphones, Info, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { iconButton } from './PlayerBar';
import { classifyVoice, voiceGroups, type VoiceInfo } from './readAloud';
import type { ReadAloudUi } from './useReadAloud';

/** Cihaz: gelişmiş sesin indirileceği ayar yolu buna göre gösterilir */
function platform(): 'ios' | 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  // iPadOS masaüstü sitesi ister: kendini Mac diye tanıtır, dokunmatik olmasıyla ayrılır
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return 'ios';
  return /Macintosh/.test(ua) ? 'mac' : 'other';
}

/** Kitabın dilinin Ayarlar'daki adı ve o dilin iyi sesi */
const LANG_SETTING: Record<string, { name: string; voice: string }> = {
  tr: { name: 'Türkçe', voice: 'Yelda (Gelişmiş)' },
  en: { name: 'İngilizce', voice: 'bir (Gelişmiş) ya da (Premium) ses' },
};

/** Gelişmiş sistem sesi yoksa: cihazda nasıl indirileceği */
export function EnhancedVoiceHint({ lang }: { lang: string }) {
  const setting = LANG_SETTING[lang] ?? LANG_SETTING.tr;
  const os = platform();
  return (
    <div
      data-testid="voice-hint"
      className="flex gap-2 rounded-xl bg-paper px-3 py-2 text-xs leading-relaxed text-muted"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        Bu cihazda gelişmiş bir {setting.name} ses yok.{' '}
        {os === 'mac' ? (
          <>
            Daha doğal bir ses için:{' '}
            <strong className="font-semibold text-ink">Sistem Ayarları</strong> → Erişilebilirlik →
            Seslendirilen İçerik → Sistem sesi → Sesleri Yönet → {setting.name} → {setting.voice} →
            indir.
          </>
        ) : os === 'ios' ? (
          <>
            Daha doğal bir ses için: <strong className="font-semibold text-ink">Ayarlar</strong> →
            Erişilebilirlik → Seslendirilen İçerik → Sesler → {setting.name} → {setting.voice} →
            indir. Sonra uygulamayı kapatıp yeniden açın.
          </>
        ) : (
          <>
            Daha doğal bir ses için cihazın ayarlarından gelişmiş bir {setting.name} ses indirin.
            iPad'de: Ayarlar → Erişilebilirlik → Seslendirilen İçerik → Sesler → {setting.name} →{' '}
            {setting.voice} → indir.
          </>
        )}
      </p>
    </div>
  );
}

/** Menüdeki grup başlığı */
function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-xs tracking-wide text-muted uppercase" aria-hidden="true">
      {children}
    </p>
  );
}

/** Sesin kalite etiketi ve ağ gerektirip gerektirmediği */
function voiceNote(v: VoiceInfo): string | null {
  const q = classifyVoice(v);
  const parts = [q === 'premium' ? 'Premium' : q === 'enhanced' ? 'Gelişmiş' : null];
  if (!v.local) parts.push('internet gerekir');
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

/** Menüdeki bir ses: seçiliyse işaretli */
export function VoiceRow({
  selected,
  name,
  note,
  onSelect,
  testId,
  children,
}: {
  selected: boolean;
  name: string;
  note?: ReactNode;
  onSelect(): void;
  testId?: string;
  /** satırın sağındaki ek düğmeler */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-testid={testId}
        onClick={onSelect}
        className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-paper ${
          selected ? 'font-semibold text-accent' : 'text-ink'
        }`}
      >
        <Check className={`size-4 shrink-0 ${selected ? '' : 'invisible'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          {note && <span className="block truncate text-xs font-normal text-muted">{note}</span>}
        </span>
      </button>
      {children}
    </div>
  );
}

/** Çubuktaki ses düğmesi: seçili sesin adı; ses menüsünü açar */
export function VoiceButton({ ra, className }: { ra: ReadAloudUi; className: string }) {
  const current = ra.voices.find((v) => v.id === ra.state?.voice);
  return (
    <button
      type="button"
      data-testid="read-aloud-voice"
      aria-label={`Ses: ${current?.name ?? 'Cihazın sesi'}`}
      aria-haspopup="dialog"
      aria-expanded={ra.voiceMenu}
      onClick={() => ra.setVoiceMenu(!ra.voiceMenu)}
      className={`${className} flex max-w-44 items-center gap-1`}
    >
      <span className="min-w-0 flex-1 truncate">{current?.name ?? 'Cihazın sesi'}</span>
      <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
    </button>
  );
}

/**
 * Ses menüsü: çubuğun üstünde açılır (çubuğun yüksekliğini değiştirmez: kitap yeniden dizilmez). Sesler kaliteye göre
 * gruplanır; gelişmiş ses yoksa indirme yolu gösterilir. "Dinle" seçili sesle örnek cümle okur. Dışarı dokununca ya da
 * Esc ile kapanır.
 */
export function VoiceMenu({ ra, lang }: { ra: ReadAloudUi; lang: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { setVoiceMenu } = ra;

  // Dışarı dokunulunca kapanır (ses düğmesi kendisi açıp kapatır)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t) || t?.closest?.('[data-testid="read-aloud-voice"]')) return;
      setVoiceMenu(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [setVoiceMenu]);

  // Açılınca odak seçili sese (klavye)
  useEffect(() => {
    const el =
      ref.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      ref.current?.querySelector<HTMLElement>('[role="radio"]');
    el?.focus({ preventScroll: true });
  }, []);

  const groups = voiceGroups(ra.voices);
  const selected = ra.state?.voice ?? null;
  const row = (v: VoiceInfo) => (
    <VoiceRow
      key={v.id}
      selected={v.id === selected}
      name={v.name}
      note={voiceNote(v)}
      onSelect={() => ra.setVoice(v.id)}
    />
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Ses seçimi"
      data-testid="voice-menu"
      className="pointer-events-auto absolute inset-x-2 bottom-full mx-auto mb-2 flex max-h-[min(65vh,32rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-lg"
    >
      <div className="flex items-center gap-1 border-b border-line py-1 pr-1 pl-4">
        <p className="flex-1 text-sm font-semibold text-ink">Ses</p>
        <button
          type="button"
          data-testid="voice-preview"
          onClick={ra.preview}
          disabled={!ra.state}
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-ink hover:bg-paper disabled:opacity-40"
        >
          <Headphones className="size-4" aria-hidden="true" />
          Dinle
        </button>
        <button
          type="button"
          aria-label="Ses menüsünü kapat"
          onClick={() => ra.setVoiceMenu(false)}
          className={`${iconButton} text-muted`}
        >
          <X className="size-5" />
        </button>
      </div>
      <div role="radiogroup" aria-label="Ses" className="overflow-y-auto overscroll-contain pb-2">
        {ra.voices.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            Bu dilde ses bulunamadı: cihazın varsayılan sesi kullanılır.
          </p>
        )}
        {groups.enhanced.length > 0 && (
          <section data-testid="voice-group-enhanced" aria-label="Gelişmiş sesler">
            <GroupTitle>Gelişmiş</GroupTitle>
            {groups.enhanced.map(row)}
          </section>
        )}
        {groups.standard.length > 0 && (
          <section data-testid="voice-group-standard" aria-label="Standart sesler">
            <GroupTitle>Standart</GroupTitle>
            {groups.standard.map(row)}
          </section>
        )}
        {!ra.hasEnhanced && (
          <div className="px-2 pt-2">
            <EnhancedVoiceHint lang={lang} />
          </div>
        )}
      </div>
    </div>
  );
}
