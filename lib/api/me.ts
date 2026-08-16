import { apiFetch } from "./client";
import type { ApiMe } from "./types";

/** Fetches the authenticated user. `name` is null-tolerant until Phone Auth surfaces it. */
export async function getMe(): Promise<ApiMe> {
  const { user } = await apiFetch<{ user: ApiMe }>(`/v1/users/me`);
  return user;
}

/** Permanently deletes the authenticated user and everything they own. 204, no body. */
export async function deleteAccount(): Promise<void> {
  await apiFetch<void>(`/v1/users/me`, { method: "DELETE" });
}
