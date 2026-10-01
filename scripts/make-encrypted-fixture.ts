/**
 * Şifreli test PDF'ini üretir: tests/fixtures/encrypted.pdf (açma şifresi "gizli").
 * Chromium şifreli PDF yazamadığı için PDF elle kurulur: iki sayfa, Helvetica, standart güvenlik işleyicisi
 * (RC4 128 bit, R3; pdf.js ve bütün okuyucular açar). Çalıştırma: pnpm exec tsx scripts/make-encrypted-fixture.ts
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'encrypted.pdf');
const USER_PASSWORD = 'gizli';
const OWNER_PASSWORD = 'sahip-gizli';
/** Bütün izinler (yazdırma, kopyalama…): 32 bit işaretli */
const PERMISSIONS = -4;
const KEY_BYTES = 16;
/** Belgenin kimliği (sabit: dosya her üretimde aynı çıksın) */
const FILE_ID = Buffer.from('6d797064666230306b2d7369667265', 'hex');

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

const md5 = (...parts: Buffer[]) => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
};

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const padded = (password: string) =>
  Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

/** 20 tur RC4 (R3): her turda anahtar tur numarasıyla XOR'lanır */
const rc4Rounds = (key: Buffer, data: Buffer) => {
  let out = data;
  for (let i = 0; i < 20; i++) out = rc4(Buffer.from(key.map((b) => b ^ i)), out);
  return out;
};

/** Algoritma 3: /O */
function ownerEntry(): Buffer {
  let hash = md5(padded(OWNER_PASSWORD));
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, KEY_BYTES));
  return rc4Rounds(hash.subarray(0, KEY_BYTES), padded(USER_PASSWORD));
}

/** Algoritma 2: belge anahtarı */
function documentKey(owner: Buffer): Buffer {
  const p = Buffer.alloc(4);
  p.writeInt32LE(PERMISSIONS);
  let hash = md5(padded(USER_PASSWORD), owner, p, FILE_ID);
  for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, KEY_BYTES));
  return hash.subarray(0, KEY_BYTES);
}

/** Algoritma 5: /U (ilk 16 bayt anlamlı) */
const userEntry = (key: Buffer) =>
  Buffer.concat([rc4Rounds(key, md5(PAD, FILE_ID)), Buffer.alloc(16)]);

/** Nesnenin anahtarı: belge anahtarı + nesne ve kuşak numarası */
function objectKey(key: Buffer, num: number): Buffer {
  const suffix = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
  return md5(key, suffix).subarray(0, Math.min(KEY_BYTES + 5, 16));
}

const PAGES: string[][] = [
  [
    'Gizli Defter',
    '',
    'Bu kitap sifreli bir PDF olarak saklanir.',
    'Sifre girilmeden sayfalari okunamaz.',
    'Kutuphaneye eklenirken uygulama sifreyi sorar.',
    'Dogru sifre girilince kitap acilir ve donusturulur.',
  ],
  [
    'Ikinci Sayfa',
    '',
    'Sabah erkenden yola ciktik ve deniz kiyisina vardik.',
    'Martilar iskelenin uzerinde donup duruyordu.',
    'Kahvemizi icip uzun uzun ufka baktik.',
    'Aksam olunca eve donup defteri kapattik.',
  ],
];

function contentStream(lines: string[]): string {
  const ops = ['BT', '/F1 20 Tf', '56 520 Td', '26 TL'];
  lines.forEach((line, i) => {
    if (i === 1) ops.push('/F1 12 Tf', '18 TL');
    ops.push(`(${line.replace(/[()\\]/g, '\\$&')}) Tj`, 'T*');
  });
  ops.push('ET');
  return ops.join('\n');
}

const hex = (b: Buffer) => `<${b.toString('hex')}>`;

function build(): Buffer {
  const owner = ownerEntry();
  const key = documentKey(owner);
  const user = userEntry(key);
  const enc = (num: number, data: Buffer) => rc4(objectKey(key, num), data);

  // 1 katalog, 2 sayfalar, 3 yazı tipi, 4 bilgi, 5 şifreleme, 6+ sayfa ve içerik çiftleri
  const objects: (Buffer | string)[] = [];
  const pageIds = PAGES.map((_, i) => 6 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${PAGES.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = `<< /Title ${hex(enc(4, Buffer.from('Gizli Defter', 'latin1')))} /Author ${hex(enc(4, Buffer.from('Test', 'latin1')))} >>`;
  objects[5] =
    `<< /Filter /Standard /V 2 /R 3 /Length ${KEY_BYTES * 8} /P ${PERMISSIONS} ` +
    `/O ${hex(owner)} /U ${hex(user)} >>`;
  PAGES.forEach((lines, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const data = enc(contentId, Buffer.from(contentStream(lines), 'latin1'));
    objects[contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${data.length} >>\nstream\n`, 'latin1'),
      data,
      Buffer.from('\nendstream', 'latin1'),
    ]);
  });

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  for (let num = 1; num < objects.length; num++) {
    const body = objects[num];
    const chunk = Buffer.concat([
      Buffer.from(`${num} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    offsets[num] = offset;
    offset += chunk.length;
    parts.push(chunk);
  }
  const xref = [
    'xref',
    `0 ${objects.length}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length} /Root 1 0 R /Info 4 0 R /Encrypt 5 0 R ` +
      `/ID [${hex(FILE_ID)} ${hex(FILE_ID)}] >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

writeFileSync(OUT, build());
console.log('✓', path.relative(process.cwd(), OUT));
