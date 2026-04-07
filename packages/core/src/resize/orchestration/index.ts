/**
 * Orchestration — Public API
 *
 * High-level pipeline orchestration: scale, remember, session management.
 * Host-agnostic — works with any IHost adapter.
 */

// Scale handler
export { handleScale, type ScaleOptions, type ScaleResult } from './scale-handler';

// Remember (format master capture)
export { rememberAutoLayout, type RememberResult } from './remember';

// Selection notification
export { buildSelectionChangedMessage, type SelectionNotifyOptions } from './selection-notify';

// Session state
export {
  // Types
  type SessionSlotRow,
  type TempCapture,
  // Accessors
  getTempCaptures,
  getActiveTempId,
  getSuppressTempSync,
  setActiveTempId,
  setSuppressTempSync,
  resetSessionCaptures,
  getActiveCapture,
  // Queries
  pickBestSameRootCapture,
  pickCaptureMatchingTargetAspect,
  pickCaptureMatchingSourceAspect,
  tempSlotsAllUnderFrame,
} from './session-state';

// Guide picker
export { pickBestGuideKeyForDimensions } from './guide-picker';
