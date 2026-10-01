import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { appImportDeps } from '../import/deps';
import { queueConversions } from '../import/importBook';
import {
  attachDownloadUrl,
  backupFile,
  canShareFile,
  currentBackupDevice,
  defaultIncludePdfs,
  largePdfBytes,
  refreshSettings,
  releaseDownloadUrls,
  shareFile,
  type BackupDevice,
} from './deliver';
import { estimateBackup, estimatedSize, exportBackup } from './exportBackup';
import { BackupError } from './format';
import {
  applyBackup,
  inspectBackup,
  PartialRestoreError,
  type ApplyResult,
  type BackupSummary,
} from './importBackup';
import { IconButton } from '../ui/IconButton';
import { Switch } from '../ui/List';
import { markBackedUp, markRestored, useLastBackup } from './reminder';

type ExportState =
  | { kind: 'idle'; note?: string }
  | { kind: 'working'; progress: number; controller: AbortController }
  | {
      kind: 'ready';
      file: File;
      /** paylaşım sayfası açılabilir (iPad, iPhone) */
      share: boolean;
      /** paylaşım vazgeçme dışı bir hatayla olmadı: "İndir" gösterilir */
      shareFailed?: boolean;
      /** "İndir"e dokunuldu (ana ekrandaki iOS uygulamasında: kaydedildiği onaylandı) */
      downloaded?: boolean;
      /** paylaşım sayfası açık (ikinci dokunuş yok sayılır) */
      sharing?: boolean;
      /** ana ekrandaki iOS uygulaması: "İndir"den sonra "Kaydedildi mi?" soruluyor */
      confirm?: boolean;
      /** "Kaydedildi mi?" → Hayır */
      notSaved?: boolean;
    }
  /** paylaşıldı: dosya bırakıldı (bellekte tutulmaz) */
  | { kind: 'shared' }
  | { kind: 'error'; message: string };

type SummaryState = {
  kind: 'summary';
  file: File;
  summary: BackupSummary;
  applySettings: boolean;
  /** önceki yükleme kayıtlar yazılmadan durduruldu */
  note?: string;
};

type RestoreState =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | SummaryState
  | { kind: 'applying'; progress: number; controller: AbortController; from: SummaryState }
  /** `error`: yükleme yarıda kaldı (yer kalmadı, dosya okunamadı ya da vazgeçildi); yazılanlar `result`'ta */
  | { kind: 'done'; result: ApplyResult; error?: string }
  | { kind: 'error'; message: string };

/**
 * "Yedekle / Geri yükle" penceresi. Yedek al: seçenekler → ilerleme (vazgeçilebilir) → paylaş ya da kaydet. Yedekten
 * yükle: dosya seç → özet → onay → ilerleme (vazgeçilebilir) → sonuç. `initialFile`: kütüphaneye sürüklenen yedek
 * (hemen özeti çıkarılır).
 */
