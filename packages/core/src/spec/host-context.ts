/**
 * **Host context — инвариант reframe (standalone)**
 *
 * Экспорт и аудит читают текущий host через [`getHost`](../../host/context.ts). Базовая инициализация: [`setHost`](../../host/context.ts)([`StandaloneHost`](../../adapters/standalone/adapter.ts)(graph)).
 *
 * **Предпочтительно в Node (MCP):** [`runWithHostAsync`](../../host/context.ts)(host, fn) — привязывает host к async-контексту запроса (`AsyncLocalStorage`), чтобы параллельные вызовы не затирали друг друга одним глобальным `setHost`. В браузере (Studio) `async_hooks` нет — `runWithHost*` делают setHost + восстановление предыдущего значения.
 *
 * **Правило:** при работе с двумя разными `SceneGraph` в одном handler (например diff A vs B) вложенный `runWithHostAsync` для «второй» сцены, либо явные `StandaloneNode` без зависимости от `getHost`.
 *
 * Карта `setHost` / `runWithHost`: MCP `inspect` / `export` / `compile` (основные пути), Studio `scene.ts`, `createSceneFromJson`, CLI adapt.
 *
 * @module
 */

export {};
