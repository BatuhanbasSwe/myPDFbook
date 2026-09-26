import { Component, type ReactNode } from 'react';
import { useLocation } from 'react-router';

interface Props {
  children: ReactNode;
  /** değişince (başka sayfaya geçilince) hata ekranı kapanır */
  resetKey: string;
}

interface State {
  error: unknown;
  resetKey: string;
}

/**
 * Çizimde bir hata olursa uygulama bembeyaz kalmasın (ana ekrana eklenmiş uygulamada geri dönülecek adres çubuğu
 * da yoktur): hata mesajı, yeniden deneme ve kütüphaneye dönüş gösterilir.
 */
class Boundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  render() {
    if (this.state.error === null) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : '';
    return (
      <div
        role="alert"
        className="grid min-h-dvh place-items-center bg-paper p-6 text-center text-ink"
      >
        <div className="flex max-w-sm flex-col items-center gap-3">
          <p className="font-book text-lg">Bir şeyler ters gitti.</p>
          {message && <p className="text-sm break-words text-muted">{message}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="min-h-11 rounded-full border border-line px-4 hover:bg-surface"
            >
              Yeniden dene
            </button>
            {/* Tam yeniden yükleme: bozulan durum hiç taşınmasın */}
            <a
              href="/"
              className="grid min-h-11 place-items-center rounded-full bg-accent px-4 text-paper"
            >
              Kütüphaneye dön
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
