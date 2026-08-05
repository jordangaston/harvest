import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { generatePostmanCollection } from '../src/openapi/postman.js';

/**
 * Generate the Postman collection from the OpenAPI document and write it to
 * `server/postman_collection.json`.
 * @returns the path written.
 */
export async function writePostman(): Promise<string> {
  const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'postman_collection.json');
  const collection = await generatePostmanCollection();
  writeFileSync(target, JSON.stringify(collection, null, 2) + '\n', 'utf8');
  return target;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  writePostman()
    .then((target) => process.stdout.write(`Wrote Postman collection to ${target}\n`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
