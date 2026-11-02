import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        concord: {
          sidebar: "#1e1f22",     // Server list (72px)
          channels: "#2b2d31",    // Channel sidebar (240px)
          chat: "#313338",        // Chat & main area
          input: "#383a40",       // Message input & cards
          hover: "#35373c",       // Hover state for channels
          active: "#404249",      // Selected/active channel background
          subtle: "#1f2023",      // Borders and subtle dividers
          footer: "#232428",      // User status footer
        },
        brand: {
          blurple: "#5865F2",     // Primary Discord Blurple
          "blurple-hover": "#4752c4",
          green: "#23a55a",       // Online status / Success / Add server
          "green-hover": "#1a8445",
          red: "#f23f43",         // DND / Danger / Errors
          yellow: "#f0b232",      // Idle status
          gray: "#80848e",        // Offline status / muted hash
        },
        text: {
          primary: "#f2f3f5",     // High contrast titles & messages
          normal: "#dbdee1",      // Standard body text
          muted: "#949ba4",       // Channel names, topics, timestamps
          interactive: "#00a8fc", // Hyperlinks & active indicators
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
