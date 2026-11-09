/**
 * Undo and redo for the editor. The drawing library has its own, but in testing one undo
 * removed a whole shape and the following redo lost the edit, so whole shapes are kept here.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const MAX_ENTRIES = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  return {
    past: [...history.past, history.present].slice(-MAX_ENTRIES),
    present: next,
    future: [],
  };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future };
}
