import { CircleCheck, FileQuestionMark, Lock, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { iosDevice } from '../../app/install';
import { IconButton } from '../../ui/IconButton';
import { ListGroup } from '../../ui/List';
import { Modal } from '../../ui/Modal';
import { useWide } from '../../ui/useMediaQuery';
import {
  addVoiceFiles,
  cleanVoiceName,
  CustomVoiceError,
  MAX_NAME_LENGTH,
  prepareVoice,
  type PreparedVoice,
  type VoiceSelection,
} from './piper/customVoice';
import { piperManager, type ImportPhase } from './piper/manager';
import { formatMb } from './piper/voices';
import type { NeuralVoiceUi, ReadAloudUi } from './useReadAloud';

/**
 * Kendi sesinin penceresi (plan 12): telefonda alttan açılır, geniş ekranda ortada. Ekleme: dosyaları seç (.onnx ve
 * .onnx.json ya da ikisini içeren .zip) → ad → "Ekle" (ses motoru gerekirse iner, dosyalar kaydedilir, ses denenir).
 * Düzenleme: ad değiştir, sesi kaldır (onaylı). İkisinde de gizlilik notu: ses yalnızca bu cihazda durur.
 */
export function CustomVoiceSheet({ ra }: { ra: ReadAloudUi }) {
  const sheet = ra.voiceSheet;
  if (!sheet) return null;
  if (sheet.kind === 'add') return <AddVoiceSheet ra={ra} />;
  const voice = ra.neural.find((n) => n.id === sheet.id && n.custom);
  return voice ? <EditVoiceSheet key={voice.id} ra={ra} voice={voice} /> : null;
}

const PRIMARY_BUTTON =
  'ui-press min-h-11 rounded-full bg-accent px-5 text-[15px] font-semibold text-paper hover:opacity-90 disabled:opacity-40';
const SECONDARY_BUTTON =
  'ui-press min-h-11 rounded-full bg-fill px-5 text-[15px] text-ink hover:bg-fill-strong disabled:opacity-40';
const PLAIN_BUTTON = 'ui-press min-h-11 rounded-full px-4 text-[15px] text-ink hover:bg-fill';

/** Pencerenin kabı: başlık çubuğu (kapat), telefonda tutamak; Esc ve kapat düğmesi `onCancel` */
function SheetFrame({
  title,
  testId,
  onCancel,
  closeDisabled,
  onFiles,
  children,
}: {
  title: string;
  testId: string;
  onCancel(): void;
  closeDisabled?: boolean;
  /** pencereye sürüklenen dosyalar (bilgisayarda) */
  onFiles?(files: File[]): void;
  children: ReactNode;
}) {
  const wide = useWide();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shape = wide
    ? 'ui-pop m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] rounded-sheet'
    : 'ui-sheet-up mx-0 mt-auto mb-0 max-h-[calc(100dvh-2.5rem)] w-full rounded-t-sheet pb-[env(safe-area-inset-bottom)]';
  return (
    <Modal
      labelledBy={titleId}
      onCancel={onCancel}
      initialFocus={titleRef}
      testId={testId}
      placement={wide ? 'center' : 'bottom'}
      className={`pointer-events-auto max-w-none overflow-y-auto overscroll-contain bg-grouped p-0 text-ink shadow-float ${shape}`}
    >
      <div
        onDragOver={(e) => {
          if (!onFiles || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          if (!onFiles || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          onFiles([...e.dataTransfer.files]);
        }}
      >
        <div className="material-bar sticky top-0 z-10 shadow-[0_0.5px_0_var(--ui-hairline)]">
          {!wide && (
            <div aria-hidden="true" className="flex justify-center pt-2">
              <span className="h-[5px] w-9 rounded-full bg-fill-strong" />
            </div>
          )}
          <div className="flex items-center gap-1 py-1 pr-1 pl-5">
            <h2
              ref={titleRef}
              id={titleId}
              tabIndex={-1}
              className="min-w-0 flex-1 truncate text-[17px] font-semibold outline-none"
            >
              {title}
            </h2>
            <IconButton
              label="Pencereyi kapat"
              shortcut="Esc"
              Icon={X}
              variant="muted"
              disabled={closeDisabled}
              onClick={onCancel}
            />
          </div>
        </div>
        <div className="flex flex-col gap-5 p-4 text-[15px] sm:p-5">{children}</div>
      </div>
    </Modal>
  );
}

/** Gizlilik notu: ses yalnızca bu cihazda */
function PrivacyNote() {
  return (
    <p
      data-testid="voice-privacy"
      className="flex items-start gap-2 px-1 text-[13px] leading-snug text-secondary"
    >
      <Lock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      Bu ses yalnızca bu cihazda durur; yedeğe eklenmez.
    </p>
  );
}

/** Satır: solda ad, sağda değer (ikincil yazı) */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-secondary">{children}</span>
    </div>
  );
}

/** Ad kutusu (gruplu listenin satırı) */
function NameRow({
  value,
  onChange,
  disabled,
  onEnter,
}: {
  value: string;
  onChange(v: string): void;
  disabled?: boolean;
  onEnter?(): void;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1">
      <label htmlFor={id} className="shrink-0">
        Ad
      </label>
      <input
        id={id}
        data-testid="voice-name"
        value={value}
        maxLength={MAX_NAME_LENGTH}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.();
        }}
        // 16 px: iOS odakta sayfayı büyütmesin
        className="ui-focus min-h-9 min-w-0 flex-1 rounded-inner bg-transparent px-1 text-right text-[16px] text-ink"
      />
    </div>
  );
}

