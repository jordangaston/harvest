import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { generateDocument } from '../src/openapi/document.js';

/**
 * Write the OpenAPI 3.1 document to `server/openapi.json`.
 * @returns the path written.
 */
export function writeOpenapi(): string {
  const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');
  writeFileSync(target, JSON.stringify(generateDocument(), null, 2) + '\n', 'utf8');
  return target;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  process.stdout.write(`Wrote OpenAPI document to ${writeOpenapi()}\n`);
}
