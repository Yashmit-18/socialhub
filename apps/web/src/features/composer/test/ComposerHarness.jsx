import { useReducer } from 'react';
import { composerReducer, createInitialComposerState } from '../model/composerState.js';

/**
 * Test-only harness: runs the real composer reducer so editor components can be tested with
 * genuine state transitions.
 *
 *   render(<ComposerHarness initial={{ caption: 'Hi' }}>
 *     {({ state, dispatch }) => <CaptionEditor state={state} dispatch={dispatch} platforms={[…]} />}
 *   </ComposerHarness>)
 *
 * `onState` (optional) receives every new state, for assertions.
 */
export function ComposerHarness({ initial, children, onState }) {
  const [state, dispatch] = useReducer(composerReducer, initial, (init) => ({
    ...createInitialComposerState(),
    ...(init ?? {}),
  }));
  onState?.(state);
  return children({ state, dispatch });
}
