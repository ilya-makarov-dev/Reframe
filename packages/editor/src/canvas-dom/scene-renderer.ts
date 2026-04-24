/**
 * SceneRenderer v1 — minimal interface.
 *
 * One SceneRenderer renders one scene into one host element. The existing
 * `createSceneRenderer` (renderer.ts) is an IframeSceneRenderer — it mounts
 * an iframe, loads `/preview/<sceneId>`, subscribes to SSE for that scene.
 *
 * This file formalizes the shape so a CompositionRenderer can mount N
 * SceneRenderer instances side-by-side for the 'variants' kind.
 *
 * v1 scope: variants composition only (N IframeSceneRenderers laid out
 * side-by-side by CompositionRenderer). Parked for v2 (activated on
 * chat-signal from a real user use-case):
 *
 *   - PeerElementRenderer (H5 overlay) — canvas sibling atop base iframe
 *   - SharedIframeRenderer (component instancing) — single doc + instances
 *   - VirtualizedGridRenderer (sampler ≥10 cells) — render only visible cells
 *   - OverrideLayer (component detach/propagate) — weeks-scale spike
 *
 * Do not extend this interface to anticipate those variants. Extend it
 * when the first real use-case arrives for one of them.
 */

export interface SceneRendererHandle {
  /** Underlying iframe (IframeSceneRenderer) or host element (future renderers). */
  readonly element: HTMLElement;
  /** Force re-fetch + re-render. Returns when DOM is updated. */
  reload(): Promise<void>;
  /** Tear down listeners + remove from DOM. */
  destroy(): void;
}

export interface SceneRenderer {
  /**
   * Mount the scene into `host`. Returns a handle for reload/destroy.
   * Host is expected to be empty — renderer takes full control of it.
   */
  mount(host: HTMLElement): SceneRendererHandle;
}

/**
 * Adapter around the existing createSceneRenderer — presents it as a
 * SceneRenderer interface implementation. This is the v1 renderer type
 * used by CompositionRenderer for both 'single' and 'variants' kinds.
 */
import { createSceneRenderer } from './renderer.js';

export interface IframeSceneRendererOptions {
  sceneId: string;
  sourceUrl?: string;
  onLoad?: (iframe: HTMLIFrameElement) => void;
  onSceneChange?: () => void;
}

export function iframeSceneRenderer(
  opts: IframeSceneRendererOptions,
): SceneRenderer {
  return {
    mount(host: HTMLElement): SceneRendererHandle {
      const r = createSceneRenderer({
        container: host,
        sceneId: opts.sceneId,
        sourceUrl: opts.sourceUrl,
        onLoad: opts.onLoad,
        onSceneChange: opts.onSceneChange,
      });
      return {
        element: r.iframe,
        reload: r.reload,
        destroy: r.destroy,
      };
    },
  };
}
