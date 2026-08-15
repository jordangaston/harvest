import type { SourceType } from './domain.js';

/**
 * Classify a submitted URL to a source type + normalized ref — a trimmed port of
 * server/src/util/detect-source.ts (host → platform). The full detector (photo
 * uploads, share-sheet params) moves over unchanged; only the host map is needed
 * for the proof's link imports.
 */
export function classifySource(url: string): { sourceType: SourceType; sourceRef: string } | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  const sourceType = HOST_MAP.find(([re]) => re.test(host))?.[1] ?? 'website';
  return { sourceType, sourceRef: url };
}

const HOST_MAP: [RegExp, SourceType][] = [
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)facebook\.com$/, 'facebook'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'pinterest'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
];
