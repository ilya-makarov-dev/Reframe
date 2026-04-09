/**
 * Structured MCP tool errors: human-readable text + machine-readable JSON block.
 * Clients may parse `content[1]` where `kind === "reframe.toolError"`.
 */

export interface ReframeToolErrorPayload {
  kind: 'reframe.toolError';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function makeToolJsonErrorResult(
  message: string,
  code: string,
  details?: Record<string, unknown>,
): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  const payload: ReframeToolErrorPayload = {
    kind: 'reframe.toolError',
    code,
    message,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
  return {
    isError: true,
    content: [
      { type: 'text', text: message },
      { type: 'text', text: JSON.stringify(payload) },
    ],
  };
}
