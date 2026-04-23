// Test-only bootstrap: imports startHttpSidecar and calls it directly.
// Skirts the http-server.ts `isMain` check which only accepts .js argv
// (so tsx can't trigger it from source). Port configurable via env.

import { startHttpSidecar } from '../http-server';

const port = parseInt(process.env.REFRAME_PORT ?? '4100', 10);
startHttpSidecar(port);
console.log(`[test-bootstrap] sidecar started on :${port}`);
