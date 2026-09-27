import { Minus, Moon, Plus, Sun } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { setPenPrefs, usePenPrefs } from '../annotations/penPrefs';
import { ThemePicker } from '../app/ThemePicker';
import {
  FONT_FAMILIES,
  FONT_LABELS,
  FONTS,
  LINE_HEIGHT_RANGE,
  setTypography,
  SIZE_RANGE,
  useTypography,
  type Margin,
} from '../layout/typography';
import {
  BRIGHTNESS_RANGE,
  setReaderPrefs,
  useReaderPrefs,
  type FlipEffect,
  type ReaderView,
} from './readerPrefs';

/**
 * "Aa" paneli: görünüm, tema, yazı, sayfa düzeni ve sayfa çevirme. Yazı ayarları yalnızca metin görünümünde
 * (sayfa görünümü PDF'in kendi sayfalarıdır). Değişiklik anında yeniden sayfalar.
 */
export function SettingsSheet({ textOnly = false }: { textOnly?: boolean }) {
  const t = useTypography();
  const prefs = useReaderPrefs();
  const pen = usePenPrefs();
  const text = textOnly || prefs.view === 'text';
  return (
    <div className="flex max-h-[70dvh] flex-col gap-5 overflow-y-auto p-4 text-sm">
      {/* Görünüm ve tema; yanında dikey parlaklık (üstte güneş: açık, altta ay: karanlık) */}
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {!textOnly && (
            <Section title="Görünüm">
              <Row>
                {(['page', 'text'] as ReaderView[]).map((v) => (
                  <Choice
                    key={v}
                    active={prefs.view === v}
                    onClick={() => setReaderPrefs({ view: v })}
                    testId={`view-${v}`}
                  >
                    {{ page: 'Sayfa (PDF)', text: 'Metin' }[v]}
                  </Choice>
                ))}
              </Row>
              <p className="text-xs text-muted">
                {prefs.view === 'page'
                  ? 'Kitabın kendi sayfaları. Yazı ayarları, karanlık sayfa ve okuma modları için Metin.'
                  : 'Metin ekrana göre yeniden dizilir: yazı tipi, punto ve karanlık tema.'}
              </p>
            </Section>
          )}

          <Section title="Tema">
            <ThemePicker />
          </Section>
        </div>
        <Brightness
          value={prefs.brightness}
          onChange={(v) => setReaderPrefs({ brightness: Math.round(v * 100) / 100 })}
        />
      </div>

      {text && (
        <>
          <Section title="Yazı tipi">
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <Choice key={f} active={t.font === f} onClick={() => setTypography({ font: f })}>
                  <span style={{ fontFamily: FONT_FAMILIES[f] }}>{FONT_LABELS[f]}</span>
                </Choice>
              ))}
            </div>
          </Section>

          <Section title="Boyut ve aralık">
            <Stepper
              label="Punto"
              value={`${t.size}`}
              onMinus={() => setTypography({ size: t.size - SIZE_RANGE.step })}
              onPlus={() => setTypography({ size: t.size + SIZE_RANGE.step })}
              canMinus={t.size > SIZE_RANGE.min}
              canPlus={t.size < SIZE_RANGE.max}
            />
            <Stepper
              label="Satır aralığı"
              value={t.lineHeight.toFixed(1)}
              onMinus={() => setTypography({ lineHeight: t.lineHeight - LINE_HEIGHT_RANGE.step })}
              onPlus={() => setTypography({ lineHeight: t.lineHeight + LINE_HEIGHT_RANGE.step })}
              canMinus={t.lineHeight > LINE_HEIGHT_RANGE.min}
              canPlus={t.lineHeight < LINE_HEIGHT_RANGE.max}
            />
          </Section>

          <Section title="Sayfa">
            <Row>
              {(['narrow', 'normal', 'wide'] as Margin[]).map((m) => (
                <Choice
                  key={m}
                  active={t.margin === m}
                  onClick={() => setTypography({ margin: m })}
                >
                  {{ narrow: 'Dar kenar', normal: 'Normal', wide: 'Geniş kenar' }[m]}
                </Choice>
              ))}
            </Row>
            <Row>
              <Choice
                active={t.align === 'justify'}
                onClick={() => setTypography({ align: 'justify' })}
              >
                İki yana yasla
              </Choice>
              <Choice active={t.align === 'left'} onClick={() => setTypography({ align: 'left' })}>
                Sola yasla
              </Choice>
            </Row>
            <Row>
              <Toggle
                label="Heceleme"
                checked={t.hyphenate}
                onChange={(v) => setTypography({ hyphenate: v })}
              />
            </Row>
          </Section>
        </>
      )}

      <Section title="Sayfa çevirme">
        <Row>
          <Toggle
            label="Genişse çift sayfa"
            checked={t.spread === 'auto'}
            onChange={(v) => setTypography({ spread: v ? 'auto' : 'single' })}
          />
        </Row>
        <Row>
          {(['curl', 'slide', 'none'] as FlipEffect[]).map((e) => (
            <Choice
              key={e}
              active={prefs.effect === e}
              onClick={() => setReaderPrefs({ effect: e })}
              testId={`effect-${e}`}
            >
              {{ curl: 'Kitap', slide: 'Slayt', none: 'Efektsiz' }[e]}
            </Choice>
          ))}
        </Row>
        <Row>
          <Toggle
            label="Dokunarak"
            checked={prefs.tap}
            onChange={(v) => setReaderPrefs({ tap: v })}
          />
          <Toggle
            label="Kaydırarak"
            checked={prefs.swipe}
            onChange={(v) => setReaderPrefs({ swipe: v })}
          />
          <Toggle
            label="Alt düğmeler"
            checked={prefs.buttons}
            onChange={(v) => setReaderPrefs({ buttons: v })}
            testId="pref-buttons"
          />
        </Row>
      </Section>

      {!text && (
        <Section title="Kalem">
          <Row>
            <Toggle
              label="Kalemle her zaman çiz"
              checked={pen.penAlways}
              onChange={(v) => setPenPrefs({ penAlways: v })}
              testId="pref-pen-always"
            />
          </Row>
          <p className="text-xs text-muted">
            Apple Pencil kalem kipi kapalıyken de çizer; parmak yine sayfa çevirir.
          </p>
        </Section>
      )}
    </div>
  );
}

