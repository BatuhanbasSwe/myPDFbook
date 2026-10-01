import type { Quality } from './pageCache';

export interface PlannedRender {
  page: number;
  quality: Quality;
  /** okuma yerine uzaklık (sayfa) */
  distance: number;
}

/**
 * Önizlemeler keskin sayfalardan ne kadar önce gelir: uzaklığı `k` olan önizleme `PREVIEW_START + k / PREVIEW_SPREAD`
 * puanında (keskin sayfa ileride `k`, geride `BEHIND * k + 1`). Yani sonraki iki açılış ve önceki açılış keskin
 * çizilince uzak önizlemeler başlar; keskin sayfa bir sayfa ilerledikçe önizlemeler ileride 4, geride 3 sayfa ilerler
 * (önizleme keskin sayfadan ~3–4 kat çabuk çizilir). Hızlı çevirmede ya da atlamada boş sayfa yerine önizleme görünür.
 */
const PREVIEW_START = 4.5;
const PREVIEW_SPREAD_AHEAD = 4;
const PREVIEW_SPREAD_BEHIND = 3;
/**
 * Yakındaki sayfaların (ileride 4, geride 2) önizlemesi açık sayfalardan hemen sonra, keskinlerinden önce gelir: yavaş
 * cihazda sonraki açılışa çabuk çevrilirse boş sayfa yerine önizleme görünür (hızlı cihazda bedeli ~0,2 sn).
 */
const NEAR_AHEAD = 4;
const NEAR_BEHIND = 2;
const NEAR_PREVIEW = 0.5;
/** Geride kalan sayfalar ileridekilerden bu kadar geç gelir (okur çoğunlukla ileri çevirir) */
const BEHIND = 1.5;

/**
 * Arka planda çizim sırası (saf işlev): açık sayfalar, yakındaki sayfaların önizlemesi, okuma yönünde sonraki
 * sayfalar, öncekiler, sonra geniş bir pencerede önizlemeler ve giderek uzaklaşan keskin sayfalar. `direction`: okurun
 * son çevirdiği yön (1 ileri, -1 geri). Önizleme yalnızca keskin görüntüsü olmayan sayfa için anlamlıdır: çağıran atlar.
 */
export function renderPlan(focus: number[], count: number, direction: 1 | -1): PlannedRender[] {
  if (!focus.length || count <= 0) return [];
  const lo = Math.min(...focus);
  const hi = Math.max(...focus);
  const scored: (PlannedRender & { score: number })[] = [];
  for (let page = 0; page < count; page++) {
    const before = page < lo ? lo - page : 0;
    const after = page > hi ? page - hi : 0;
    const distance = before || after;
    // Okuma yönünde olan "ileri"dir
    const ahead = direction === 1 ? after > 0 : before > 0;
    const sharp = distance === 0 ? 0 : ahead ? distance : BEHIND * distance + 1;
    scored.push({ page, quality: 'sharp', distance, score: sharp });
    if (distance > 0)
      scored.push({
        page,
        quality: 'preview',
        distance,
        score:
          distance <= (ahead ? NEAR_AHEAD : NEAR_BEHIND)
            ? NEAR_PREVIEW + distance / 10 + (ahead ? 0 : 0.05)
            : PREVIEW_START + distance / (ahead ? PREVIEW_SPREAD_AHEAD : PREVIEW_SPREAD_BEHIND),
      });
  }
  // Eşit puanda keskin önce, sonra sayfa sırası (okuma yönünde)
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(a.quality === 'preview') - Number(b.quality === 'preview') ||
      (a.page - b.page) * direction,
  );
  return scored.map(({ page, quality, distance }) => ({ page, quality, distance }));
}

/** Okuma yerinin değiştiği yön: açık sayfalar geriye gittiyse -1, yoksa (ileri ya da ilk açılış) 1 */
export function turnDirection(previous: number[] | null, next: number[]): 1 | -1 {
  if (!previous?.length || !next.length) return 1;
  return Math.min(...next) < Math.min(...previous) ? -1 : 1;
}
