import { useEffect, useRef, useState } from "react";

import { twMerge } from "@/utils";

import { type ToastType } from "./toastType";

const typeProgressColors: Record<ToastType, string> = {
  success: "bg-success",
  error: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

/**
 * The countdown, and what ends the toast when it runs out.
 *
 * The strip is what a reader is watching, so it is what decides: base-ui runs a
 * timer of its own and pauses it on rules this one does not share - a window
 * that was not focused when the toast arrived leaves it paused - which left
 * empty strips sitting on screen.
 */
export function ToastProgressBar({
  timeout,
  type,
  paused,
  onExpire,
}: {
  timeout: number;
  type: ToastType;
  paused: boolean;
  onExpire: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const startTimeRef = useRef(Date.now());
  const elapsedBeforePauseRef = useRef(0);
  const rafRef = useRef<number>(undefined);
  const expire = useRef(onExpire);

  useEffect(() => {
    expire.current = onExpire;
  });

  useEffect(() => {
    if (paused) {
      elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    startTimeRef.current = Date.now();

    const tick = () => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
      const remaining = Math.max(0, 100 - (elapsed / timeout) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      expire.current();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [paused, timeout]);

  return (
    <div
      data-toast-countdown
      className="absolute right-0 bottom-0 left-0 h-0.5 overflow-hidden rounded-b-lg"
    >
      <div
        className={twMerge("h-full transition-none", typeProgressColors[type])}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

/* The accent rather than the type color, because this strip reports work
   rather than a status. */
export function ToastTaskBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className="absolute right-0 bottom-0 left-0 h-1 overflow-hidden rounded-b-lg bg-surface-700">
      <div className="h-full bg-accent-500 transition-[width]" style={{ width: `${clamped}%` }} />
    </div>
  );
}
