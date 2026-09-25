/** pdf.js TextItem'ın kullandığımız alt kümesi. transform: [a, b, c, d, e, f]; (e, f) taban çizgisinin sol noktası, y yukarı doğru artar. */
export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PageText {
  width: number;
  height: number;
  items: RawTextItem[];
}

/** PDF içindekiler kaydı (sayfa numarası çözülmüş). level: 1 = en üst düzey. */
export interface OutlineEntry {
  title: string;
  pageIndex: number;
  level: number;
}

/** Dönüştürücünün PDF'ten ihtiyaç duyduğu her şey. pdf.js'e bağımlılık yalnızca src/pdf/ altındadır. */
export interface PdfSource {
  numPages: number;
  getPageText(pageIndex: number): Promise<PageText>;
  hasImages(pageIndex: number): Promise<boolean>;
  getOutline(): Promise<OutlineEntry[]>;
  getMetadata(): Promise<{ title?: string; author?: string }>;
}

/** Sayfadaki tek satır (PDF birimi: pt). */
export interface Line {
  text: string;
  x0: number;
  x1: number;
  /** taban çizgisi; y yukarı doğru artar */
  y: number;
  /** punto */
  size: number;
}

export interface PageLines {
  pageIndex: number;
  width: number;
  height: number;
  /** yukarıdan aşağıya sıralı */
  lines: Line[];
}

export type Block =
  | { kind: 'heading'; level: 1 | 2; text: string; srcPage: number }
  | { kind: 'para'; text: string; srcPage: number }
  | { kind: 'note'; text: string; srcPage: number }
  | { kind: 'break'; srcPage: number }
  | { kind: 'pageImage'; srcPage: number };

export interface Chapter {
  title: string;
  /** blocks dizisindeki başlangıç indeksi */
  block: number;
  level: number;
}

export type Lang = 'tr' | 'en' | 'other';

export interface BookContent {
  version: number;
  lang: Lang;
  blocks: Block[];
  chapters: Chapter[];
  /** görsel olarak gösterilen (metni olmayan) PDF sayfaları */
  textlessPages: number[];
  totalWords: number;
}

/** Kitap içinde konum: blok indeksi + blok metnindeki karakter. Font/ekran değişince de geçerli kalır. */
export interface Locator {
  block: number;
  offset: number;
}

/** Dönüştürücü kuralları değişince artırılır; eski kitaplar yeniden dönüştürülebilir. */
export const CONVERTER_VERSION = 2;
