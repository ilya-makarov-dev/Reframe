/**
 * Content module — bidirectional .md ↔ INode content projection.
 *
 * Extract: INode → .md (content projection with back-references)
 * Apply:   .md → INode (parse, match refs, update text/images/links)
 *
 * Design is immutable from .md. Only content changes.
 */

export { extractContent } from './extract';
export { applyContent, formatApplyResult } from './apply';
export type {
  ContentProjection,
  ContentElement,
  ContentEdit,
  ContentApplyResult,
  BackReference,
} from './types';
