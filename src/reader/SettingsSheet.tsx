import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
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
import { setReaderPrefs, useReaderPrefs, type FlipEffect } from './readerPrefs';

/** "Aa" paneli: tema, yazı, sayfa düzeni ve sayfa çevirme. Değişiklik anında yeniden sayfalar. */
export function SettingsSheet() {
  const t = useTypography();
  const prefs = useReaderPrefs();
  return (
    <div className="flex max-h-[70dvh] flex-col gap-5 overflow-y-auto p-4 text-sm">
      <Section title="Tema">
        <ThemePicker />
      </Section>

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
            <Choice key={m} active={t.margin === m} onClick={() => setTypography({ margin: m })}>
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
          <Toggle
            label="Genişse çift sayfa"
            checked={t.spread === 'auto'}
            onChange={(v) => setTypography({ spread: v ? 'auto' : 'single' })}
          />
        </Row>
      </Section>

      <Section title="Sayfa çevirme">
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
