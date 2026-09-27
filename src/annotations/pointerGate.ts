/**
 * Avuç reddi: kalem kipinde hangi dokunuşun çizeceği. iPad'de Apple Pencil ile yazarken avuç da ekrana değer; avuç
 * dokunuşu (pointerType 'touch') kalemden önce gelirse çizgiyi o başlatırdı.
 *
 * - Bu oturumda kalem ('pen') görüldüyse parmak artık çizmez (Notlar uygulamasındaki gibi). Yok sayılan parmak
 *   sayfayı da çevirmez: kalem kipinde kitap dokunmayı zaten almaz.
 * - Parmakla süren çizime kalem gelirse parmağın çizimi bırakılır, kalem çizer.
 * - Süren çizim varken gelen başka dokunuş yok sayılır.
 */
export type PointerDecision =
  /** çizim bu dokunuşla başlar */
  | 'start'
  /** süren (parmak) çizimi bırakılır, çizim bu dokunuşla başlar */
  | 'preempt'
  /** çizmez, sayfaya da gitmez */
  | 'ignore'
  /** çizim değil: kitaba ya da iğneye gider (sayfa çevirme, menü, not açma) */
  | 'pass';

export interface PointerGateState {
  /** bu oturumda kalem görüldü */
  penSeen: boolean;
  /** süren çizimin işaretçi türü; null: çizim yok */
  active: string | null;
}

export function acceptPointer(
  state: PointerGateState,
  /** `draws`: seçili araç ve kip bu dokunuşla çizer (bkz. AnnotationLayer → toolFor) */
  e: { pointerType: string; draws: boolean },
): PointerDecision {
  if (state.active !== null)
    return e.pointerType === 'pen' && state.active === 'touch' && e.draws ? 'preempt' : 'ignore';
  if (!e.draws) return 'pass';
  if (e.pointerType === 'touch' && state.penSeen) return 'ignore';
  return 'start';
}
