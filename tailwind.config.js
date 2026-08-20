/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "media",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Harvest — vintage golden hour (WCAG 2.1 AA verified).
        //
        // ONE warm-neutral ramp does ~90% of the UI. Depth comes from SHADOW (lib/elevation.ts),
        // never from tone — the light steps are too close to separate by colour. Saturated colour
        // is spent only on meaning: brand (terracotta) = primary/selected, success = positive,
        // error = destructive. See docs/swipe-ui/DESIGN.md § Colour and the shade-system study.
        sand: {
          DEFAULT: "#E7D8BE", // = sand-200
          50: "#FBF6EC", // = card (lightest surface)
          100: "#F1E6D2", // = cream (canvas)
          200: "#E7D8BE", // chips / tracks / borders on a surface
          300: "#D8C29C",
          400: "#C2A678",
          500: "#A98D5F", // tertiary fill (reads on cream with ink text)
          600: "#8A7048", // tertiary fill (reads on cream, 3.8:1, white text)
          700: "#6E5B48", // = muted (secondary text)
          800: "#574636", // = muted-canvas (weak text on cream)
          900: "#2E2419", // = ink (primary text)
        },
        // Semantic aliases into the ramp (keep the vocabulary; NEVER bg-white).
        cream: "#F1E6D2", // canvas (sand-100)
        card: "#FBF6EC", // warm-white surface (sand-50)
        "cream-card": "#FBF6EC",
        ink: "#2E2419", // sand-900
        muted: "#6E5B48", // sand-700
        "muted-canvas": "#574636", // sand-800
        field: "#9C8460", // input borders
        hairline: "#E4D6BC", // dividers
        "hairline-cream": "#E4D6BC",
        // Brand — terracotta, given a full range.
        brand: {
          DEFAULT: "#A85E2B", // primary / Cook / selected fill
          dark: "#8A4A1E", // = brand-700
          light: "#F3E0CC", // = brand-100 (selected tint)
          100: "#F3E0CC",
          200: "#E9C29A",
          300: "#DDA168",
          400: "#CB7C40",
          600: "#A85E2B",
          700: "#8A4A1E",
        },
        plus: { DEFAULT: "#5C6350", dark: "#4A5040", light: "#E1E4D5" }, // olive — premium tier
        gold: { DEFAULT: "#C79A3E", dark: "#9E7620" },
        success: { DEFAULT: "#4E7A3F", light: "#8CA97E", dark: "#3B5E30" }, // Like / positive
        error: { DEFAULT: "#B23A2E", light: "#D89A86", dark: "#8F2C22" }, // Pass / destructive
        warning: "#8C5D18",
      },
      borderRadius: {
        xl2: "20px",
      },
      fontFamily: {
        sans: ["Karla_400Regular"],
        medium: ["Karla_500Medium"],
        semibold: ["Karla_600SemiBold"],
        bold: ["Karla_700Bold"],
      },
    },
  },
  plugins: [],
};
