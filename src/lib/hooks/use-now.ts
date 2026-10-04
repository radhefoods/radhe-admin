"use client";

import { useSyncExternalStore } from "react";

// One clock for every countdown on the page: all of them move together,
// and a hidden tab does not tick.

const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | null = null;

function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      timer = null;
    }
  };
}

/** The current time, renewed every 15 seconds. */
export function useNow(): Date {
  const value = useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
  return new Date(value);
}
