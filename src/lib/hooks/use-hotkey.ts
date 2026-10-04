"use client";

import { useEffect, useRef } from "react";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * A key that does something anywhere on the page. A plain key (`/`) is
 * ignored while the admin types in a field; a key with Ctrl or ⌘ is not.
 */
export function useHotkey(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: { meta?: boolean; enabled?: boolean } = {},
): void {
  const { meta = false, enabled = true } = options;
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== key.toLowerCase()) return;
      const withMeta = event.metaKey || event.ctrlKey;
      if (meta !== withMeta || event.altKey) return;
      if (!meta && isTyping(event.target)) return;
      event.preventDefault();
      handlerRef.current(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, meta, enabled]);
}
