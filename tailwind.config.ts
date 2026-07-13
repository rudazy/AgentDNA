import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#0a0a0a",
        surface: "#111111",
        border: "#1f1f1f",
        muted: "#8a8a8a",
        ink: "#f5f5f5",
        lime: "#c8f135",
        gold: "#f5c842",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: {
        content: "1120px",
      },
      letterSpacing: {
        wideish: "0.02em",
      },
      screens: {
        xs: "390px",
      },
    },
  },
  plugins: [],
};

export default config;
