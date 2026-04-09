/**
 * **Scene envelope (канон)** — один контракт JSON для сессии MCP, HTTP PUT/GET, диска и Studio `loadSceneJson`.
 *
 * ## Тип
 * Используйте {@link SceneJSON} из `serialize.ts` (алиас ниже: `SceneEnvelope`).
 *
 * ## Поля
 * - **`version`** — `SERIALIZE_VERSION` (сейчас `2`). Старые файлы мигрируют через `migrateSceneJSON`.
 * - **`root`** — узел-корень (`INodeJSON` после миграции per-node: constraints, legacy поля).
 * - **`images`** — опционально, `hash → base64` растров; без ключа пустой `graph.images` после импорта только дерева.
 * - **`timeline`** — опционально; сериализованная анимация. Семантика **serializeGraph**:
 *   - Без `explicitTimelineKey`: ключ опущен, если нет таймлайна.
 *   - С `explicitTimelineKey: true` (Studio↔GET/PUT): ключ **всегда** есть — объект или JSON `null` «нет анимации».
 *
 * ## HTTP PUT `/scenes/:id` ([packages/mcp/src/http-server.ts](../../../mcp/src/http-server.ts))
 * Тело — тот же конверт минимум с `{ root }`. **`timeline`**: нет ключа → оставить сессионный таймлайн; `null` → очистить; объект → заменить.
 *
 * ## Проект на диске ([packages/core/src/project/io.ts](../project/io.ts))
 * Файлы `.reframe/scenes/*.scene.json` — полный `SceneJSON` после `migrateSceneJSON`.
 *
 * ## MCP `resolveScene({ scene })` ([packages/mcp/src/engine.ts](../../../mcp/src/engine.ts))
 * Конверт с `root` + опционально `images`/`timeline` → `deserializeScene`.
 *
 * ## Studio ([packages/studio/src/store/scene.ts](../../../studio/src/store/scene.ts))
 * `deserializeStudioSceneJson` → `deserializeScene` + fallback {@link importSceneNodeFallback} при исключении.
 *
 * ## Глобальный host (инвариант)
 * В одном Node-процессе «активный» {@link StandaloneHost} один на цепочку синхронных/async шагов одного вызова.
 * См. [host-context.ts](./host-context.ts).
 *
 * @module
 */

export type { SceneJSON as SceneEnvelope, SceneJSON, SerializeOptions, INodeJSON } from '../serialize.js';
export { SERIALIZE_VERSION, importSceneNodeFallback } from '../serialize.js';

/** Чеклист при добавлении полей на SceneNode / INodeJSON */
export const SCENE_NODE_CHANGE_CHECKLIST = `
Scene node / serialize changes — verify:
1. serialize.ts: serializeSceneNode / compact defaults if needed
2. migrateScene or migrateSceneJSON for old JSON on disk
3. applyImportedNodeLayoutProps or new normalize* if loose import needs it
4. StandaloneNode / SceneGraph.createNode compatibility
5. Roundtrip test in serialize.test.ts (or project fixture)
`;
