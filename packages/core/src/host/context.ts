/**
 * Reframe Engine — Runtime Host Context
 *
 * Global host singleton. Analogous to `figma` in Figma Plugin API,
 * but through our IHost interface.
 *
 * Call `setHost(adapter)` at engine initialization.
 * All engine code calls `getHost()` instead of `figma.*`.
 *
 * **Scoped host (Node):** `runWithHost` / `runWithHostAsync` bind the active host for the
 * current async chain via `AsyncLocalStorage`, so concurrent MCP/HTTP work on different
 * graphs does not rely on last-writer-wins `setHost` alone. In the browser (Studio), no
 * `async_hooks` — falls back to setHost + restore.
 */

import type { IHost } from './types';

let _host: IHost | null = null;

type ScopedAls = import('node:async_hooks').AsyncLocalStorage<IHost>;

let _scopedHosts: ScopedAls | null | undefined;

function getScopedHostStore(): ScopedAls | null {
  if (_scopedHosts !== undefined) {
    return _scopedHosts;
  }
  if (typeof document !== 'undefined') {
    _scopedHosts = null;
    return null;
  }
  try {
    const req = (0, eval)('require') as undefined | ((id: string) => typeof import('node:async_hooks'));
    if (typeof req !== 'function') {
      _scopedHosts = null;
      return null;
    }
    const { AsyncLocalStorage } = req('node:async_hooks');
    _scopedHosts = new AsyncLocalStorage<IHost>();
    return _scopedHosts;
  } catch {
    _scopedHosts = null;
    return null;
  }
}

/** Set the active host. Call once at engine initialization. */
export function setHost(host: IHost): void {
  _host = host;
}

/** Get the active host. Throws if setHost was not called. */
export function getHost(): IHost {
  const scoped = getScopedHostStore()?.getStore();
  if (scoped) {
    return scoped;
  }
  if (!_host) {
    throw new Error(
      '[reframe] Host not initialized. Call setHost(adapter) before using the engine.'
    );
  }
  return _host;
}

/** Run `fn` with a scoped host (preferred in Node MCP handlers; see `packages/core/src/spec/host-context.ts`). */
export function runWithHost<T>(host: IHost, fn: () => T): T {
  const store = getScopedHostStore();
  if (store) {
    return store.run(host, fn);
  }
  const prev = _host;
  setHost(host);
  try {
    return fn();
  } finally {
    if (prev !== null) {
      setHost(prev);
    } else {
      resetHost();
    }
  }
}

/** Async variant — keeps scoped host across `await` in the same MCP/HTTP request. */
export function runWithHostAsync<T>(host: IHost, fn: () => Promise<T>): Promise<T> {
  const store = getScopedHostStore();
  if (store) {
    return store.run(host, fn);
  }
  const prev = _host;
  setHost(host);
  return (async () => {
    try {
      return await fn();
    } finally {
      if (prev !== null) {
        setHost(prev);
      } else {
        resetHost();
      }
    }
  })();
}

/** Reset the host (for tests). */
export function resetHost(): void {
  _host = null;
}
