import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTooltipController,
  HOVER_DELAY,
  LINGER,
  LONG_PRESS,
  placeTooltip,
  tooltipText,
} from '../../src/ui/tooltipTiming';

function setup() {
  const events: string[] = [];
  const c = createTooltipController({
    onShow: () => events.push('show'),
    onHide: () => events.push('hide'),
  });
  return { c, events };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('araç ipucu zamanlaması', () => {
  it('fare: 500 ms beklenince görünür, çıkınca kaybolur', () => {
    const { c, events } = setup();
    c.enter('mouse');
    vi.advanceTimersByTime(HOVER_DELAY - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['show']);
    c.leave('mouse');
    expect(events).toEqual(['show', 'hide']);
  });

  it('fare erken çıkarsa ipucu hiç görünmez', () => {
    const { c, events } = setup();
    c.enter('mouse');
    vi.advanceTimersByTime(300);
    c.leave('mouse');
    vi.advanceTimersByTime(HOVER_DELAY);
    expect(events).toEqual([]);
  });

  it('fareyle basınca ipucu kalkar ve tıklama çalışır', () => {
    const { c, events } = setup();
    c.enter('mouse');
    vi.advanceTimersByTime(HOVER_DELAY);
    c.down('mouse', 0, 0);
    c.up();
    expect(events).toEqual(['show', 'hide']);
    expect(c.consumeClick()).toBe(false);
  });

  it('dokunma: 450 ms basılı tutunca görünür; tıklama yutulur; bırakınca 1,5 sn kalır', () => {
    const { c, events } = setup();
    c.enter('touch'); // dokunmada üzerine gelme sayılmaz
    c.down('touch', 10, 10);
    vi.advanceTimersByTime(LONG_PRESS - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['show']);
    expect(c.longPressing()).toBe(true);
    c.up();
    expect(c.consumeClick()).toBe(true); // düğme çalışmaz
    expect(c.consumeClick()).toBe(false); // yalnızca bir tıklama yutulur
    vi.advanceTimersByTime(LINGER - 1);
    expect(events).toEqual(['show']);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['show', 'hide']);
  });

  it('kısa dokunma ipucu göstermez, düğmeye basar', () => {
    const { c, events } = setup();
    c.down('touch', 10, 10);
    vi.advanceTimersByTime(120);
    c.up();
    vi.advanceTimersByTime(LONG_PRESS + LINGER);
    expect(events).toEqual([]);
    expect(c.consumeClick()).toBe(false);
  });

  it('parmak kayarsa (kaydırma) basılı tutma sayılmaz', () => {
    const { c, events } = setup();
    c.down('touch', 10, 10);
    c.move(12, 13); // küçük titreme sayılmaz
    vi.advanceTimersByTime(200);
    c.move(10, 40);
    vi.advanceTimersByTime(LONG_PRESS);
    expect(events).toEqual([]);
  });

  it('basılı tutmadan sonra tıklama gelmezse sonraki dokunuş yine çalışır', () => {
    const { c } = setup();
    c.down('touch', 0, 0);
    vi.advanceTimersByTime(LONG_PRESS);
    c.up(); // tarayıcı uzun basışta tıklama göndermedi
    c.down('touch', 0, 0);
    c.up();
    expect(c.consumeClick()).toBe(false);
  });

  it('dokunma iptal edilirse (tarayıcı kaydırmayı devraldı) ipucu göstermez', () => {
    const { c, events } = setup();
    c.down('touch', 0, 0);
    vi.advanceTimersByTime(200);
    c.cancel();
    vi.advanceTimersByTime(LONG_PRESS);
    expect(events).toEqual([]);
  });

  it('basılı tutmanın ardından tıklama gelmezse yutma işareti ipucuyla birlikte kalkar', () => {
    const { c, events } = setup();
    c.down('touch', 0, 0);
    vi.advanceTimersByTime(LONG_PRESS);
    c.up();
    vi.advanceTimersByTime(LINGER);
    expect(events).toEqual(['show', 'hide']);
    // Sonradan gelen (ilgisiz) tıklama yutulmaz
    expect(c.consumeClick()).toBe(false);
  });

  it('basılı tutma gösterdikten sonra tarayıcı dokunuşu devralırsa tıklama yutulmaz, ipucu sonra kalkar', () => {
    const { c, events } = setup();
    c.down('touch', 0, 0);
    vi.advanceTimersByTime(LONG_PRESS);
    c.cancel();
    expect(c.consumeClick()).toBe(false);
    expect(c.longPressing()).toBe(false);
    vi.advanceTimersByTime(LINGER);
    expect(events).toEqual(['show', 'hide']);
  });

  it('kalem hiç ipucu göstermez, basışı yutmaz', () => {
    const { c, events } = setup();
    c.enter('pen');
    c.down('pen', 0, 0);
    vi.advanceTimersByTime(LONG_PRESS + HOVER_DELAY);
    c.up();
    expect(events).toEqual([]);
    expect(c.consumeClick()).toBe(false);
  });

  it('klavye odağında hemen görünür, odak gidince kaybolur; fareyle gelen odakta görünmez', () => {
    const { c, events } = setup();
    c.focus(false);
    expect(events).toEqual([]);
    c.focus(true);
    expect(events).toEqual(['show']);
    c.blur();
    expect(events).toEqual(['show', 'hide']);
  });

  it('yazı: ad ve varsa kısayol', () => {
    expect(tooltipText('Sayfayı kilitle', 'L')).toBe('Sayfayı kilitle · L');
    expect(tooltipText('İçindekiler')).toBe('İçindekiler');
  });
});

describe('araç ipucunun yeri', () => {
  const view = { width: 400, height: 800 };
  const tip = { width: 120, height: 30 };

  it('düğmenin altında ortalı', () => {
    const p = placeTooltip({ left: 140, top: 10, width: 44, height: 44 }, tip, view);
    expect(p).toEqual({ left: 102, top: 62, side: 'below' });
  });

  it('altta yer yoksa üste açılır', () => {
    const p = placeTooltip({ left: 140, top: 750, width: 44, height: 44 }, tip, view);
    expect(p.side).toBe('above');
    expect(p.top).toBe(750 - 8 - 30);
  });

  it('üst tercih edilir, üstte yer yoksa alta açılır', () => {
    expect(
      placeTooltip({ left: 140, top: 400, width: 44, height: 44 }, tip, view, 'above').side,
    ).toBe('above');
    expect(
      placeTooltip({ left: 140, top: 5, width: 44, height: 44 }, tip, view, 'above').side,
    ).toBe('below');
  });

  it('ekranın kenarından taşmaz', () => {
    expect(placeTooltip({ left: 0, top: 10, width: 44, height: 44 }, tip, view).left).toBe(8);
    expect(placeTooltip({ left: 380, top: 10, width: 44, height: 44 }, tip, view).left).toBe(
      400 - 8 - 120,
    );
  });
});
