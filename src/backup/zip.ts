import { inflateSync } from 'fflate';
import { BackupError } from './format';

/**
 * Yedek dosyasının ZIP okuyucusu: dosyanın sonundaki merkez dizinden girdilerin yeri ve boyu okunur, her girdi
 * `Blob.slice` ile yalnızca kendi aralığı okunarak açılır. Dosyanın tamamı hiçbir zaman belleğe alınmaz; bir PDF
 * tam boyunda tek tampona okunur (IndexedDB'ye de öyle yazılır).
 *
 * Neden akışlı çözücü (fflate `Unzip`) değil: akışla yazılan ZIP'te (fflate `Zip`) girdinin boyu yerel başlıkta yok,
 * sonundaki "veri tanımlayıcısında"dır. Akışlı çözücü girdinin sonunu verinin içinde imza (PK\x03\x04,
 * PK\x07\x08) arayarak bulur; içinde bu baytlar geçen bir PDF (ör. ekli Office dosyası olan) bölünürdü. Merkez
 * dizindeki boylar ise kesindir.
 *
 * ZIP64 desteklenmez: yedek 4 GB'tan küçük olmalıdır (bkz. exportBackup).
 */

export interface ZipEntry {
  name: string;
  /** 0: sıkıştırmasız (STORE), 8: DEFLATE */
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** yerel başlığın dosyadaki yeri */
  headerOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
/** EOCD'nin ardındaki yorum en çok bu kadar olabilir */
const MAX_COMMENT = 0xffff;

const corrupt = (cause?: unknown) => new BackupError('corrupt', { cause });

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  if (start < 0 || end > blob.size || start > end) throw corrupt();
  try {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  } catch (e) {
    // iCloud'da kalmış ya da silinmiş dosya: okuma başarısız
    throw new BackupError('unreadable', { cause: e });
  }
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Merkez dizini okur: girdi adı → yeri. ZIP değilse `not-backup`, bozuksa `corrupt` hatası verir. */
export async function readZipIndex(blob: Blob): Promise<Map<string, ZipEntry>> {
  if (blob.size < EOCD_SIZE) throw new BackupError('not-backup');
  const tailStart = Math.max(0, blob.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await readRange(blob, tailStart, blob.size);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    // ZIP gibi başlıyor ama sonu yok: yarım kalmış (kesilmiş) yedek
    const head = await readRange(blob, 0, 4);
    throw new BackupError(
      view(head).getUint32(0, true) === LOCAL_SIGNATURE ? 'corrupt' : 'not-backup',
    );
  }
  const count = tv.getUint16(eocd + 10, true);
  const cdSize = tv.getUint32(eocd + 12, true);
  const cdOffset = tv.getUint32(eocd + 16, true);
  // ZIP64 işaretleri (0xFFFF…): bu uygulamanın yazdığı bir yedek değil
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw corrupt();
  if (cdOffset + cdSize > tailStart + eocd) throw corrupt();

  const cd = await readRange(blob, cdOffset, cdOffset + cdSize);
  const cv = view(cd);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== CENTRAL_SIGNATURE) throw corrupt();
    const flags = cv.getUint16(p + 8, true);
    const nameLength = cv.getUint16(p + 28, true);
    const extraLength = cv.getUint16(p + 30, true);
    const commentLength = cv.getUint16(p + 32, true);
    if (p + 46 + nameLength > cd.length) throw corrupt();
    // Şifreli girdi: bu uygulamanın yazdığı bir yedek değil
    if (flags & 1) throw corrupt();
    const entry: ZipEntry = {
      name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLength)),
      method: cv.getUint16(p + 10, true),
      crc: cv.getUint32(p + 16, true),
      compressedSize: cv.getUint32(p + 20, true),
      size: cv.getUint32(p + 24, true),
      headerOffset: cv.getUint32(p + 42, true),
    };
    entries.set(entry.name, entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Girdinin açılmış baytları. STORE girdide dönen dizi, tam girdi boyunda yeni bir tamponun görünümüdür
 * (`bytes.buffer` doğrudan saklanabilir). `checkCrc`: küçük girdiler için CRC-32 denetimi (PDF'ler özetleriyle
 * denetlenir).
 */
export async function readEntry(
  blob: Blob,
  entry: ZipEntry,
  { checkCrc = true }: { checkCrc?: boolean } = {},
): Promise<Uint8Array> {
  const header = await readRange(blob, entry.headerOffset, entry.headerOffset + 30);
  const hv = view(header);
  if (hv.getUint32(0, true) !== LOCAL_SIGNATURE) throw corrupt();
  const start = entry.headerOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const raw = await readRange(blob, start, start + entry.compressedSize);
  let bytes: Uint8Array;
  if (entry.method === 0) {
    if (raw.length !== entry.size) throw corrupt();
    bytes = raw;
  } else if (entry.method === 8) {
    try {
      bytes = inflateSync(raw, { out: new Uint8Array(entry.size) });
    } catch (e) {
      throw corrupt(e);
    }
    if (bytes.length !== entry.size) throw corrupt();
  } else {
    throw corrupt();
  }
  if (checkCrc && crc32(bytes) !== entry.crc) throw corrupt();
  return bytes;
}

/** JSON girdisini okur ve ayrıştırır; okunamazsa `corrupt` */
export async function readJsonEntry(blob: Blob, entry: ZipEntry): Promise<unknown> {
  const bytes = await readEntry(blob, entry);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw corrupt(e);
  }
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (ZIP'in kullandığı; fflate dışa açmıyor) */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
