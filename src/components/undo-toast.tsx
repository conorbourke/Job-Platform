"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const UNDO_MS = 6000;

interface Pending {
  label: string;
  commit: () => void | Promise<void>;
  onUndo?: () => void;
}

/**
 * "Deleted · Undo" instead of an "Are you sure?" dialog. The action is held
 * back for a few seconds; Undo cancels it, otherwise it runs. If a second
 * action is scheduled, or the page is left, the pending one runs straight away.
 */
export function useUndoable() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) void p.commit();
  }, []);

  const schedule = useCallback(
    (label: string, commit: Pending["commit"], onUndo?: () => void) => {
      flush(); // one at a time: run any earlier pending action now
      const p = { label, commit, onUndo };
      pendingRef.current = p;
      setPending(p);
      timer.current = setTimeout(flush, UNDO_MS);
    },
    [flush]
  );

  const undo = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.onUndo?.();
  }, []);

  // Leaving the page: don't lose the action.
  useEffect(() => flush, [flush]);

  const toast = pending ? (
    <div
      role="status"
      className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-4 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-lg"
    >
      <span>{pending.label}</span>
      <button onClick={undo} className="font-semibold text-sky-300 hover:text-sky-200">
        Undo
      </button>
    </div>
  ) : null;

  return { schedule, undo, toast };
}
