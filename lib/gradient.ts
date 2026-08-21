/**
 * The brand terracotta gradient — a top-lit convex fill, brand (#A85E2B) → deep terracotta
 * (#7A3D18). The wider light-to-dark spread gives filled pills (Button, selected Chip) a 3D
 * read from the gradient itself, not from a drop shadow. Shared so buttons, chips, the progress
 * bar, and sliders read as one system. The lightest stop is the full brand, so white text stays
 * ≥ 4.5:1 across the whole fill. Rendered with expo-linear-gradient (already used by the Backdrop).
 */
export const BRAND_GRADIENT = ["#A85E2B", "#7A3D18"] as const;
