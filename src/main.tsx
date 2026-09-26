import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/source-serif-4/400.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { initTheme } from './app/theme';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