/** Dikey parlaklık kaydırıcısı: yukarı çekince açılır, aşağı çekince kararır */
function Brightness({ value, onChange }: { value: number; onChange(v: number): void }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border border-line py-3">
      <button
        type="button"
        aria-label="Parlaklığı artır"
        onClick={() => onChange(Math.min(BRIGHTNESS_RANGE.max, value + 0.1))}
        className="grid size-8 place-items-center rounded-full text-accent hover:bg-paper"
      >
        <Sun className="size-5" />
      </button>
      <input
        type="range"
        aria-label="Parlaklık"
        aria-valuetext={`%${Math.round(value * 100)}`}
        data-testid="brightness"
        min={BRIGHTNESS_RANGE.min}
        max={BRIGHTNESS_RANGE.max}
        step={BRIGHTNESS_RANGE.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(1)}
        className="brightness-slider min-h-32 flex-1"
        style={
          {
            '--fill': `${((value - BRIGHTNESS_RANGE.min) / (BRIGHTNESS_RANGE.max - BRIGHTNESS_RANGE.min)) * 100}%`,
          } as CSSProperties
        }
      />
      <button
        type="button"
        aria-label="Parlaklığı azalt"
        onClick={() => onChange(Math.max(BRIGHTNESS_RANGE.min, value - 0.1))}
        className="grid size-8 place-items-center rounded-full text-muted hover:bg-paper"
      >
        <Moon className="size-5" />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Choice({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick(): void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={`min-h-11 rounded-lg border px-3 ${active ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted'}`}
    >
      {children}
    </button>
  );
}

function Stepper(props: {
  label: string;
  value: string;
  onMinus(): void;
  onPlus(): void;
  canMinus: boolean;
  canPlus: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span>{props.label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${props.label} azalt`}
          disabled={!props.canMinus}
          onClick={props.onMinus}
          className="grid size-11 place-items-center rounded-full border border-line disabled:opacity-40"
        >
          <Minus className="size-4" />
        </button>
        <span className="w-8 text-center tabular-nums">{props.value}</span>
        <button
          type="button"
          aria-label={`${props.label} artır`}
          disabled={!props.canPlus}
          onClick={props.onPlus}
          className="grid size-11 place-items-center rounded-full border border-line disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  testId?: string;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}
