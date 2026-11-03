import { useEffect, useRef, useState } from "react";
import { subscribeRealtime, type RealtimeEvent } from "./services/api";

type Listener = (event: RealtimeEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<(connected: boolean) => void>();
let close: (() => void) | null = null;
let connected = false;

const ensureConnection = () => {
  if (close) return;
  close = subscribeRealtime(
    (event) => listeners.forEach((listener) => listener(event)),
    (value) => {
      if (value && !connected) listeners.forEach((listener) => listener({ type: "matches" }));
      connected = value;
      statusListeners.forEach((listener) => listener(value));
    },
  );
};

const release = () => {
  if (listeners.size > 0 || !close) return;
  close();
  close = null;
  connected = false;
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

export const useRealtimeStatus = () => {
  const [value, setValue] = useState(connected);
  useEffect(() => {
    statusListeners.add(setValue);
    return () => { statusListeners.delete(setValue); };
  }, []);
  return value;
};
