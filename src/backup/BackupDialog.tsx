import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { iosDevice } from '../app/install';
import { db } from '../db/db';
import { appImportDeps } from '../import/deps';
import { queueConversions } from '../import/importBook';
import { backupFile, canShareFile, downloadFile, refreshSettings, shareFile } from './deliver';
import { estimateBackup, exportBackup } from './exportBackup';
import { BackupError } from './format';
import { applyBackup, inspectBackup, type ApplyResult, type BackupSummary } from './importBackup';
import { markBackedUp, markRestored, useLastBackup } from './reminder';

/** Bu boyu aşan yedekte iPad'de bellek uyarısı gösterilir */
const LARGE_BACKUP_BYTES = 500e6;

type ExportState =
  | { kind: 'idle' }
  | { kind: 'working'; progress: number }
  | {
      kind: 'ready';
      file: File;
      url: string;
      /** paylaşım sayfası açılabilir (iPad, iPhone) */
      share: boolean;
      saved?: 'shared' | 'downloaded';
    }
  | { kind: 'error'; message: string };

type RestoreState =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'summary'; file: File; summary: BackupSummary; applySettings: boolean }
  | { kind: 'applying'; progress: number }
  | { kind: 'done'; result: ApplyResult }
  | { kind: 'error'; message: string };

/**
 * "Yedekle / Geri yükle" penceresi. Yedek al: seçenekler → ilerleme → paylaş ya da kaydet. Yedekten yükle: dosya
 * seç → özet → onay → ilerleme → sonuç. `initialFile`: kütüphaneye sürüklenen yedek (hemen özeti çıkarılır).
 */
