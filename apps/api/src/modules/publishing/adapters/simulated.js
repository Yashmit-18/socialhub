import { PUBLISH_ERROR_CODES } from '@socialhub/shared';
import { config } from '../../../config/env.js';
import { PublishError } from '../publishError.js';

/**
 * SIMULATED publishing, for local development and automated tests.
 *
 * It contacts nobody. It returns no post id and no link, because no post exists: a
 * destination finished by this adapter is marked `simulated` and must never be presented as
 * a real Facebook or Instagram post.
 *
 * Rehearsing failures: a TEST account whose Meta id starts with one of the prefixes below
 * behaves that way. Real Meta ids are digits only, so a real account can never match.
 *
 *   sim-fail-      refused for good (not retried)
 *   sim-flaky-     temporary failure on the first attempt, fine afterwards
 *   sim-down-      temporary failure every time (uses up the automatic attempts)
 *   sim-unknown-   no answer after sending (never retried automatically)
 *   sim-slow-      takes 8 seconds
 *   sim-slower-    takes 12 seconds (longer than the old 10-second shutdown limit)
 */
export const SIMULATION_PREFIXES = Object.freeze({
  FAIL: 'sim-fail-',
  FLAKY: 'sim-flaky-',
  DOWN: 'sim-down-',
  UNKNOWN: 'sim-unknown-',
  SLOW: 'sim-slow-',
  SLOWER: 'sim-slower-',
});

let behaviour = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** In development a short pause makes the "publishing" state visible in the UI. */
const DELAY_MS = config.isTest ? 0 : 1500;
const SLOW_MS = config.isTest ? 50 : 8000;
const SLOWER_MS = config.isTest ? 80 : 12_000;
const E = PUBLISH_ERROR_CODES;
const P = SIMULATION_PREFIXES;

async function rehearse({ account, attempt }) {
  const id = String(account?.externalId ?? '');
  if (id.startsWith(P.SLOWER)) return sleep(SLOWER_MS);
  if (id.startsWith(P.SLOW)) return sleep(SLOW_MS);
  await sleep(DELAY_MS);
  if (id.startsWith(P.FAIL)) {
    throw new PublishError(
      E.PLATFORM_REJECTED,
      'Simulated: the platform did not accept this post.',
    );
  }
  if (id.startsWith(P.DOWN) || (id.startsWith(P.FLAKY) && attempt <= 1)) {
    throw new PublishError(
      E.PLATFORM_UNAVAILABLE,
      'Simulated: the platform had a temporary problem.',
      {
        retryable: true,
      },
    );
  }
  if (id.startsWith(P.UNKNOWN)) {
    throw new PublishError(
      E.OUTCOME_UNKNOWN,
      'Simulated: no answer arrived after the post was sent. It may or may not have been published.',
    );
  }
  return undefined;
}

export const simulatedAdapter = Object.freeze({
  name: 'simulated',
  simulated: true,
  async publish(context) {
    if (behaviour) await behaviour(context);
    else await rehearse(context);
    return { externalPostId: null, externalUrl: null };
  },
});

/** Test hook: `fn(context)` may throw a PublishError to simulate a failure. */
export function setSimulatedBehaviourForTests(fn) {
  if (!config.isTest) throw new Error('Simulated behaviour can only be changed in tests');
  behaviour = fn ?? null;
}
