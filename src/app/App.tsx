import { Route, Routes } from 'react-router';
import { LibraryPage } from '../library/LibraryPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
    </Routes>
  );
}
