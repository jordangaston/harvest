import { join } from 'node:path';

/** Resolve an `eval/gold/<base>[.<set>].jsonl` path. `GOLD_SET` selects a named campaign (e.g.
 * `pooled`) so a second gold set doesn't clobber the first; unset → the default files. */
export const GOLD_DIR = join(process.cwd(), 'eval', 'gold');

export function goldFile(base: string): string {
  const suffix = process.env.GOLD_SET ? `.${process.env.GOLD_SET}` : '';
  return join(GOLD_DIR, `${base}${suffix}.jsonl`);
}
