/**
 * Central caps for MCP tool inputs and fetched payloads (DoS / memory bounds).
 */

export const MCP_LIMITS = {
  /** reframe_compile — HTML import string */
  compileHtmlMaxChars: 6_000_000,
  /** reframe_compile — DESIGN.md / brand markdown */
  compileDesignMdMaxChars: 500_000,
  /** reframe_compile — blueprint JSON rough cap (serialized estimate via JSON.stringify length) */
  compileBlueprintJsonMaxChars: 4_000_000,
  /** reframe_compile — number of size entries */
  compileSizesMaxCount: 64,
  /** reframe_compile — single width/height bound */
  compileSizeMaxDimension: 16_384,

  /** reframe_design — HTML after URL fetch + CSS inline */
  designFetchHtmlMaxChars: 8_000_000,
  /** reframe_design — action prompt: DESIGN.md body */
  designPromptDesignMdMaxChars: 500_000,

  /** reframe_edit — operations per call */
  editOperationsMax: 10_000,

  /** reframe_inspect — tree depth from root (0 = root only) */
  inspectTreeDefaultMaxDepth: 64,
  /** reframe_inspect — max lines in text tree */
  inspectTreeDefaultMaxLines: 8_000,
} as const;
