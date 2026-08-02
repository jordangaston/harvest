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
        // Harvest — vintage golden hour (WCAG 2.1 AA verified)
        cream: "#F1E6D2", // app canvas (honey cream)
        "cream-card": "#FBF6EC",
        // Cards / tiles / rows / sheets: ALWAYS use `card`, NEVER `bg-white`.
        // (Only exception: mocks of native OS UI that are truly white on-device.)
        card: "#FBF6EC", // warm-white surface
        sand: "#EBDCC0", // secondary fill
        brand: {
          DEFAULT: "#A85E2B", // amber — interactive
          dark: "#8A4A1E", // links on canvas / pressed
          light: "#F3E0CC", // selected tint
        },
        plus: {
          DEFAULT: "#5C6350", // warm olive — premium tier
          dark: "#4A5040",
          light: "#E1E4D5",
        },
        gold: {
          DEFAULT: "#C79A3E", // highlight fills
          dark: "#9E7620", // gold text/UI
        },
        ink: "#2E2419", // text strong (warm espresso)
        muted: "#6E5B48", // text weak
        "muted-canvas": "#574636", // text weak on honey canvas
        field: "#9C8460", // input borders
        hairline: "#E4D6BC", // dividers
        "hairline-cream": "#E4D6BC",
        success: "#4E7A3F",
        warning: "#8C5D18",
        error: "#B23A2E",
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
