import type { ReactNode } from 'react';

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** erişilebilir ad (yazı yetmiyorsa) */
  name?: string;
  testId?: string;
}

/**
 * Bölümlü seçici (iOS segmented control): gri iz üstünde seçili bölüm kabarık beyaz. Her bölüm bir düğmedir
 * (aria-pressed); grup adıyla okunur.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  segments,
  onChange,
  className = '',
}: {
  /** grubun erişilebilir adı */
  label: string;
  value: T;
  segments: Segment<T>[];
  onChange(value: T): void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex gap-0.5 rounded-control bg-fill p-0.5 ${className}`}
    >
      {segments.map((s) => {
        const on = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            aria-label={s.name}
            data-testid={s.testId}
            onClick={() => onChange(s.value)}
            className={`ui-press min-h-11 min-w-0 flex-1 truncate rounded-[10px] px-2 text-[13px] ${
              on
                ? 'bg-segment font-semibold text-ink shadow-control'
                : 'font-medium text-secondary hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
