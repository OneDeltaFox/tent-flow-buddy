import { useEffect, useRef } from "react";

// Keep the displayed revision stable while a user edits or moves a patient.
export function refreshIsSafe() {
  return document.visibilityState === "visible" &&
    !document.querySelector('[role="dialog"], [role="alertdialog"]') &&
    !document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
}

export function useAutoRefresh(refresh: () => Promise<unknown>) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const pointerDown = useRef(false);
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || pointerDown.current || !refreshIsSafe()) return;
      running = true;
      try { await latest.current(); } finally { running = false; }
    };
    const down = () => { pointerDown.current = true; };
    const up = () => { pointerDown.current = false; };
    const wake = () => { up(); void tick(); };
    const timer = window.setInterval(() => { void tick(); }, 5000);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", up);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", up);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return () => !pointerDown.current && refreshIsSafe();
}
