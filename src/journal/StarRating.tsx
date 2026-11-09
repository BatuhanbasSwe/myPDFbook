import { useId, useState } from 'react';

/** "4,5 yıldız" */
export const ratingLabel = (r: number) => `${String(r).replace('.', ',')} yıldız`;

/**
 * Yarım yıldızlı puan (0,5–5). Erişilebilir radyo grubu: her yıldızın sol ve sağ yarısı ayrı bir seçenek (yerel
 * radyo düğmesi, görünmez ama yerinde): dokunma, oklar ve ekran okuyucu onunla çalışır. Görünüş 5 yıldızdır.
 */
export function StarRating({
  value,
  onChange,
  testId,
}: {
  value: number | undefined;
  onChange(value: number): void;
  testId?: string;
}) {
  const name = useId();
  // Yıldız 44 px: her yarısı 22 px dokunma hedefi
  const star = 'size-11';
  // Seçilen puan kaydedilene dek gösterilir (kayıt eşzamansız: radyo düğmesi geri dönmesin)
  const [chosen, setChosen] = useState<{ value: number; from: number | undefined } | null>(null);
  if (chosen && chosen.from !== value) setChosen(null);
  const shown = chosen ? chosen.value : value;
  const choose = (v: number) => {
    setChosen({ value: v, from: value });
    onChange(v);
  };
  return (
    <div
      role="radiogroup"
      aria-label="Puan"
      data-testid={testId}
      data-value={shown ?? ''}
      className="flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((k) => {
        const fill = shown === undefined ? 0 : shown >= k ? 1 : shown >= k - 0.5 ? 0.5 : 0;
        return (
          <span key={k} className={`relative ${star} shrink-0`}>
            <Star fill={fill} />
            {[k - 0.5, k].map((v, half) => (
              <label
                key={v}
                className={`absolute inset-y-0 cursor-pointer ${half ? 'right-0' : 'left-0'} w-1/2`}
              >
                <input
                  type="radio"
                  name={name}
                  value={v}
                  checked={shown === v}
                  onChange={() => choose(v)}
                  aria-label={ratingLabel(v)}
                  data-testid={testId ? `${testId}-${v}` : undefined}
                  className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
                />
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-solid ${half ? 'rounded-r-inner' : 'rounded-l-inner'}`}
                />
              </label>
            ))}
          </span>
        );
      })}
    </div>
  );
}

const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';

/** Yıldız: boş, yarım ya da dolu (dolgu soldan, vurgu renginde) */
function Star({ fill }: { fill: 0 | 0.5 | 1 }) {
  // Yarım yıldız SVG'nin kendi kırpmasıyla (CSS clip-path eski Safari'de SVG öğesinde güvenilmez)
  const clip = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute inset-0 size-full">
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <path d={STAR} style={{ fill: 'var(--muted)', fillOpacity: 0.3 }} />
      {fill > 0 && (
        <path
          d={STAR}
          style={{ fill: 'var(--accent)' }}
          clipPath={fill < 1 ? `url(#${CSS.escape(clip)})` : undefined}
        />
      )}
    </svg>
  );
}

/** Kartta ve listede küçük, salt okunur puan: "★ 4,5" (ekran okuyucu: "4,5 yıldız") */
export function RatingBadge({ value }: { value: number }) {
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden="true" className="text-accent">
        ★
      </span>{' '}
      {String(value).replace('.', ',')}
      <span className="sr-only"> yıldız</span>
    </span>
  );
}
