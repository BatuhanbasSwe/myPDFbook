import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/source-serif-4/400.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
// Chromium'un kurulum olayı erken gelebilir: kütüphane çizilmeden dinlenmeye başlansın
import './app/install';
import { initTheme } from './app/theme';

initTheme();

// Alt yolda yayında (ör. GitHub Pages /myPDFbook/) adresler bu yolun altındadır; bkz. vite.config.ts
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
