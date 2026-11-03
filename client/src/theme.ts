import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        canvas: { value: "#0a0e13" },
        panel: { value: "#111821" },
        raised: { value: "#18212d" },
        line: { value: "#263244" },
        text: { value: "#eef2f7" },
        muted: { value: "#8d9aac" },
        signal: { value: "#ff9f1c" },
        signalDim: { value: "#3a2508" },
        danger: { value: "#ff4d5e" },
        pick: { value: "#3ddc97" },
        ct: { value: "#5aa9ff" },
        t: { value: "#f5b83d" },
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
