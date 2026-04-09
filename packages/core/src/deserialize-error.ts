/**
 * Stable machine-readable shape for deserialize / scene load failures.
 * HTTP and tools should include these fields alongside a human `message` / `error` string.
 */

export const REFRAME_DESERIALIZE_KIND = 'reframe.deserialize' as const;

export type DeserializeErrorCode =
  | 'SCENE_ID_REQUIRED'
  | 'SCENE_NOT_FOUND'
  | 'ROOT_MISSING'
  | 'DESERIALIZE_FAILED'
  | 'REPLACE_GRAPH_FAILED'
  | 'INVALID_ENVELOPE';

export interface DeserializeErrorBody {
  kind: typeof REFRAME_DESERIALIZE_KIND;
  code: DeserializeErrorCode;
  /** Human-readable detail (duplicate of `error` when present for HTTP compat). */
  message: string;
}

/** JSON body for 4xx/5xx scene endpoints — keep `error` for legacy clients. */
export function deserializeErrorHttpJson(message: string, code: DeserializeErrorCode): DeserializeErrorBody & { error: string } {
  return {
    kind: REFRAME_DESERIALIZE_KIND,
    code,
    message,
    error: message,
  };
}
