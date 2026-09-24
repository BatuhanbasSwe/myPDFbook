import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtures = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

/** Fixture PDF'ini (istenirse farklı bir dosya adıyla) içe aktarır. */
export async function importFixture(page: Page, file: string, name = file): Promise<void> {
  const buffer = await readFile(path.join(fixtures, file));
  await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer });
}
