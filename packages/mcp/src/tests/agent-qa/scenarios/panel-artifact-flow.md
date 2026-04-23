# Panel artifact round-trip — author on disk, mount live

Proves the Phase 6 unlock end-to-end against a running sidecar:

  1. Open the dashboard (baseline — nothing authored yet).
  2. Drop a new .panel.html artifact into .reframe/ui/ via the runner.
     The sidecar's chokidar watcher picks it up + refreshes the registry.
  3. Mount the freshly-authored panel by name through the standard
     /platform/api/panel-mount endpoint — same path any code panel uses.
  4. Verify the composed HTML carries the artifact's intent roles and
     that per-row config interpolation landed in the gesture JSON.
  5. Delete the artifact so subsequent runs start clean.

Requires: sidecar up at http://localhost:4100 (or REFRAME_QA_URL) and
REFRAME_QA_PROJECT_DIR pointing at the sidecar's cwd (default: cwd).

- navigate /platform
- assert-role app-shell/root
- author-write version-history ../fixtures/version-history.panel.html
- mount version-history
- mounted version-history
- author-delete version-history
