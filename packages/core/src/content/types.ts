/**
 * Content projection types — the bridge between INode design and .md content.
 *
 * Design is immutable from the .md layer. Only content is mutable:
 * text, headings, links, images. Colors, fonts, layout = untouchable.
 */

// ─── Back-reference ───────────────────────────────────────────

/** Maps a markdown element back to its INode source. */
export interface BackReference {
  /** INode ID. */
  nodeId: string;
  /** What kind of content this node holds. */
  kind: 'heading' | 'text' | 'link' | 'image' | 'section-break';
}

// ─── Extraction ───────────────────────────────────────────────

/** A single extracted content element. */
export interface ContentElement {
  /** Back-reference to source INode. */
  ref: BackReference;
  /** Markdown fragment for this element. */
  markdown: string;
  /** Nesting depth (0 = top-level section, 1 = direct child, etc.). */
  depth: number;
}

/** Result of extracting content from an INode tree. */
export interface ContentProjection {
  /** Scene ID. */
  sceneId: string;
  /** Scene name. */
  sceneName: string;
  /** All content elements in document order. */
  elements: ContentElement[];
  /** Full markdown string (join of all elements with back-refs). */
  markdown: string;
  /** Stats. */
  stats: {
    sections: number;
    headings: number;
    paragraphs: number;
    links: number;
    images: number;
  };
}

// ─── Application ──────────────────────────────────────────────

/** A single content edit detected from .md changes. */
export interface ContentEdit {
  /** Back-reference to target INode. */
  ref: BackReference;
  /** What changed. */
  change:
    | { type: 'text'; oldValue: string; newValue: string }
    | { type: 'image'; oldSrc: string; newSrc: string }
    | { type: 'link'; oldHref: string; newHref: string; oldLabel?: string; newLabel?: string }
    | { type: 'delete' }
    | { type: 'add'; markdown: string; afterNodeId?: string };
}

/** Result of applying .md edits to an INode tree. */
export interface ContentApplyResult {
  /** How many nodes were updated. */
  updated: number;
  /** How many nodes were hidden (deleted in .md = hidden in INode). */
  hidden: number;
  /** Edits that couldn't be applied (node not found, etc.). */
  skipped: ContentEdit[];
  /** All edits that were applied. */
  applied: ContentEdit[];
}
