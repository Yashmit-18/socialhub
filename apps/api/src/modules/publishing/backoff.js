/**
 * Delay before the next automatic attempt, after `attempt` attempts have failed:
 * base, 2×base, 4×base, … capped at `maxMs`, with up to 20% random jitter added so many
 * destinations that failed together do not all come back at the same instant.
 */
export function retryDelayMs(attempt, { baseMs, maxMs, random = Math.random }) {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, maxMs);
  return Math.round(capped * (1 + 0.2 * random()));
}
