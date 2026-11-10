import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BookRecord } from '../db/db';

/** Kapak görseli varsa onu, yoksa başlık/yazarla renkli bir kapak çizer. Kapak ayrı tablodan, yalnızca bu kitap için okunur. */
export function BookCover({
  book,
  compact,
}: {
  book: Pick<BookRecord, 'id' | 'title' | 'author'>;
  /**
   * Küçük kapak (listeler, istatistikler): renkli kapakta başlık yerine baş harfler (dar kapakta kesik yazı
   * görünmesin), yazar yok
   */
  compact?: boolean;
}) {
  // undefined = yükleniyor, null = kapak yok
  const cover = useLiveQuery(() => db.covers.get(book.id).then((c) => c ?? null), [book.id]);
  // Apple Kitaplar gibi: az yuvarlatılmış köşe, yumuşak iki katlı gölge, ince kenar
  const frame =
    'aspect-[2/3] w-full rounded-[5px] shadow-[0_1px_2px_rgb(0_0_0/0.12),0_8px_20px_-6px_rgb(60_40_20/0.35)] ring-1 ring-black/8';
  if (cover === undefined) return <div className={`${frame} bg-fill-strong`} />;
  if (cover)
    return (
      <img
        src={cover.dataUrl}
        alt=""
        draggable={false}
        className={`${frame} object-cover select-none [-webkit-touch-callout:none]`}
      />
    );
  const hue = parseInt(book.id.slice(0, 6), 16) % 360;
  const background = {
    background: `linear-gradient(160deg, hsl(${hue} 38% 34%), hsl(${(hue + 30) % 360} 42% 22%))`,
    color: 'hsl(40 40% 92%)',
  };
  if (compact)
    return (
      <div
        className={`${frame} grid place-items-center border-l-2 border-black/20 font-book text-[13px] leading-none`}
        style={background}
      >
        <span aria-hidden="true">{initials(book.title)}</span>
      </div>
    );
  return (
    <div
      className={`${frame} flex flex-col justify-between border-l-4 border-black/20 p-3`}
      style={background}
    >
      <span className="line-clamp-5 font-book text-sm leading-tight">{book.title}</span>
      <span className="line-clamp-2 text-[11px] opacity-80">{book.author}</span>
    </div>
  );
}

/** Başlığın ilk iki kelimesinin baş harfleri ("Küçük Adımlar" → "KA") */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w))
    .slice(0, 2)
    .map((w) => (w.match(/[\p{L}\p{N}]/u)?.[0] ?? '').toLocaleUpperCase('tr-TR'))
    .join('');
}
