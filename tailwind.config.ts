import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mission: {
          950: "#080a0f",
          900: "#10131a",
          850: "#141923",
          800: "#1a202c",
          700: "#273041",
          600: "#324058",
          500: "#4c6b93",
          400: "#7ca3d8",
          300: "#a6c2e6",
          200: "#d5e0ef",
        },
        linear: {
          ink: "#edf1f7",
          muted: "#9099ab",
          line: "#222a38",
          lineStrong: "#31415d",
          panel: "#10141d",
          surface: "#151b26",
          surfaceAlt: "#1a2230",
          surfaceHover: "#202a3a",
          warm: "#d6a661",
          teal: "#72a8ff",
          red: "#ff7f77",
        },
      },
      boxShadow: {
        mission: "0 18px 48px rgba(1, 4, 10, 0.28)",
      },
      fontFamily: {
        display: ["\"Söhne\"", "\"IBM Plex Sans\"", "\"Avenir Next\"", "sans-serif"],
        body: ["\"Söhne\"", "\"IBM Plex Sans\"", "\"Avenir Next\"", "sans-serif"],
      },
      backgroundImage: {
        "mission-grid":
          "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
