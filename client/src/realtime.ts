import { useEffect, useRef, useState } from "react";
import { subscribeRealtime, type RealtimeEvent } from "./services/api";

type Listener = (event: RealtimeEvent) => void;
export type RealtimeMode = "connecting" | "live" | "polling";

const STREAM_TIMEOUT_MS = 8000;
const STALE_STREAM_MS = 40000;
const POLL_INTERVAL_MS = 4000;

const listeners = new Set<Listener>();
const modeListeners = new Set<(mode: RealtimeMode) => void>();
let close: (() => void) | null = null;
let mode: RealtimeMode = "connecting";
let lastMessageAt = 0;
let watchdog: ReturnType<typeof setInterval> | undefined;
let poller: ReturnType<typeof setInterval> | undefined;

const emit = (event: RealtimeEvent) => listeners.forEach((listener) => listener(event));

const setMode = (next: RealtimeMode) => {
  if (next === mode) return;
  mode = next;
  modeListeners.forEach((listener) => listener(next));
  clearInterval(poller);
  poller = undefined;
  if (next === "polling") {
    poller = setInterval(() => { emit({ type: "matches" }); emit({ type: "presence" }); }, POLL_INTERVAL_MS);
  }
};

const ensureConnection = () => {
  if (close) return;
  const startedAt = Date.now();
  lastMessageAt = 0;
  close = subscribeRealtime(
    (event) => {
      const wasLive = mode === "live";
      lastMessageAt = Date.now();
      setMode("live");
      if (!wasLive) emit({ type: "matches" });
      if (event.type !== "hello" && event.type !== "ping") emit(event);
    },
    (connected) => {
      if (!connected && mode === "live") setMode("connecting");
    },
  );
  watchdog = setInterval(() => {
    if (mode === "polling") return;
    const silentFor = Date.now() - (lastMessageAt || startedAt);
    if (silentFor > (lastMessageAt ? STALE_STREAM_MS : STREAM_TIMEOUT_MS)) setMode("polling");
  }, 2000);
};

const release = () => {
  if (listeners.size > 0 || !close) return;
  close();
  close = null;
  clearInterval(watchdog);
  setMode("connecting");
};

export const useRealtime = (onEvent: Listener, enabled = true) => {
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending: RealtimeEvent[] = [];
    const listener: Listener = (event) => {
      pending.push(event);
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending.splice(0).forEach((e) => handler.current(e));
      }, 150);
    };
    listeners.add(listener);
    ensureConnection();
    return () => { clearTimeout(timer); listeners.delete(listener); release(); };
  }, [enabled]);
};

export const useRealtimeMode = () => {
  const [value, setValue] = useState(mode);
  useEffect(() => {
    modeListeners.add(setValue);
    return () => { modeListeners.delete(setValue); };
  }, []);
  return value;
};
