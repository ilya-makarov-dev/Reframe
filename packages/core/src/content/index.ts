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
export { createPageFromTemplate, buildSite, formatBuildSiteResult } from './constructor';
export { composePage, formatComposeResult } from './compose';
export {
  listPageSections, extractSectionHtml, replaceSectionSubtree,
  buildRefineContext, formatRefinePrompt,
} from './refine';
export type {
  ContentProjection,
  ContentElement,
  ContentEdit,
  ContentApplyResult,
  BackReference,
} from './types';
export type {
  PageResult,
  SiteBuildResult,
  SitePageInput,
} from './constructor';
export type {
  ComposePageInput,
  ComposePageResult,
} from './compose';
export type {
  SectionInfo,
  ExtractedSection,
  RefineContext,
} from './refine';
