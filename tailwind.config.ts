import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "oklch(var(--border))",
        input: "oklch(var(--input))",
        ring: "oklch(var(--ring))",
        background: "oklch(var(--background))",
        foreground: "oklch(var(--foreground))",
        primary: {
          DEFAULT: "oklch(var(--primary))",
          foreground: "oklch(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "oklch(var(--secondary))",
          foreground: "oklch(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "oklch(var(--destructive))",
          foreground: "oklch(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "oklch(var(--muted))",
          foreground: "oklch(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "oklch(var(--accent))",
          foreground: "oklch(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "oklch(var(--popover))",
          foreground: "oklch(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "oklch(var(--card))",
          foreground: "oklch(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "oklch(var(--sidebar))",
          foreground: "oklch(var(--sidebar-foreground))",
          primary: "oklch(var(--sidebar-primary))",
          "primary-foreground": "oklch(var(--sidebar-primary-foreground))",
          accent: "oklch(var(--sidebar-accent))",
          "accent-foreground": "oklch(var(--sidebar-accent-foreground))",
          border: "oklch(var(--sidebar-border))",
          ring: "oklch(var(--sidebar-ring))",
        },
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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        display: ["\"Geist Variable\"", "\"Söhne\"", "\"IBM Plex Sans\"", "\"Avenir Next\"", "sans-serif"],
        body: ["\"Geist Variable\"", "\"Söhne\"", "\"IBM Plex Sans\"", "\"Avenir Next\"", "sans-serif"],
      },
      backgroundImage: {},
    },
  },
  plugins: [],
} satisfies Config;
