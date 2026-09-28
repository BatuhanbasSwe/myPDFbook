import { describe, expect, it } from 'vitest';
import { installCardKind, iosDevice, iosInstallHint, type InstallEnv } from '../../src/app/install';

const env = (patch: Partial<InstallEnv>): InstallEnv => ({
  standalone: false,
  ios: false,
  canPrompt: false,
  dismissed: false,
  ...patch,
});

describe('installCardKind', () => {
  it('iOS/iPadOS tarayıcısında Paylaş → Ana Ekrana Ekle tarifi', () => {
    expect(installCardKind(env({ ios: true }))).toBe('ios');
  });
  it('Chromium kurulum olayı geldiyse "Uygulamayı yükle"', () => {
    expect(installCardKind(env({ canPrompt: true }))).toBe('prompt');
  });
  it('kurulum yolu olmayan tarayıcıda (Firefox, masaüstü Safari) kart yok', () => {
    expect(installCardKind(env({}))).toBeNull();
  });
  it('uygulama olarak açıldıysa ya da kart kapatıldıysa hiç görünmez', () => {
    expect(installCardKind(env({ ios: true, standalone: true }))).toBeNull();
    expect(installCardKind(env({ canPrompt: true, standalone: true }))).toBeNull();
    expect(installCardKind(env({ ios: true, dismissed: true }))).toBeNull();
    expect(installCardKind(env({ canPrompt: true, dismissed: true }))).toBeNull();
  });
});

describe('iosDevice', () => {
  it('iPad, iPhone ve Mac kimliğiyle gelen iPadOS Safari tanınır', () => {
    expect(iosDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe(
      'iPad',
    );
    expect(
      iosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 5),
    ).toBe('iPhone');
    // iPadOS 13+ "masaüstü sitesi": dokunmatik ekranlı "Mac"
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
    expect(iosDevice(mac, 5)).toBe('iPad');
    expect(iosDevice(mac, 0)).toBeNull();
    expect(iosDevice('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130.0', 5)).toBeNull();
  });
  it('tarif cihaza göre Türkçe ekle yazılır', () => {
    expect(iosInstallHint('iPad')).toBe("iPad'e kur: Paylaş → Ana Ekrana Ekle");
    expect(iosInstallHint('iPhone')).toBe("iPhone'a kur: Paylaş → Ana Ekrana Ekle");
  });
});
