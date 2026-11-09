import { describe, expect, it } from 'vitest';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history';

describe('history', () => {
  it('undoes and redoes in order', () => {
    let history = pushHistory(pushHistory(createHistory('a'), 'b'), 'c');
    history = undoHistory(history);
    expect(history.present).toBe('b');
    history = undoHistory(history);
    expect(history.present).toBe('a');
    history = redoHistory(history);
    expect(history.present).toBe('b');
    history = redoHistory(history);
    expect(history.present).toBe('c');
  });

  it('does nothing when there is nothing to undo or redo', () => {
    const history = createHistory('a');
    expect(undoHistory(history)).toBe(history);
    expect(redoHistory(history)).toBe(history);
  });

  it('clears redo after a new change', () => {
    const history = pushHistory(undoHistory(pushHistory(createHistory('a'), 'b')), 'c');
    expect(history.present).toBe('c');
    expect(redoHistory(history)).toBe(history);
    expect(undoHistory(history).present).toBe('a');
  });

  it('limits how many entries it keeps', () => {
    let history = createHistory(0);
    for (let i = 1; i <= 150; i++) history = pushHistory(history, i);
    expect(history.past).toHaveLength(100);
    expect(history.past[0]).toBe(50);
  });
});
