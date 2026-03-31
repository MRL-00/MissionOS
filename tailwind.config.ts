import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mission: {
          950: "#0f1115",
          900: "#13151a",
          850: "#17191f",
          800: "#1b1e26",
          700: "#242832",
          600: "#2f3440",
          500: "#5963d6",
          400: "#7982ec",
          300: "#a5abf6",
          200: "#d7dafd",
        },
        linear: {
          ink: "#f7f8f8",
          muted: "#8a8f98",
          line: "#262a33",
          lineStrong: "#343944",
          panel: "#16181d",
          surface: "#1b1e26",
          surfaceAlt: "#21252f",
          surfaceHover: "#252a35",
          warm: "#f5b83d",
          teal: "#5e6ad2",
          red: "#ff7676",
        },
      },
      boxShadow: {
        mission: "0 1px 3px rgba(0, 0, 0, 0.12)",
      },
      fontFamily: {
        display: ["Inter", "\"Söhne\"", "\"IBM Plex Sans\"", "\"Avenir Next\"", "sans-serif"],
        body: ["Inter", "\"Söhne\"", "\"IBM Plex Sans\"", "\"Avenir Next\"", "sans-serif"],
      },
      backgroundImage: {},
    },
  },
  plugins: [],
} satisfies Config;
