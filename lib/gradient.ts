/**
 * The gentle brand terracotta gradient — brand (#A85E2B) → brand-dark (#8A4A1E).
 * Shared by the primary Button, the selected Chip, and the onboarding progress bar so they read as
 * one system. The lightest stop is the full brand, so white text stays ≥ 4.5:1 across the whole fill.
 * Rendered with expo-linear-gradient (already used by the Backdrop).
 */
export const BRAND_GRADIENT = ["#A85E2B", "#8A4A1E"] as const;
