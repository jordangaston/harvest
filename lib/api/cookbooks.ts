import { apiFetch } from "./client";
import type { ApiCookbook, CookbookView } from "./types";
import { analytics } from "../analytics";

export async function listCookbooks(): Promise<ApiCookbook[]> {
  const { cookbooks } = await apiFetch<{ cookbooks: ApiCookbook[] }>("/v1/cookbooks");
  return cookbooks;
}

export async function getCookbook(id: string): Promise<CookbookView> {
  return apiFetch<CookbookView>(`/v1/cookbooks/${id}`);
}

/** Creates a cookbook. Throws ApiError with code COOKBOOK_EXISTS (409) on a name collision. */
export async function createCookbook(name: string): Promise<ApiCookbook> {
  const { cookbook } = await apiFetch<{ cookbook: ApiCookbook }>("/v1/cookbooks", {
    method: "POST",
    body: JSON.stringify({ cookbook: { name } }),
  });
  analytics.track("Cookbook Created", { cookbook_id: cookbook.id });
  return cookbook;
}
