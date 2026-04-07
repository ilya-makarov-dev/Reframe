/**
 * Reframe Engine — Runtime Host Context
 *
 * Global host singleton. Analogous to `figma` in Figma Plugin API,
 * but through our IHost interface.
 *
 * Call `setHost(adapter)` at engine initialization.
 * All engine code calls `getHost()` instead of `figma.*`.
 */

import type { IHost } from './types';

let _host: IHost | null = null;

/** Set the active host. Call once at engine initialization. */
export function setHost(host: IHost): void {
  _host = host;
}

/** Get the active host. Throws if setHost was not called. */
export function getHost(): IHost {
  if (!_host) {
    throw new Error(
      '[reframe] Host not initialized. Call setHost(adapter) before using the engine.'
    );
  }
  return _host;
}

/** Reset the host (for tests). */
export function resetHost(): void {
  _host = null;
}
