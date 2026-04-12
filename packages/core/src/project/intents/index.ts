/**
 * Phase 7.0 — Intent Model barrel export.
 */

// Types
export type {
  Intent,
  IntentAuthor,
  IntentStatus,
  IntentPart,
  IntentActionResult,
  IntentTemplate,
  // Part kinds — exported for consumers that need to discriminate on a
  // specific part without re-declaring the union. Agents use these when
  // pattern-matching over a received intent.
  SelectPart, ScopePart, RolePart, QueryPart, ViewportPart,
  TextPart, AnnotatePart, GesturePart, VoicePart, PathPart,
  RefImagePart, RefUrlPart, RefNodePart, RefComponentPart, RefBrandPart, RefHistoryPart, RefMacroPart,
  DirectionPart, DegreePart, PreservePart, AvoidPart, PriorityPart,
  MovePart, ResizePart, DuplicatePart, SwapPart, RemovePart,
  GroupPart, UngroupPart, ReparentPart, ReorderPart,
  ExtractComponentPart, InstantiatePart, ApplyMacroPart, ApplyVariantPart,
  FixAuditPart, BindTokenPart, UnbindTokenPart,
  ColorPart, TypographyPart, SpacingPart, ShadowPart, RadiusPart,
  ConstraintPart,
  UndoPart, RedoPart, BranchPart, ComparePart, ExplorePart, SaveTemplatePart,
} from './types.js';

export { KNOWN_PART_KINDS, VALID_TRANSITIONS } from './types.js';

// Queue I/O
export {
  writeIntent,
  listIntents,
  getIntent,
  clearQueue,
  archiveTerminal,
  countByStatus,
  nextIntentId,
  queueFilePath,
  archiveFilePath,
} from './queue.js';

// Lifecycle
export {
  createDraft,
  addPartToDraft,
  removePartFromDraft,
  commitDraft,
  startProcessing,
  proposeOps,
  acceptProposal,
  rejectProposal,
  refineIntent,
  fetchNextBatch,
  maintainQueue,
} from './lifecycle.js';

// Templates
export {
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  applyTemplate,
  templateFilePath,
} from './templates.js';
