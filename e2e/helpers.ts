import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtures = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

/** Fixture PDF'ini dosya seçiciye verilecek biçimde okur (istenirse farklı bir dosya adıyla). */
export async function fixturePayload(file: string, name = file) {
  return { name, mimeType: 'application/pdf', buffer: await readFile(path.join(fixtures, file)) };
}

/** Fixture PDF'ini (istenirse farklı bir dosya adıyla) içe aktarır. */
export async function importFixture(page: Page, file: string, name = file): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(await fixturePayload(file, name));
}