/** Sesin dili: "Türkçe (tr)" */
function langLabel(espeakVoice: string, languageName?: string): string {
  return languageName ? `${languageName} (${espeakVoice})` : espeakVoice;
}

/** Süren adımın ilerlemesi (ses motoru: yüzde; kaydetme ve deneme: süresi bilinmez) */
function PhaseProgress({ phase }: { phase: ImportPhase }) {
  const label =
    phase.kind === 'runtime'
      ? 'Ses motoru indiriliyor…'
      : phase.kind === 'save'
        ? 'Ses kaydediliyor…'
        : 'Ses deneniyor…';
  const percent =
    phase.kind === 'runtime' && phase.total > 0
      ? Math.min(100, Math.floor((phase.loaded / phase.total) * 100))
      : null;
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="voice-import-progress"
      data-phase={phase.kind}
    >
      <p role="status">
        {label}{' '}
        {percent !== null && (
          <span className="text-secondary tabular-nums">
            %{percent} · {formatMb(phase.kind === 'runtime' ? phase.loaded : 0)} /{' '}
            {formatMb(phase.kind === 'runtime' ? phase.total : 0)}
          </span>
        )}
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-fill-strong"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        {percent !== null ? (
          <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        ) : (
          <div className="h-full w-full animate-pulse bg-accent/60 motion-reduce:animate-none" />
        )}
      </div>
      {phase.kind === 'check' && (
        <p className="text-[13px] text-secondary">Model yükleniyor; birkaç saniye sürebilir.</p>
      )}
    </div>
  );
}

/** Seçilen dosyanın satırı: adı ve boyu, seçilmediyse "Seçilmedi" */
function FileRow({
  label,
  file,
  testId,
}: {
  label: string;
  file?: { name: string; blob: Blob; zip?: string; bytes?: number };
  testId: string;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5" data-testid={testId}>
      {file ? (
        <CircleCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
      ) : (
        <FileQuestionMark className="size-4 shrink-0 text-secondary" aria-hidden="true" />
      )}
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 flex-1 text-right text-[13px] text-secondary">
        {file ? (
          <>
            <span className="block truncate">{file.name}</span>
            <span className="block tabular-nums">
              {(file.bytes ?? file.blob.size) < 1_000_000
                ? `${Math.max(1, Math.round((file.bytes ?? file.blob.size) / 1000)).toLocaleString('tr-TR')} KB`
                : formatMb(file.bytes ?? file.blob.size)}
              {file.zip ? ` · ${file.zip}` : ''}
            </span>
          </>
        ) : (
          'Seçilmedi'
        )}
      </span>
    </div>
  );
}

