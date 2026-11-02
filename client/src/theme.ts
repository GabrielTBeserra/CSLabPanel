import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        canvas: { value: "#101310" },
        panel: { value: "#171c18" },
        raised: { value: "#202720" },
        line: { value: "#343d35" },
        text: { value: "#edf2ec" },
        muted: { value: "#a1aca2" },
        signal: { value: "#c0fa55" },
        signalDim: { value: "#26351a" },
        danger: { value: "#ff786a" },
      },
      fonts: {
        body: { value: "'Space Grotesk', sans-serif" },
        heading: { value: "'Space Grotesk', sans-serif" },
        mono: { value: "'IBM Plex Mono', monospace" },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