export function BackupDialog({
  initialFile,
  onClose,
  onRestored,
}: {
  initialFile?: File;
  onClose(): void;
  /** yedek yüklendi (kalıcı depolama istenir) */
  onRestored?(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [exp, setExp] = useState<ExportState>({ kind: 'idle' });
  const [restore, setRestore] = useState<RestoreState>(
    initialFile ? { kind: 'inspecting' } : { kind: 'idle' },
  );
  const busy = exp.kind === 'working' || restore.kind === 'applying';

  // Kipsiz değil kipli pencere: arkadaki kütüphane odak ve dokunuş almaz, Esc kapatır
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    // Odak başlığa: tarayıcı ilk düğmeye (Kapat) odaklanıp etrafına odak çerçevesi çizmesin
    dialog?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return () => dialog?.close();
  }, []);

  const read = (file: File) =>
    inspectBackup(db, file).then(
      (summary) => setRestore({ kind: 'summary', file, summary, applySettings: false }),
      (e: unknown) => setRestore({ kind: 'error', message: describeError(e) }),
    );
  const inspect = (file: File) => {
    setRestore({ kind: 'inspecting' });
    void read(file);
  };

  // Sürüklenen yedek: pencere "okunuyor" durumunda açılır (StrictMode'da bir kez okunur)
  const started = useRef(false);
  useEffect(() => {
    if (!initialFile || started.current) return;
    started.current = true;
    void read(initialFile);
  }, [initialFile]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="backup-dialog"
      onCancel={(e) => {
        // Kapanışı React yönetir; yedek alınırken ya da yüklenirken kapanmaz
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40"
    >
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-surface py-1 pr-1 pl-4">
        <h2 id={titleId} tabIndex={-1} className="flex-1 text-sm font-semibold outline-none">
          Yedekle / Geri yükle
        </h2>
        <button
          type="button"
          aria-label="Pencereyi kapat"
          disabled={busy}
          onClick={onClose}
          className="grid size-11 place-items-center rounded-full text-muted hover:bg-paper disabled:opacity-40"
        >
          <X className="size-5" />
        </button>
      </div>
      {restore.kind === 'idle' ? (
        <div className="flex flex-col gap-6 p-4 text-sm">
          <ExportSection state={exp} setState={setExp} />
          <RestorePicker onFile={inspect} />
        </div>
      ) : (
        <RestoreView
          state={restore}
          setState={setRestore}
          onPick={inspect}
          onBack={() => setRestore({ kind: 'idle' })}
          onClose={onClose}
          onRestored={onRestored}
        />
      )}
    </dialog>
  );
}

function ExportSection({
  state,
  setState,
}: {
  state: ExportState;
  setState(s: ExportState | ((s: ExportState) => ExportState)): void;
}) {
  const [includePdfs, setIncludePdfs] = useState(true);
  const [includeContents, setIncludeContents] = useState(true);
  const estimate = useLiveQuery(() => estimateBackup(db), []);
  const lastBackup = useLastBackup();
  const [now] = useState(Date.now);
  const url = state.kind === 'ready' ? state.url : null;

  // Hazır yedeğin adresi pencere kapanınca bırakılır (indirme sürerken bırakılmasın diye daha önce değil)
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const size = estimate
    ? (includePdfs ? estimate.pdfBytes : 0) + (includeContents ? estimate.otherBytes : 0)
    : 0;

  async function start() {
    setState({ kind: 'working', progress: 0 });
    try {
      const out = await exportBackup(db, {
        includePdfs,
        includeContents,
        onProgress: (p) => setState({ kind: 'working', progress: p.total ? p.done / p.total : 0 }),
      });
      const file = backupFile(out.blob, out.fileName);
      setState({
        kind: 'ready',
        file,
        url: URL.createObjectURL(file),
        share: canShareFile(file),
      });
    } catch (e) {
      setState({ kind: 'error', message: describeError(e) });
    }
  }

  const saved = (how: 'shared' | 'downloaded') => {
    markBackedUp();
    setState((s) => (s.kind === 'ready' ? { ...s, saved: how } : s));
  };

  async function share(file: File, url: string) {
    try {
      if ((await shareFile(file)) === 'shared') saved('shared');
    } catch (e) {
      // Paylaşım olmadı (izin, boyut): dosya indirilir
      console.error(e);
      downloadFile(url, file.name);
      saved('downloaded');
    }
  }

  return (
    <section aria-labelledby="backup-export-title" className="flex flex-col gap-3">
      <h3 id="backup-export-title" className="text-xs uppercase tracking-wide text-muted">
        Yedek al
      </h3>
      <p className="text-xs text-muted">
        Kitapların, notların, kalem çizgilerin, yer imlerin ve okuma yerlerin tek bir dosyaya
        yazılır. Dosyayı Dosyalar'a ya da iCloud Drive'a kaydedebilir, AirDrop ile başka cihaza
        gönderebilirsin.
      </p>
      <Option
        label="PDF'leri de ekle"
        detail={
          estimate
            ? `${estimate.pdfs} PDF · ${formatSize(estimate.pdfBytes)}. Eklenmezse yeni cihazda PDF'leri ayrıca eklersin.`
            : '…'
        }
        checked={includePdfs}
        onChange={setIncludePdfs}
        disabled={state.kind === 'working'}
        testId="backup-include-pdfs"
      />
      <Option
        label="Dönüştürülmüş metni ekle"
        detail="Geri yüklemede kitaplar yeniden dönüştürülmez."
        checked={includeContents}
        onChange={setIncludeContents}
        disabled={state.kind === 'working'}
        testId="backup-include-contents"
      />
      {estimate && (
        <p className="text-xs text-muted" data-testid="backup-estimate">
          Tahmini boyut: {formatSize(size)}
          {includePdfs && estimate.pdfBytes > LARGE_BACKUP_BYTES && (
            <span className="block text-danger">
              Büyük yedek: iPad'de bellek yetmeyebilir. Sorun olursa PDF'siz yedek al.
            </span>
          )}
        </p>
      )}

      {state.kind === 'working' ? (
        <Progress label="Yedek hazırlanıyor…" value={state.progress} />
      ) : state.kind === 'ready' ? (
        <div className="flex flex-col gap-2" data-testid="backup-ready">
          <p className="text-sm">
            Yedek hazır · <span className="tabular-nums">{formatSize(state.file.size)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {state.share && (
              <button
                type="button"
                data-testid="backup-share"
                onClick={() => void share(state.file, state.url)}
                className="min-h-11 rounded-full bg-accent px-4 text-sm font-medium text-paper"
              >
                Paylaş ya da kaydet
              </button>
            )}
            {/* Gerçek bağlantı: indirme dokunuşun kendisiyle başlar (programla tıklanan bağlantıyı bazı tarayıcılar engeller) */}
            <a
              href={state.url}
              download={state.file.name}
              data-testid="backup-download"
              onClick={() => saved('downloaded')}
              className={
                state.share
                  ? 'flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink hover:bg-paper'
                  : 'flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-paper'
              }
            >
              {state.share ? 'İndir' : 'Dosyayı kaydet'}
            </a>
          </div>
          <p className="text-xs text-muted" role="status">
            {state.saved === 'shared'
              ? 'Yedek gönderildi.'
              : state.saved === 'downloaded'
                ? `Yedek indirildi: ${state.file.name}`
                : state.file.name}
          </p>
        </div>
      ) : (
        <>
          {state.kind === 'error' && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          )}
          <button
            type="button"
            data-testid="backup-create"
            disabled={!estimate || estimate.books === 0}
            onClick={() => void start()}
            className="min-h-11 self-start rounded-full bg-accent px-4 text-sm font-medium text-paper disabled:opacity-40"
          >
            Yedeği al
          </button>
        </>
      )}
      <p className="text-xs text-muted">
        {estimate?.books === 0
          ? 'Kütüphanende henüz kitap yok.'
          : lastBackup
            ? `Son yedek: ${relativeDay(lastBackup, now)}.`
            : 'Bu cihazda henüz yedek alınmadı.'}{' '}
        Yapay zekâ sesleri yedeğe girmez; yeni cihazda ilk kullanımda yeniden indirilir.
      </p>
    </section>
  );
}

function RestorePicker({ onFile }: { onFile(file: File): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // iOS bilinmeyen uzantıyı (.mypdfbook) seçtirmez (dosya soluk görünür): orada filtre konmaz, içerik denetlenir
  const [accept] = useState(() =>
    iosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)
      ? undefined
      : '.mypdfbook,.zip,application/zip',
  );
  return (
    <section
      aria-labelledby="backup-restore-title"
      className="flex flex-col gap-3 border-t border-line pt-5"
    >
      <h3 id="backup-restore-title" className="text-xs uppercase tracking-wide text-muted">
        Yedekten yükle
      </h3>
      <p className="text-xs text-muted">
        Bu cihazda ya da başka cihazda alınmış yedeği seç. İçindekiler buradakilerle birleştirilir:
        eksik kitaplar eklenir, notlar ikileşmez, okuma yeri en yenisi olur.
      </p>
      <button
        type="button"
        data-testid="backup-restore-pick"
        onClick={() => inputRef.current?.click()}
        className="min-h-11 self-start rounded-full border border-line px-4 text-sm text-ink hover:bg-paper"
      >
        Yedek dosyası seç
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        data-testid="backup-restore-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </section>
  );
}

function RestoreView({
  state,
  setState,
  onPick,
  onBack,
  onClose,
  onRestored,
}: {
  state: Exclude<RestoreState, { kind: 'idle' }>;
  setState(s: RestoreState): void;
  onPick(file: File): void;
  onBack(): void;
  onClose(): void;
  onRestored?(): void;
}) {
  async function apply(file: File, applySettings: boolean) {
    setState({ kind: 'applying', progress: 0 });
    try {
      const result = await applyBackup(db, file, {
        applySettings,
        onProgress: (p) => setState({ kind: 'applying', progress: p.total ? p.done / p.total : 0 }),
      });
      refreshSettings(result.settingsApplied);
      markRestored();
      onRestored?.();
      // PDF'i gelen ama metni olmayan kitaplar dönüştürülür (arka planda, sırayla)
      void queueConversions(appImportDeps, result.bookIds);
      setState({ kind: 'done', result });
    } catch (e) {
      setState({ kind: 'error', message: describeError(e) });
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-sm" data-testid="backup-restore">
      <h3 className="text-xs uppercase tracking-wide text-muted">Yedekten yükle</h3>
      {state.kind === 'inspecting' && <p className="text-muted">Yedek okunuyor…</p>}
      {state.kind === 'error' && (
        <>
          <p role="alert" data-testid="backup-error" className="text-danger">
            {state.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={onBack}>Geri</SecondaryButton>
            <FilePickButton onFile={onPick}>Başka dosya seç</FilePickButton>
          </div>
        </>
      )}
      {state.kind === 'summary' && (
        <>
          <Summary summary={state.summary} />
          <Option
            label="Ayarları da uygula"
            detail={
              state.summary.hasSettings
                ? 'Tema, yazı ve okuma ayarları yedektekiyle değişir. Kapalıysa bu cihazın ayarları korunur.'
                : 'Yedekte ayar yok.'
            }
            checked={state.applySettings}
            disabled={!state.summary.hasSettings}
            onChange={(v) => setState({ ...state, applySettings: v })}
            testId="backup-apply-settings"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={onBack}>Vazgeç</SecondaryButton>
            <button
              type="button"
              data-testid="backup-apply"
              onClick={() => void apply(state.file, state.applySettings)}
              className="min-h-11 rounded-full bg-accent px-4 text-sm font-medium text-paper"
            >
              Yükle
            </button>
          </div>
        </>
      )}
      {state.kind === 'applying' && <Progress label="Yükleniyor…" value={state.progress} />}
      {state.kind === 'done' && (
        <>
          <Result result={state.result} />
          <button
            type="button"
            data-testid="backup-done"
            onClick={onClose}
            className="min-h-11 self-end rounded-full bg-accent px-4 text-sm font-medium text-paper"
          >
            Tamam
          </button>
        </>
      )}
    </div>
  );
}

function Summary({ summary: s }: { summary: BackupSummary }) {
  const date = new Date(s.manifest.createdAt).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const newOf = (total: number, n: number) =>
    total === 0
      ? ''
      : n === 0
        ? ' — hepsi bu cihazda var'
        : n === total
          ? ' — hepsi yeni'
          : ` — ${n} yeni`;
  return (
    <div className="flex flex-col gap-2" data-testid="backup-summary">
      <p className="text-xs text-muted">
        {date}
        {s.manifest.device && ` · ${s.manifest.device}`} · {formatSize(s.fileSize)}
      </p>
      <ul className="flex flex-col gap-1 rounded-lg border border-line bg-paper p-3">
        <li data-testid="summary-books">
          {s.books.total} kitap{newOf(s.books.total, s.books.new)}
        </li>
        <li data-testid="summary-annotations">
          {s.annotations.total} işaret (fosforlu kalem, kalem, not)
          {newOf(s.annotations.total, s.annotations.new)}
        </li>
        <li data-testid="summary-bookmarks">
          {s.bookmarks.total} yer imi{newOf(s.bookmarks.total, s.bookmarks.new)}
        </li>
        <li data-testid="summary-pdfs">
          {s.pdfs.total === 0
            ? "PDF'ler yedekte yok"
            : `${s.pdfs.total} PDF yedekte${s.pdfs.needed ? `, ${s.pdfs.needed} tanesi eklenecek` : ''}`}
        </li>
      </ul>
      {s.awaitingPdf > 0 && (
        <p className="text-xs text-muted" data-testid="summary-awaiting">
          {s.awaitingPdf} kitabın PDF'i ne yedekte ne bu cihazda: “PDF bekleniyor” olarak eklenir.
          Aynı PDF'i sonra eklediğinde kitap açılır; notların ve okuma yerin korunur.
        </p>
      )}
    </div>
  );
}

function Result({ result: r }: { result: ApplyResult }) {
  const parts = [
    r.booksAdded && `${r.booksAdded} kitap eklendi`,
    r.booksUpdated && `${r.booksUpdated} kitap güncellendi`,
    r.pdfsAdded && `${r.pdfsAdded} PDF eklendi`,
    r.annotationsAdded && `${r.annotationsAdded} işaret eklendi`,
    r.annotationsUpdated && `${r.annotationsUpdated} işaret güncellendi`,
    r.bookmarksAdded && `${r.bookmarksAdded} yer imi eklendi`,
    r.progressUpdated && `${r.progressUpdated} okuma yeri güncellendi`,
    r.settingsApplied.length > 0 && 'ayarlar uygulandı',
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2" role="status" data-testid="backup-result">
      <p className="font-book text-base">Yedek yüklendi.</p>
      <p>{parts.length ? `${parts.join(', ')}.` : 'Yeni bir şey yoktu: hepsi zaten bu cihazda.'}</p>
      {r.awaitingPdf > 0 && (
        <p className="text-xs text-muted">
          {r.awaitingPdf} kitap PDF bekliyor: kitabın kartındaki “PDF'i ekle” ile aynı PDF'i seç.
        </p>
      )}
      {r.pdfsRejected > 0 && (
        <p className="text-xs text-danger">
          {r.pdfsRejected} PDF yedekte bozuk olduğu için eklenmedi.
        </p>
      )}
    </div>
  );
}

function Option({
  label,
  detail,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <label
      className={`flex min-h-11 items-start gap-3 rounded-lg border border-line px-3 py-2 ${disabled ? 'opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        <span className="text-xs text-muted">{detail}</span>
      </span>
    </label>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {label} <span className="tabular-nums">%{percent}</span>
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SecondaryButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-full border border-line px-4 text-sm text-ink hover:bg-paper"
    >
      {children}
    </button>
  );
}

function FilePickButton({ onFile, children }: { onFile(file: File): void; children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <SecondaryButton onClick={() => inputRef.current?.click()}>{children}</SecondaryButton>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function describeError(e: unknown): string {
  if (e instanceof BackupError) return e.message;
  console.error(e);
  return 'Beklenmeyen bir hata oluştu. Tekrar dene.';
}

/** 1,2 MB · 350 KB · 1,4 GB */
export function formatSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3)).toLocaleString('tr-TR')} KB`;
  if (bytes < 1e9)
    return `${(bytes / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: bytes < 1e7 ? 1 : 0 })} MB`;
  return `${(bytes / 1e9).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB`;
}

/** bugün · dün · 5 gün önce */
function relativeDay(at: number, now: number): string {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return 'bugün';
  if (days === 1) return 'dün';
  return `${days} gün önce`;
}
