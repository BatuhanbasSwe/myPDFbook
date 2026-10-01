import { Minus, Moon, Plus, Sun } from 'lucide-react';
import type { CSSProperties } from 'react';
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
  type Align,
  type Margin,
} from '../layout/typography';
import { IconButton } from '../ui/IconButton';
import { ListGroup, ListRow, SwitchRow } from '../ui/List';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  BRIGHTNESS_RANGE,
  setReaderPrefs,
  useReaderPrefs,
  type FlipEffect,
  type ReaderView,
} from './readerPrefs';

/**
 * "Aa" paneli (iOS ayarları gibi gruplu liste): görünüm, parlaklık ve tema, yazı, sayfa düzeni, sayfa çevirme ve
 * kalem. Yazı ayarları yalnızca metin görünümünde (sayfa görünümü PDF'in kendi sayfalarıdır). Değişiklik anında
 * yeniden sayfalar.
 */
export function SettingsSheet({ textOnly = false }: { textOnly?: boolean }) {
  const t = useTypography();
  const prefs = useReaderPrefs();
  const pen = usePenPrefs();
  const text = textOnly || prefs.view === 'text';
  return (
    <div className="flex max-h-[70dvh] flex-col gap-5 overflow-y-auto overscroll-contain bg-grouped px-3 pt-3 pb-4 text-ink">
      {!textOnly && (
        <ListGroup
          title="Görünüm"
          footer={
            prefs.view === 'page'
              ? 'Kitabın kendi sayfaları. Yazı ayarları, karanlık sayfa ve okuma modları için Metin.'
              : 'Metin ekrana göre yeniden dizilir: yazı tipi, punto ve karanlık tema.'
          }
        >
          <ListRow>
            <SegmentedControl<ReaderView>
              label="Görünüm"
              value={prefs.view}
              onChange={(v) => setReaderPrefs({ view: v })}
              className="flex-1"
              segments={[
                { value: 'page', label: 'Sayfa (PDF)', testId: 'view-page' },
                { value: 'text', label: 'Metin', testId: 'view-text' },
              ]}
            />
          </ListRow>
        </ListGroup>
      )}

      <ListGroup title="Parlaklık ve tema">
        <Brightness
          value={prefs.brightness}
          onChange={(v) => setReaderPrefs({ brightness: Math.round(v * 100) / 100 })}
        />
        <ListRow className="py-3">
          <ThemePicker />
        </ListRow>
      </ListGroup>

      {text && (
        <>
          <ListGroup title="Yazı">
            <ListRow className="py-3">
              <div role="group" aria-label="Yazı tipi" className="grid flex-1 grid-cols-2 gap-2">
                {FONTS.map((f) => {
                  const on = t.font === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTypography({ font: f })}
                      className={`ui-press flex min-h-11 items-center justify-center rounded-control px-2 text-[15px] ${
                        on
                          ? 'bg-tint text-accent shadow-[inset_0_0_0_1.5px_var(--accent)]'
                          : 'bg-fill text-ink hover:bg-fill-strong'
                      }`}
                    >
                      <span className="truncate" style={{ fontFamily: FONT_FAMILIES[f] }}>
                        {FONT_LABELS[f]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ListRow>
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
          </ListGroup>

          <ListGroup title="Sayfa düzeni">
            <ListRow label="Kenar">
              <SegmentedControl<Margin>
                label="Kenar boşluğu"
                value={t.margin}
                onChange={(m) => setTypography({ margin: m })}
                className="w-52"
                segments={[
                  { value: 'narrow', label: 'Dar', name: 'Dar kenar' },
                  { value: 'normal', label: 'Normal', name: 'Normal' },
                  { value: 'wide', label: 'Geniş', name: 'Geniş kenar' },
                ]}
              />
            </ListRow>
            <ListRow label="Hizalama">
              <SegmentedControl<Align>
                label="Hizalama"
                value={t.align}
                onChange={(a) => setTypography({ align: a })}
                className="w-52"
                segments={[
                  { value: 'justify', label: 'İki yana', name: 'İki yana yasla' },
                  { value: 'left', label: 'Sola', name: 'Sola yasla' },
                ]}
              />
            </ListRow>
            <SwitchRow
              label="Heceleme"
              checked={t.hyphenate}
              onChange={(v) => setTypography({ hyphenate: v })}
            />
          </ListGroup>
        </>
      )}

      <ListGroup title="Sayfa çevirme">
        <ListRow label="Efekt">
          <SegmentedControl<FlipEffect>
            label="Sayfa çevirme efekti"
            value={prefs.effect}
            onChange={(e) => setReaderPrefs({ effect: e })}
            className="w-56"
            segments={[
              { value: 'curl', label: 'Kitap', testId: 'effect-curl' },
              { value: 'slide', label: 'Slayt', testId: 'effect-slide' },
              { value: 'none', label: 'Efektsiz', testId: 'effect-none' },
            ]}
          />
        </ListRow>
        <SwitchRow
          label="Genişse çift sayfa"
          checked={t.spread === 'auto'}
          onChange={(v) => setTypography({ spread: v ? 'auto' : 'single' })}
        />
        <SwitchRow
          label="Dokunarak"
          checked={prefs.tap}
          onChange={(v) => setReaderPrefs({ tap: v })}
        />
        <SwitchRow
          label="Kaydırarak"
          checked={prefs.swipe}
          onChange={(v) => setReaderPrefs({ swipe: v })}
        />
        <SwitchRow
          label="Alt düğmeler"
          checked={prefs.buttons}
          onChange={(v) => setReaderPrefs({ buttons: v })}
          testId="pref-buttons"
        />
      </ListGroup>

      {!text && (
        <ListGroup
          title="Kalem"
          footer="Apple Pencil kalem kipi kapalıyken de çizer; parmak yine sayfa çevirir."
        >
          <SwitchRow
            label="Kalemle her zaman çiz"
            checked={pen.penAlways}
            onChange={(v) => setPenPrefs({ penAlways: v })}
            testId="pref-pen-always"
          />
        </ListGroup>
      )}
    </div>
  );
}

/** Parlaklık: solda ay (karartır), ortada kaydırıcı, sağda güneş (açar); çift dokunma sıfırlar */
function Brightness({ value, onChange }: { value: number; onChange(v: number): void }) {
  const fill =
    ((value - BRIGHTNESS_RANGE.min) / (BRIGHTNESS_RANGE.max - BRIGHTNESS_RANGE.min)) * 100;
  return (
    <ListRow className="gap-1 px-1">
      <IconButton
        label="Parlaklığı azalt"
        Icon={Moon}
        variant="muted"
        onClick={() => onChange(Math.max(BRIGHTNESS_RANGE.min, value - 0.1))}
      />
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
        className="ui-range min-w-0 flex-1"
        style={{ '--fill': `${fill}%` } as CSSProperties}
      />
      <IconButton
        label="Parlaklığı artır"
        Icon={Sun}
        onClick={() => onChange(Math.min(BRIGHTNESS_RANGE.max, value + 0.1))}
      />
    </ListRow>
  );
}

/** iOS adımlayıcısı: solda ad ve değer, sağda − | + */
function Stepper(props: {
  label: string;
  value: string;
  onMinus(): void;
  onPlus(): void;
  canMinus: boolean;
  canPlus: boolean;
}) {
  const half =
    'ui-press grid h-11 w-12 place-items-center text-ink hover:bg-fill-strong disabled:opacity-35';
  return (
    <ListRow
      label={
        <>
          {props.label}{' '}
          <span className="ml-1 text-secondary tabular-nums" aria-live="polite">
            {props.value}
          </span>
        </>
      }
    >
      <div className="flex items-center overflow-hidden rounded-inner bg-fill">
        <button
          type="button"
          aria-label={`${props.label} azalt`}
          disabled={!props.canMinus}
          onClick={props.onMinus}
          className={half}
        >
          <Minus className="size-4" strokeWidth={2} />
        </button>
        <span aria-hidden="true" className="h-5 w-px bg-hairline" />
        <button
          type="button"
          aria-label={`${props.label} artır`}
          disabled={!props.canPlus}
          onClick={props.onPlus}
          className={half}
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
      </div>
    </ListRow>
  );
}
