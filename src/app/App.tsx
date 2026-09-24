import { useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { appImportDeps } from '../import/deps';
import { resumeConversions } from '../import/importBook';
import { LibraryPage } from '../library/LibraryPage';
import { ReaderRoute } from '../reader/ReaderPage';

export function App() {
  // Yarıda kalan dönüştürmeler uygulama açılınca sürdürülür (sekme okuma ekranında açılsa da)
  useEffect(() => {
    void resumeConversions(appImportDeps);
  }, []);

  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/read/:bookId" element={<ReaderRoute />} />
    </Routes>
  );
}
