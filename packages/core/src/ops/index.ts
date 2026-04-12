/**
 * Operations module — Phase 3 primitives for programmable design editing.
 *
 * See ./types.ts for the Operation union shape.
 * See ./apply.ts for the dispatcher (applyOperation / replayOperations).
 * See ./auto-bind-tokens.ts for the token-binding pass.
 */

export type {
  Operation,
  OperationBase,
  SetPropsOp,
  BindTokenOp,
  AutoBindTokensOp,
  AddStateOp,
  SetResponsiveOp,
  AddPresetAnimationOp,
  AddAnimationOp,
  ClearAnimationsOp,
  OperationResult,
  ReplayResult,
} from './types.js';

export {
  applyOperation,
  replayOperations,
  type ApplyContext,
} from './apply.js';

export {
  autoBindTokens,
  type AutoBindOptions,
  type AutoBindResult,
} from './auto-bind-tokens.js';