export function BackupDialog({
  initialFile,
  onClose,
  onRestored,
}: {
  initialFile?: File;
  onClose(): void;
  /** yedek yüklendi (yarıda kalsa da; kalıcı depolama istenir) */
  onRestored?(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [exp, setExp] = useState<ExportState>({ kind: 'idle' });
  const [restore, setRestore] = useState<RestoreState>(
    initialFile ? { kind: 'inspecting' } : { kind: 'idle' },
  );
  const exporting = exp.kind === 'working';
  const busy = exporting || restore.kind === 'applying';

  // Pencere kapanınca süren iş durur; verilmiş indirme adresleri kısa bir payla bırakılır
  const expController = exp.kind === 'working' ? exp.controller : null;
  const restoreController = restore.kind === 'applying' ? restore.controller : null;
  useEffect(() => () => expController?.abort(), [expController]);
  useEffect(() => () => restoreController?.abort(), [restoreController]);
  useEffect(() => () => releaseDownloadUrls(), []);

  // Kipsiz değil kipli pencere: arkadaki kütüphane odak ve dokunuş almaz, Esc kapatır
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      // <dialog> pencere olarak açılamıyorsa (çok eski tarayıcı) yine görünsün
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    // Odak başlığa: tarayıcı ilk düğmeye (Kapat) odaklanıp etrafına odak çerçevesi çizmesin
    dialog?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return () => dialog?.close?.();
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
      // Pencereye sürüklenen yedek burada açılır (kütüphanenin bırakma alanına geçmez); bir iş sürerken alınmaz
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = busy || restore.kind !== 'idle' ? 'none' : 'copy';
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file && !busy && restore.kind === 'idle') inspect(file);
      }}
      onCancel={(e) => {
        // Kapanışı React yönetir; yedek alınırken ya da yüklenirken kapanmaz (önce "Vazgeç")
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="ui-pop m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-sheet bg-grouped p-0 text-ink shadow-float backdrop:bg-black/40"
    >
      <div className="material-bar sticky top-0 z-10 flex items-center gap-1 py-1 pr-1 pl-5 shadow-[0_0.5px_0_var(--ui-hairline)]">
        <h2 id={titleId} tabIndex={-1} className="flex-1 text-[17px] font-semibold outline-none">
          Yedekle / Geri yükle
        </h2>
        <IconButton
          label="Pencereyi kapat"
          shortcut="Esc"
          Icon={X}
          variant="muted"
          disabled={busy}
          onClick={onClose}
        />
      </div>
      {restore.kind === 'idle' ? (
        <div className="flex flex-col gap-7 p-4 text-[15px] sm:p-5">
          <ExportSection state={exp} setState={setExp} />
          <RestorePicker onFile={inspect} disabled={exporting} />
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
  const [device] = useState<BackupDevice>(currentBackupDevice);
  // null: kullanıcı seçmedi, varsayılan geçerli (iPad/iPhone'da PDF'ler büyükse kapalı; tahmin gelince bilinir)
  const [pdfChoice, setPdfChoice] = useState<boolean | null>(null);
  const [includeContents, setIncludeContents] = useState(true);
  const [includePasswords, setIncludePasswords] = useState(true);
  const estimate = useLiveQuery(() => estimateBackup(db), []);
  const lastBackup = useLastBackup();
  const [now] = useState(Date.now);

  const ios = device.ios !== null;
  const includePdfs = pdfChoice ?? (estimate ? defaultIncludePdfs(estimate.pdfBytes, ios) : true);
  const largePdfs = !!estimate && estimate.pdfBytes > largePdfBytes(ios);
  const working = state.kind === 'working';
  const size = estimate ? estimatedSize(estimate, { includePdfs, includeContents }) : 0;
  // Ana ekrandan açılmış iOS uygulamasında Blob bağlantısı güvenilmez: paylaşım sayfası asıl yol
  const iosApp = ios && device.standalone;

  async function start() {
    const controller = new AbortController();
    setState({ kind: 'working', progress: 0, controller });
    try {
      const out = await exportBackup(db, {
        includePdfs,
        includeContents,
        includePasswords: estimate?.hasPasswords ? includePasswords : undefined,
        signal: controller.signal,
        onProgress: (p) =>
          setState((s) =>
            s.kind === 'working' && s.controller === controller
              ? { ...s, progress: p.total ? p.done / p.total : 0 }
              : s,
          ),
      });
      const file = backupFile(out.blob, out.fileName);
      setState({ kind: 'ready', file, share: canShareFile(file) });
    } catch (e) {
      if (e instanceof BackupError && e.code === 'cancelled')
        setState({ kind: 'idle', note: 'Vazgeçildi: yedek alınmadı.' });
      else setState({ kind: 'error', message: describeError(e) });
    }
  }

  async function share(file: File) {
    const update = (changes: Partial<Extract<ExportState, { kind: 'ready' }>>) =>
      setState((s) => (s.kind === 'ready' && s.file === file ? { ...s, ...changes } : s));
    update({ sharing: true });
    try {
      if ((await shareFile(file)) !== 'shared') return update({ sharing: false });
      markBackedUp();
      // Dosya bırakılır: büyük yedek bellekte durmasın
      setState({ kind: 'shared' });
    } catch (e) {
      // İzin yok, dosya çok büyük…: indirme kullanıcının dokunuşuyla olur (await'ten sonra programla indirilmez)
      console.error(e);
      update({ sharing: false, shareFailed: true });
    }
  }

  return (
    <section aria-labelledby="backup-export-title" className="flex flex-col gap-3">
      <h3 id="backup-export-title" className="px-1 text-[13px] font-medium text-secondary">
        Yedek al
      </h3>
      <p className="text-[13px] text-secondary">
        Kitapların, notların, kalem çizgilerin, yer imlerin ve okuma yerlerin tek bir dosyaya
        yazılır. Dosyayı Dosyalar'a ya da iCloud Drive'a kaydedebilir, AirDrop ile başka cihaza
        gönderebilirsin.
      </p>
      <div className="ui-group flex flex-col overflow-hidden rounded-control bg-group">
        <Option
          label="PDF'leri de ekle"
          detail={
            estimate
              ? `${estimate.pdfs} PDF · ${formatSize(estimate.pdfBytes)}. Eklenmezse yeni cihazda PDF'leri ayrıca eklersin.`
              : '…'
          }
          checked={includePdfs}
          onChange={setPdfChoice}
          disabled={working || !estimate}
          testId="backup-include-pdfs"
        />
        <Option
          label="Dönüştürülmüş metni ekle"
          detail="Geri yüklemede kitaplar yeniden dönüştürülmez."
          checked={includeContents}
          onChange={setIncludeContents}
          disabled={working}
          testId="backup-include-contents"
        />
        {estimate?.hasPasswords && (
          <Option
            label="Şifreleri de ekle"
            detail={
              includePasswords
                ? "Şifreli PDF'lerin şifreleri yedek dosyasında açık olarak durur; dosyayı yalnızca güvendiğin yere kaydet."
                : 'Eklenmezse yeni cihazda şifreli kitap açılırken şifresi sorulur.'
            }
            warn={includePasswords}
            checked={includePasswords}
            onChange={setIncludePasswords}
            disabled={working}
            testId="backup-include-passwords"
          />
        )}
      </div>
      {estimate && (
        <p className="px-1 text-[13px] text-secondary tabular-nums" data-testid="backup-estimate">
          Tahmini boyut: {formatSize(size)}
        </p>
      )}
      {/* Kullanıcı PDF'leri kendisi çıkardıysa açıklama gerekmez */}
      {estimate && largePdfs && (includePdfs || pdfChoice === null) && (
        <LargePdfWarning
          device={device.ios}
          pdfBytes={estimate.pdfBytes}
          included={includePdfs}
          disabled={working}
          onExclude={() => setPdfChoice(false)}
        />
      )}

      {state.kind === 'working' ? (
        <div className="flex flex-col gap-3">
          <Progress label="Yedek hazırlanıyor…" value={state.progress} />
          <CancelButton controller={state.controller} testId="backup-cancel" />
        </div>
      ) : state.kind === 'ready' ? (
        <ReadyFile
          state={state}
          iosApp={iosApp}
          onShare={() => void share(state.file)}
          onSaved={(saved) => {
            setState((s) =>
              s.kind === 'ready'
                ? { ...s, confirm: false, notSaved: !saved, downloaded: saved || s.downloaded }
                : s,
            );
            if (saved) markBackedUp();
          }}
          onDownload={() => {
            // Ana ekrandaki iOS uygulamasında bağlantı bir şey yapmamış olabilir: kullanıcıya sorulur
            if (iosApp) {
              setState((s) => (s.kind === 'ready' ? { ...s, confirm: true, notSaved: false } : s));
              return;
            }
            markBackedUp();
            setState((s) => (s.kind === 'ready' ? { ...s, downloaded: true } : s));
          }}
        />
      ) : (
        <>
          {state.kind === 'shared' && (
            <p role="status" className="text-[15px]">
              Yedek gönderildi.
            </p>
          )}
          {state.kind === 'idle' && state.note && (
            <p role="status" className="text-[15px] text-secondary">
              {state.note}
            </p>
          )}
          {state.kind === 'error' && (
            <p role="alert" className="text-[15px] text-danger">
              {state.message}
            </p>
          )}
          <PrimaryButton
            testId="backup-create"
            disabled={!estimate || estimate.books === 0}
            onClick={() => void start()}
            className="self-start"
          >
            {state.kind === 'shared' ? 'Yeni yedek al' : 'Yedeği al'}
          </PrimaryButton>
        </>
      )}
      <p className="px-1 text-[13px] text-secondary">
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

/**
 * PDF'ler büyük: iPad/iPhone yedeği bellekte üretir, bellek yetmeyebilir. Varsayılan olarak kapalıysa nedeni
 * yazılır; açıksa uyarı ve tek dokunuşla PDF'siz yedek.
 */
function LargePdfWarning({
  device,
  pdfBytes,
  included,
  disabled,
  onExclude,
}: {
  device: 'iPad' | 'iPhone' | null;
  pdfBytes: number;
  included: boolean;
  disabled: boolean;
  onExclude(): void;
}) {
  const who = device ?? 'Bu cihaz';
  if (!included) {
    return (
      <p className="px-1 text-[13px] text-secondary" data-testid="backup-large-warning">
        PDF'ler büyük ({formatSize(pdfBytes)}): {who} bu boyda bir yedek dosyasını bellekte
        oluşturamayabilir. Bu yüzden PDF'siz yedek öneriliyor; PDF'leri yeni cihaza ayrıca eklersin.
      </p>
    );
  }
  return (
    <div
      className="flex flex-col items-start gap-1 rounded-control bg-group px-4 pt-3 pb-1"
      data-testid="backup-large-warning"
    >
      <p className="text-[13px] text-danger">
        Büyük yedek: PDF'ler {formatSize(pdfBytes)}. {who} yedek dosyasını bellekte
        oluşturamayabilir; sorun olursa PDF'siz yedek al.
      </p>
      <button
        type="button"
        data-testid="backup-exclude-pdfs"
        disabled={disabled}
        onClick={onExclude}
        className="ui-press -mx-1 min-h-11 px-1 text-[15px] font-medium text-accent disabled:opacity-40"
      >
        PDF'siz yedek al
      </button>
    </div>
  );
}

/** Hazır yedek: paylaş ya da indir */
function ReadyFile({
  state,
  iosApp,
  onShare,
  onDownload,
  onSaved,
}: {
  state: Extract<ExportState, { kind: 'ready' }>;
  iosApp: boolean;
  onShare(): void;
  onDownload(): void;
  /** "Kaydedildi mi?" sorusunun cevabı */
  onSaved(saved: boolean): void;
}) {
  const { file, share, shareFailed, downloaded, sharing, confirm, notSaved } = state;
  // Ana ekrandaki iOS uygulamasında indirme ancak paylaşım olmazsa sunulur
  const showDownload = !iosApp || !share || shareFailed;
  const primaryDownload = !share || shareFailed;
  return (
    <div className="flex flex-col gap-2" data-testid="backup-ready">
      <p className="text-[15px]">
        Yedek hazır · <span className="tabular-nums">{formatSize(file.size)}</span>
      </p>
      {iosApp && share && !shareFailed && (
        <p className="text-[13px] text-secondary" data-testid="backup-ios-app-hint">
          Paylaşım sayfasında “Dosyalar'a Kaydet”i seç ya da AirDrop ile gönder.
        </p>
      )}
      {shareFailed && !downloaded && (
        <p role="alert" className="text-[13px] text-danger" data-testid="backup-share-failed">
          Paylaşılamadı. Aşağıdaki “İndir” ile kaydet.
          {iosApp && ' İndirme açılmazsa uygulamayı Safari’de açıp yedeği oradan al.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {share && (
          <button
            type="button"
            data-testid="backup-share"
            disabled={sharing}
            onClick={onShare}
            className={primaryDownload ? SECONDARY_BUTTON : PRIMARY_BUTTON}
          >
            Paylaş ya da kaydet
          </button>
        )}
        {showDownload && (
          // Gerçek bağlantı: indirme dokunuşun kendisiyle başlar. Dosyanın adresi dokunulunca verilir (bkz.
          // attachDownloadUrl). Ana ekrandaki iOS uygulamasında yeni sayfada açılır: uygulamanın kendi sayfası değişmez.
          <a
            href="#"
            download={file.name}
            target={iosApp ? '_blank' : undefined}
            rel={iosApp ? 'noopener' : undefined}
            data-testid="backup-download"
            onClick={(e) => {
              attachDownloadUrl(e.currentTarget, file);
              onDownload();
            }}
            className={`flex items-center ${primaryDownload ? PRIMARY_BUTTON : SECONDARY_BUTTON}`}
          >
            {share ? 'İndir' : 'Dosyayı kaydet'}
          </a>
        )}
      </div>
      {confirm && (
        <div
          role="group"
          aria-labelledby="backup-saved-question"
          data-testid="backup-saved-confirm"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-group py-1 pr-2 pl-4"
        >
          <p id="backup-saved-question" className="flex-1 text-[15px]">
            Yedek kaydedildi mi?
          </p>
          <button
            type="button"
            data-testid="backup-saved-no"
            onClick={() => onSaved(false)}
            className="ui-press min-h-11 rounded-full px-4 text-[15px] text-ink hover:bg-fill"
          >
            Hayır
          </button>
          <button
            type="button"
            data-testid="backup-saved-yes"
            onClick={() => onSaved(true)}
            className="ui-press min-h-11 rounded-full px-4 text-[15px] font-semibold text-accent hover:bg-fill"
          >
            Evet
          </button>
        </div>
      )}
      {notSaved && (
        <p className="text-[13px] text-secondary" data-testid="backup-not-saved">
          {share
            ? 'Kaydedilmediyse “Paylaş ya da kaydet”i dene; o da olmazsa uygulamayı Safari’de açıp yedeği oradan al.'
            : 'Kaydedilmediyse uygulamayı Safari’de açıp yedeği oradan al.'}
        </p>
      )}
      <p className="text-[13px] text-secondary" role="status">
        {downloaded
          ? iosApp
            ? `Yedek kaydedildi: ${file.name}`
            : `Yedek indirildi: ${file.name}`
          : file.name}
      </p>
    </div>
  );
}

function RestorePicker({ onFile, disabled }: { onFile(file: File): void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // iOS bilinmeyen uzantıyı (.mypdfbook) seçtirmez (dosya soluk görünür): orada filtre konmaz, içerik denetlenir
  const [accept] = useState(() =>
    currentBackupDevice().ios ? undefined : '.mypdfbook,.zip,application/zip',
  );
  return (
    <section aria-labelledby="backup-restore-title" className="flex flex-col gap-3">
      <h3 id="backup-restore-title" className="px-1 text-[13px] font-medium text-secondary">
        Yedekten yükle
      </h3>
      <p className="text-[13px] text-secondary">
        Bu cihazda ya da başka cihazda alınmış yedeği seç. İçindekiler buradakilerle birleştirilir:
        eksik kitaplar eklenir, notlar ikileşmez, okuma yeri en yenisi olur.
      </p>
      <p className="text-[13px] text-secondary" data-testid="backup-restore-deleted-note">
        Bu cihazda sildiğin notlar ve yer imleri, eski bir yedeği yükleyince geri gelebilir.
      </p>
      <SecondaryButton
        testId="backup-restore-pick"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="self-start"
      >
        Yedek dosyası seç
      </SecondaryButton>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        data-testid="backup-restore-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && !disabled) onFile(file);
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
  setState(s: RestoreState | ((s: RestoreState) => RestoreState)): void;
  onPick(file: File): void;
  onBack(): void;
  onClose(): void;
  onRestored?(): void;
}) {
  /** Yazılanların ardından: ayarlar uygulanır, kalıcı depolama istenir, metni olmayan kitaplar dönüştürülür */
  function written(result: ApplyResult) {
    refreshSettings(result.settingsApplied);
    markRestored();
    onRestored?.();
    // PDF'i gelen ama metni olmayan kitaplar dönüştürülür (arka planda, sırayla)
    void queueConversions(appImportDeps, result.bookIds);
  }

  async function apply(from: SummaryState) {
    const controller = new AbortController();
    setState({ kind: 'applying', progress: 0, controller, from });
    try {
      const result = await applyBackup(db, from.file, {
        applySettings: from.applySettings,
        signal: controller.signal,
        onProgress: (p) =>
          setState((s) =>
            s.kind === 'applying' && s.controller === controller
              ? { ...s, progress: p.total ? p.done / p.total : 0 }
              : s,
          ),
      });
      written(result);
      setState({ kind: 'done', result });
    } catch (e) {
      if (e instanceof PartialRestoreError) {
        // Yarıda kaldı: yazılanlar tutarlı; özeti ve nedeni gösterilir
        written(e.result);
        setState({ kind: 'done', result: e.result, error: e.message });
      } else if (e instanceof BackupError && e.code === 'cancelled') {
        setState({ ...from, note: e.message });
      } else {
        setState({ kind: 'error', message: describeError(e) });
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-[15px] sm:p-5" data-testid="backup-restore">
      <h3 className="px-1 text-[13px] font-medium text-secondary">Yedekten yükle</h3>
      {state.kind === 'inspecting' && <p className="text-secondary">Yedek okunuyor…</p>}
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
          <div className="ui-group flex flex-col overflow-hidden rounded-control bg-group">
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
          </div>
          {state.note && (
            <p role="status" className="text-[13px] text-secondary">
              {state.note}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={onBack}>Vazgeç</SecondaryButton>
            <PrimaryButton testId="backup-apply" onClick={() => void apply(state)}>
              Yükle
            </PrimaryButton>
          </div>
        </>
      )}
      {state.kind === 'applying' && (
        <div className="flex flex-col gap-3">
          <Progress label="Yükleniyor…" value={state.progress} />
          <p className="text-[13px] text-secondary">
            Vazgeçersen o ana kadar yüklenenler kalır; aynı yedeği yeniden yükleyerek
            tamamlayabilirsin.
          </p>
          <CancelButton controller={state.controller} testId="backup-apply-cancel" />
        </div>
      )}
      {state.kind === 'done' && (
        <>
          <Result result={state.result} error={state.error} />
          <PrimaryButton testId="backup-done" onClick={onClose} className="self-end">
            Tamam
          </PrimaryButton>
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
      <p className="px-1 text-[13px] text-secondary">
        {date}
        {s.manifest.device && ` · ${s.manifest.device}`} · {formatSize(s.fileSize)}
      </p>
      <ul className="ui-group flex flex-col overflow-hidden rounded-control bg-group [&>li]:px-4 [&>li]:py-2.5">
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
        <p className="px-1 text-[13px] text-secondary" data-testid="summary-awaiting">
          {s.awaitingPdf} kitabın PDF'i ne yedekte ne bu cihazda: “PDF bekleniyor” olarak eklenir.
          Aynı PDF'i sonra eklediğinde kitap açılır; notların ve okuma yerin korunur.
        </p>
      )}
    </div>
  );
}

/** Yüklemenin sonucu. `error`: yükleme yarıda kaldı (nedeni ve o ana kadar yazılanlar) */
function Result({ result: r, error }: { result: ApplyResult; error?: string }) {
  const parts = [
    r.booksAdded && `${r.booksAdded} kitap eklendi`,
    r.booksUpdated && `${r.booksUpdated} kitap güncellendi`,
    r.pdfsAdded && `${r.pdfsAdded} PDF eklendi`,
    r.contentsAdded && `${r.contentsAdded} kitabın metni eklendi`,
    r.annotationsAdded && `${r.annotationsAdded} işaret eklendi`,
    r.annotationsUpdated && `${r.annotationsUpdated} işaret güncellendi`,
    r.bookmarksAdded && `${r.bookmarksAdded} yer imi eklendi`,
    r.progressUpdated && `${r.progressUpdated} okuma yeri güncellendi`,
    r.settingsApplied.length > 0 && 'ayarlar uygulandı',
  ].filter(Boolean);
  const notes: [string, number, string][] = [
    [
      'result-pdfs-rejected',
      r.pdfsRejected,
      `${r.pdfsRejected} PDF yedekte bozuk olduğu için eklenmedi; kitabın kartındaki “PDF'i ekle” ile aynı PDF'i seçebilirsin.`,
    ],
    [
      'result-contents-rejected',
      r.contentsRejected,
      `${r.contentsRejected} kitabın metni yedekte bozuktu; PDF'ten yeniden hazırlanacak.`,
    ],
    [
      'result-contents-skipped',
      r.contentsSkipped,
      `${r.contentsSkipped} kitabın metni bu sürümde açılamadı; PDF'ten yeniden hazırlanacak.`,
    ],
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="backup-result">
      <p className="text-[17px] font-semibold" role="status">
        {error ? 'Yedeğin bir kısmı yüklendi.' : 'Yedek yüklendi.'}
      </p>
      {error && (
        <p role="alert" className="text-danger" data-testid="backup-result-error">
          {error}
        </p>
      )}
      <p>
        {parts.length
          ? `${parts.join(', ')}.`
          : error
            ? 'Henüz yeni bir şey eklenmedi.'
            : 'Yeni bir şey yoktu: hepsi zaten bu cihazda.'}
      </p>
      {r.awaitingPdf > 0 && (
        <p className="text-[13px] text-secondary">
          {r.awaitingPdf} kitap PDF bekliyor: kitabın kartındaki “PDF'i ekle” ile aynı PDF'i seç.
        </p>
      )}
      {notes.map(
        ([testId, count, text]) =>
          count > 0 && (
            <p key={testId} className="text-[13px] text-secondary" data-testid={testId}>
              {text}
            </p>
          ),
      )}
    </div>
  );
}

/** Açma/kapama satırı (grubun içinde): adı ve altında açıklaması; açıklama anahtara bağlıdır (aria-describedby) */
function Option({
  label,
  detail,
  checked,
  onChange,
  disabled,
  warn,
  testId,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  /** açıklama uyarıdır (vurgulu) */
  warn?: boolean;
  testId: string;
}) {
  const detailId = useId();
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5 ${disabled ? 'opacity-60' : ''}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px]">{label}</span>
        <span
          id={detailId}
          data-testid={`${testId}-detail`}
          className={`text-[13px] leading-snug ${warn ? 'text-danger' : 'text-secondary'}`}
        >
          {detail}
        </span>
      </span>
      {/* Ad yalnızca etiket: açıklama adın parçası değil, ardından okunur */}
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        testId={testId}
        label={label}
        describedBy={detailId}
      />
    </label>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[15px]">
        {label} <span className="tabular-nums">%{percent}</span>
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-fill-strong"
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

/** Süren işi durdurur: iş bir sonraki girdide durur (o ana dek "Durduruluyor…") */
function CancelButton({ controller, testId }: { controller: AbortController; testId: string }) {
  const [stopping, setStopping] = useState(false);
  return (
    <SecondaryButton
      testId={testId}
      disabled={stopping}
      onClick={() => {
        setStopping(true);
        controller.abort();
      }}
      className="self-start"
    >
      {stopping ? 'Durduruluyor…' : 'Vazgeç'}
    </SecondaryButton>
  );
}

const PRIMARY_BUTTON =
  'ui-press min-h-11 rounded-full bg-accent px-5 text-[15px] font-semibold text-paper hover:opacity-90 disabled:opacity-40';
const SECONDARY_BUTTON =
  'ui-press min-h-11 rounded-full bg-fill px-5 text-[15px] text-ink hover:bg-fill-strong disabled:opacity-40';

function PrimaryButton({
  onClick,
  children,
  testId,
  disabled,
  className = '',
}: {
  onClick(): void;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`${PRIMARY_BUTTON} ${className}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  children,
  testId,
  disabled,
  className = '',
}: {
  onClick(): void;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`${SECONDARY_BUTTON} ${className}`}
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
