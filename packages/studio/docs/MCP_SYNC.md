# Studio ↔ MCP session sync

## HTTP API (same session as MCP tools)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/scenes` | List session scenes + revisions |
| `GET` | `/scenes/:id?format=json` | Full scene envelope — use for pull/round-trip |
| `PUT` | `/scenes/:id` | Replace graph; body at least `{ root }` (prefer full envelope from GET) |

Sidecar bind: by default listens on all interfaces; use `REFRAME_BIND_LOCAL=1` for `127.0.0.1` only. Port: `REFRAME_HTTP_PORT` (default `4100`). In CI/sandboxes without HTTP: `REFRAME_SKIP_HTTP_SIDECAR=1` (MCP stdio still works).

**PUT deserialize errors** — response JSON includes `error`, `kind: "reframe.deserialize"`, and `code`. Studio surfaces `code` in the error message when saving.

## Revision

- `lastKnownMcpRevision` on each artboard records the revision from the last successful GET/PUT round-trip with the MCP HTTP store.
- MCP bumps `sessionRevision` on graph replacements (compile, edit, PUT from Studio).

## Conflict model (no merge)

When SSE/session list reports a **newer revision** for a linked scene **while the artboard is dirty** (`markDirty`), Studio raises **`syncConflict`** instead of auto-pulling.

- **Server wins** for truth: the remote graph is newer; local unsaved edits are at risk.
- **Pull server version**: discards local changes on that artboard and loads JSON from GET `/scenes/:id?format=json`.
- **Dismiss**: clears the banner only; local state unchanged (user may push or resolve manually).

There is **no three-way merge**; optional future work: explicit «Push anyway» with server warning.

## References

- UI: `ProjectPanel.tsx` (`raiseSyncConflict`, `handleConflictPull`)
- Store: `scene.ts` (`syncConflict`, `setLastKnownMcpRevision`)
- Canonical scene JSON: `packages/core/src/spec/scene-envelope.ts`
