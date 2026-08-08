/**
 * One real sample recipe per social platform, used by "Try with a sample recipe"
 * on the per-platform import screen. Each is a live post the import pipeline can
 * parse — the same fixed URLs the backend's e2e suite asserts against
 * (`server/tests/e2e/*`), so a green e2e run is their canary. They can rot; a dead
 * sample degrades to the normal import-failed screen.
 */
export const SOCIAL_PLATFORMS = ["Pinterest", "TikTok", "Instagram", "YouTube"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SAMPLE_RECIPE_URL: Record<SocialPlatform, string> = {
  Pinterest: "https://pin.it/6S1Z5sKLl", // Jamaican Jerk Chicken
  TikTok: "https://www.tiktok.com/t/ZTAsQBAYX/", // Creamy Garlic Paprika Chicken
  Instagram: "https://www.instagram.com/reel/DYmyAAaMDBj/", // Peruvian chicken
  YouTube: "https://youtube.com/shorts/JESPUqVMJpU", // Buffalo Chicken Hot Pockets
};

/** Native app deep-link scheme, with an https fallback used when the app can't open. */
export const PLATFORM_LINK: Record<SocialPlatform, { scheme: string; web: string }> = {
  Pinterest: { scheme: "pinterest://", web: "https://www.pinterest.com" },
  TikTok: { scheme: "snssdk1233://", web: "https://www.tiktok.com" },
  Instagram: { scheme: "instagram://app", web: "https://www.instagram.com" },
  YouTube: { scheme: "youtube://", web: "https://www.youtube.com" },
};

export const PLATFORM_ICON: Record<SocialPlatform, "logo-pinterest" | "logo-tiktok" | "logo-instagram" | "logo-youtube"> = {
  Pinterest: "logo-pinterest",
  TikTok: "logo-tiktok",
  Instagram: "logo-instagram",
  YouTube: "logo-youtube",
};