/** Kendi sesini ekle */
function AddVoiceSheet({ ra }: { ra: ReadAloudUi }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // iOS bilinmeyen uzantıyı (.onnx) seçtirmez (dosya soluk görünür): orada süzgeç yok, içerik denetlenir
  const [accept] = useState(() =>
    iosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)
      ? undefined
      : '.onnx,.json,.zip,application/json,application/zip',
  );
  const [selection, setSelection] = useState<VoiceSelection>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [prepared, setPrepared] = useState<PreparedVoice | null>(null);
  const [name, setName] = useState('');
  const [runtimeNeed, setRuntimeNeed] = useState(0);
  const [work, setWork] = useState<{ phase: ImportPhase; controller: AbortController } | null>(
    null,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const picks = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void piperManager.runtimeNeed().then((n) => {
      if (mounted.current) setRuntimeNeed(n);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Pencere kapanınca (okuma kapandı) süren ekleme durur
  const controller = work?.controller;
  useEffect(() => () => controller?.abort(), [controller]);

  async function onFiles(files: File[]) {
    if (files.length === 0 || work) return;
    const my = ++picks.current;
    setReading(true);
    setFailure(null);
    setNote(null);
    const added = await addVoiceFiles(selection, files);
    let errors = added.errors;
    let ready: PreparedVoice | null = null;
    if (added.selection.model && added.selection.config) {
      const r = await prepareVoice(added.selection);
      if (r.ok) ready = r.voice;
      else errors = [...errors, ...r.errors];
    }
    if (my !== picks.current || !mounted.current) return;
    setSelection(added.selection);
    setProblems(errors);
    setPrepared(ready);
    if (ready) setName(ready.defaultName);
    setReading(false);
  }

  const cleanName = cleanVoiceName(name);
  const canAdd = !!prepared && !!cleanName && !work && !reading;

  function add() {
    if (!prepared || !cleanName || work) return;
    const ctl = new AbortController();
    setFailure(null);
    setNote(null);
    setWork({
      phase:
        runtimeNeed > 0 ? { kind: 'runtime', loaded: 0, total: runtimeNeed } : { kind: 'save' },
      controller: ctl,
    });
    // Dokunuşun içinde çağrılır: ses bağlamı açılır (iOS)
    ra.importVoice(prepared, cleanName, {
      signal: ctl.signal,
      onPhase: (phase) => {
        if (!mounted.current) return;
        setWork((w) => (w && w.controller === ctl ? { ...w, phase } : w));
        // Saklandı: ZIP'ten açılan model (bellekte) seçimde de bırakılır, deneme başlamadan
        if (phase.kind === 'check' && prepared.fromZip)
          setSelection((sel) =>
            sel.model?.zip
              ? { ...sel, model: { ...sel.model, blob: new Blob(), bytes: sel.model.blob.size } }
              : sel,
          );
      },
    }).then(
      () => {
        if (mounted.current) ra.closeVoiceSheet();
      },
      (e: unknown) => {
        if (!mounted.current) return;
        setWork(null);
        if (e instanceof CustomVoiceError && e.cancelled) setNote(e.message);
        else setFailure(e instanceof Error ? e.message : String(e));
        // ZIP'ten açılan model bırakıldı: yeniden eklemek için ZIP yeniden seçilir
        if (prepared.fromZip && prepared.model.size === 0) {
          setSelection({});
          setPrepared(null);
          setProblems(['Yeniden denemek için ZIP dosyasını yeniden seç.']);
        }
        void piperManager.runtimeNeed().then((n) => mounted.current && setRuntimeNeed(n));
      },
    );
  }

  const hint =
    selection.model && !selection.config
      ? 'Ayar dosyasını (.onnx.json) da seç.'
      : selection.config && !selection.model
        ? 'Model dosyasını (.onnx) da seç.'
        : null;

  return (
    <SheetFrame
      title="Kendi sesini ekle"
      testId="voice-import"
      onCancel={() => (work ? work.controller.abort() : ra.closeVoiceSheet())}
      onFiles={(files) => void onFiles(files)}
    >
      <p className="px-1 text-[13px] leading-snug text-secondary">
        Bilgisayarında eğittiğin Piper sesinin iki dosyasını seç: model (.onnx) ve ayar dosyası
        (.onnx.json). İkisini içeren bir .zip de olur. Dosyaları AirDrop ile Dosyalar'a
        gönderebilirsin.
      </p>

      <div className="flex flex-col gap-3">
        <ListGroup title="Dosyalar">
          <FileRow label="Model" file={selection.model} testId="voice-file-model" />
          <FileRow label="Ayar dosyası" file={selection.config} testId="voice-file-config" />
        </ListGroup>
        <button
          type="button"
          data-testid="voice-pick"
          disabled={!!work || reading}
          onClick={() => inputRef.current?.click()}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {reading
            ? 'Dosyalar okunuyor…'
            : selection.model || selection.config
              ? 'Başka dosya seç'
              : 'Dosyaları seç'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          hidden
          data-testid="voice-file-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void onFiles(files);
          }}
        />
        {hint && problems.length === 0 && (
          <p className="px-1 text-[13px] text-secondary" data-testid="voice-hint-missing">
            {hint}
          </p>
        )}
        {problems.length > 0 && (
          <ul role="alert" data-testid="voice-problems" className="flex flex-col gap-1 px-1">
            {problems.map((p) => (
              <li key={p} className="text-[13px] leading-snug text-danger">
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>

      {prepared && (
        <div className="flex flex-col gap-3">
          <ListGroup title="Ses">
            <NameRow value={name} onChange={setName} disabled={!!work} onEnter={add} />
            <InfoRow label="Dil">
              {langLabel(prepared.info.espeakVoice, prepared.info.languageName)}
            </InfoRow>
            <InfoRow label="Boyut">
              <span data-testid="voice-size">{formatMb(prepared.modelBytes)}</span>
            </InfoRow>
            {prepared.info.quality && <InfoRow label="Kalite">{prepared.info.quality}</InfoRow>}
          </ListGroup>
          {prepared.warnings.map((w) => (
            <p
              key={w}
              data-testid="voice-warning"
              className="flex items-start gap-2 px-1 text-[13px] leading-snug text-ink"
            >
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-accent" aria-hidden="true" />
              {w}
            </p>
          ))}
          {runtimeNeed > 0 && (
            <p className="px-1 text-[13px] leading-snug text-secondary" data-testid="voice-runtime">
              İlk yapay zekâ sesi: ses motoru da indirilecek ({formatMb(runtimeNeed)}, bir kez,
              internet gerekir).
            </p>
          )}
        </div>
      )}

      <PrivacyNote />

      {work ? (
        <div className="flex flex-col gap-3">
          <PhaseProgress phase={work.phase} />
          <button
            type="button"
            data-testid="voice-import-cancel"
            // "Ekle" kayboldu: odak pencerede kalsın
            autoFocus
            onClick={() => work.controller.abort()}
            className={`${SECONDARY_BUTTON} self-start`}
          >
            Vazgeç
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {failure && (
            <p role="alert" data-testid="voice-import-error" className="text-[15px] text-danger">
              {failure}
            </p>
          )}
          {note && (
            <p role="status" className="text-[15px] text-secondary">
              {note}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={ra.closeVoiceSheet} className={PLAIN_BUTTON}>
              Vazgeç
            </button>
            <button
              type="button"
              data-testid="voice-import-add"
              disabled={!canAdd}
              onClick={add}
              className={PRIMARY_BUTTON}
            >
              Ekle
            </button>
          </div>
        </div>
      )}
    </SheetFrame>
  );
}

/** Kendi sesini düzenle: ad, bilgiler, kaldırma (onaylı) */
function EditVoiceSheet({ ra, voice }: { ra: ReadAloudUi; voice: NeuralVoiceUi }) {
  const custom = voice.custom!;
  const [name, setName] = useState(voice.name);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const cleanName = cleanVoiceName(name);
  const changed = !!cleanName && cleanName !== voice.name;

  async function save() {
    if (!cleanName || !changed || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await ra.renameVoice(voice.id, cleanName);
      ra.closeVoiceSheet();
    } catch {
      setSaving(false);
      setFailure('Ad kaydedilemedi. Cihazda yer kalmamış olabilir.');
    }
  }

  const added = new Date(custom.addedAt).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <SheetFrame title={voice.name} testId="voice-edit-sheet" onCancel={ra.closeVoiceSheet}>
      <ListGroup title="Kendi sesin">
        <NameRow value={name} onChange={setName} disabled={saving} onEnter={() => void save()} />
        <InfoRow label="Dil">{langLabel(custom.espeakVoice, custom.languageName)}</InfoRow>
        <InfoRow label="Boyut">{formatMb(custom.bytes)}</InfoRow>
        <InfoRow label="Eklendi">{added}</InfoRow>
        {custom.fileName && <InfoRow label="Dosya">{custom.fileName}</InfoRow>}
      </ListGroup>

      <PrivacyNote />

      {failure && (
        <p role="alert" className="text-[15px] text-danger">
          {failure}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={ra.closeVoiceSheet} className={PLAIN_BUTTON}>
          Vazgeç
        </button>
        <button
          type="button"
          data-testid="voice-save"
          disabled={!changed || saving}
          onClick={() => void save()}
          className={PRIMARY_BUTTON}
        >
          Kaydet
        </button>
      </div>

      <div className="border-t border-hairline pt-4">
        {confirm ? (
          <div
            role="group"
            aria-labelledby="voice-remove-question"
            data-testid="voice-remove-confirm"
            className="flex flex-col gap-3 rounded-control bg-group p-4"
          >
            <p id="voice-remove-question" className="text-[15px]">
              “{voice.name}” bu cihazdan silinsin mi? Yeniden eklemek için dosyaları tekrar seçmen
              gerekir.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(false)} className={PLAIN_BUTTON}>
                Vazgeç
              </button>
              <button
                type="button"
                data-testid="voice-remove-yes"
                onClick={() => {
                  ra.removeVoice(voice.id);
                  ra.closeVoiceSheet();
                }}
                className="ui-press min-h-11 rounded-full bg-danger px-5 text-[15px] font-semibold text-paper hover:opacity-90"
              >
                Kaldır
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="voice-remove-custom"
            onClick={() => setConfirm(true)}
            className="ui-press -mx-1 min-h-11 px-1 text-[15px] font-medium text-danger"
          >
            Sesi kaldır
          </button>
        )}
      </div>
    </SheetFrame>
  );
}
