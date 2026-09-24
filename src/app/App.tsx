import { Route, Routes } from 'react-router';
import { LibraryPage } from '../library/LibraryPage';
import { ReaderPage } from '../reader/ReaderPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/read/:bookId" element={<ReaderPage />} />
    </Routes>
  );
}
