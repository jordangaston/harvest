import { useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/**
 * Onboarding checklist completion. Two items are device-local flags (a first
 * import happened; the share shortcut was set up) and can't be server-derived —
 * see `docs/sprint-onboarding/DESIGN.md`. The third (created a cookbook) reads
 * the live cookbook count. Flags live in AsyncStorage and surface through
 * TanStack Query so the card refreshes when a flag flips on another screen.
 */

const KEY = "harvest.onboarding.flags.v1";

export type OnboardingFlags = { importedFirst: boolean; shortcutDone: boolean };

const EMPTY: OnboardingFlags = { importedFirst: false, shortcutDone: false };

/** Reads the flags; missing or corrupt storage yields both false. */
export async function readFlags(): Promise<OnboardingFlags> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<OnboardingFlags>;
    return { importedFirst: !!parsed.importedFirst, shortcutDone: !!parsed.shortcutDone };
  } catch {
    return EMPTY;
  }
}

async function writeFlag(patch: Partial<OnboardingFlags>): Promise<void> {
  const next = { ...(await readFlags()), ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export type ChecklistState = {
  importFirst: boolean;
  unlockShortcut: boolean;
  createCookbook: boolean;
  allDone: boolean;
};

/** Pure: maps flags + cookbook count to per-item done state. The one unit here. */
export function checklistState(flags: OnboardingFlags, cookbookCount: number): ChecklistState {
  const importFirst = flags.importedFirst;
  const unlockShortcut = flags.shortcutDone;
  const createCookbook = cookbookCount > 0;
  return { importFirst, unlockShortcut, createCookbook, allDone: importFirst && unlockShortcut && createCookbook };
}

/**
 * Cached read of the local flags. `staleTime: 0` so every mount refetches from
 * AsyncStorage (the source of truth) — the persisted query snapshot must never
 * outrank a flag that flipped since. Reads are a local AsyncStorage hit, so this
 * is cheap; cross-screen freshness still comes from the marks' invalidate.
 */
export function useOnboardingFlags() {
  return useQuery({ queryKey: queryKeys.onboardingFlags, queryFn: readFlags, staleTime: 0 });
}

/**
 * Imperative marks + an invalidate, so a flag set on the importing screen or the
 * unlock carousel refreshes every mounted checklist. Each hook returns an async
 * fn the caller awaits before navigating away.
 */
export function useMarkImportedFirst() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await writeFlag({ importedFirst: true });
    await qc.invalidateQueries({ queryKey: queryKeys.onboardingFlags });
  }, [qc]);
}

export function useMarkShortcutDone() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await writeFlag({ shortcutDone: true });
    await qc.invalidateQueries({ queryKey: queryKeys.onboardingFlags });
  }, [qc]);
}
