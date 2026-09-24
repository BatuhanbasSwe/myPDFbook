import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BookRecord } from '../db/db';

/** Kapak görseli varsa onu, yoksa başlık/yazarla renkli bir kapak çizer. Kapak ayrı tablodan, yalnızca bu kitap için okunur. */
export function BookCover({ book }: { book: Pick<BookRecord, 'id' | 'title' | 'author'> }) {
  // undefined = yükleniyor, null = kapak yok
  const cover = useLiveQuery(() => db.covers.get(book.id).then((c) => c ?? null), [book.id]);
  const frame = 'aspect-[2/3] w-full rounded-l-sm rounded-r-md shadow-md ring-1 ring-black/10';
  if (cover === undefined) return <div className={`${frame} bg-line`} />;
  if (cover) return <img src={cover.dataUrl} alt="" className={`${frame} object-cover`} />;
  const hue = parseInt(book.id.slice(0, 6), 16) % 360;
  return (
    <div
      className={`${frame} flex flex-col justify-between border-l-4 border-black/20 p-3`}
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 38% 34%), hsl(${(hue + 30) % 360} 42% 22%))`,
        color: 'hsl(40 40% 92%)',
      }}
    >
      <span className="line-clamp-5 font-book text-sm leading-tight">{book.title}</span>
      <span className="line-clamp-2 text-[11px] opacity-80">{book.author}</span>
    </div>
  );
}
