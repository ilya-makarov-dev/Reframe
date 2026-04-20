/**
 * Project grouping — auto-infer which scenes belong to the same
 * "project" (in the Figma sense: a file with multiple artboards).
 *
 * Reframe's scene store is a flat list. Users end up with 50+ scenes
 * after running reframe_vary on a source scene, and the dashboard
 * becomes unusable. This helper reconstructs project structure from
 * existing metadata:
 *
 *   1. Explicit `variantOf` meta (set by reframe_vary / clone op) —
 *      the parent scene is the project owner.
 *   2. Common slug prefix — "nightmarket", "nm-spotify", "nm-grid-…"
 *      all share the "nm" prefix, so they form a project rooted at the
 *      scene with the shortest matching name.
 *   3. Fallback — every scene without siblings is its own one-member
 *      project.
 *
 * Pure function — no I/O, just grouping logic. Callers pass the scene
 * list from `listSessionScenes()` + optional `getScene` resolver for
 * meta.variantOf.
 */

export interface SceneLike {
  id: string;
  slug: string;
  name: string;
  width?: number;
  height?: number;
  nodes?: number;
}

export interface ProjectGroup {
  /** Stable id used in URLs (/platform/project/:slug) */
  slug: string;
  /** Human label — the owner scene's name */
  name: string;
  /** The "canonical" scene of the project — usually the original the
   *  others were derived from. */
  ownerId: string;
  /** All scenes belonging to this project, including the owner. */
  members: SceneLike[];
  /** Count excluding the owner (how many variants live under it). */
  variantCount: number;
}

/**
 * Extract the likely project prefix from a slug.
 *
 * Examples:
 *   nightmarket              → nightmarket
 *   nightmarket-spotify      → nightmarket
 *   nm-spotify               → nm
 *   nm-spotify-v5            → nm
 *   nm-grid-spotify-d0-85-r  → nm
 *
 * Rule: take the first token (split on `-` or `_`). If only one token,
 * use the full slug. This is a coarse heuristic; explicit variantOf
 * metadata overrides it.
 */
function inferProjectKey(slug: string): string {
  const match = slug.match(/^([a-z0-9]+)/i);
  return match ? match[1].toLowerCase() : slug.toLowerCase();
}

/**
 * Build ProjectGroup list from flat scene list.
 *
 * @param scenes  flat list from listSessionScenes
 * @param getVariantOf  optional resolver that returns the parent scene
 *                      id for a given scene, from meta.variantOf. Used
 *                      when explicit lineage is available.
 */
export function groupScenesIntoProjects(
  scenes: SceneLike[],
  getVariantOf?: (sceneId: string) => string | undefined,
): ProjectGroup[] {
  if (scenes.length === 0) return [];

  // Build a map of slug → index for variantOf resolution (the meta
  // field stores the source scene ID, which we need to resolve to a
  // project group key).
  const slugById = new Map<string, string>();
  for (const s of scenes) slugById.set(s.id, s.slug);

  // Two-pass grouping. Pass 1: assign a tentative key per scene from
  // either explicit variantOf lineage or the shared-prefix heuristic,
  // and tally how many scenes land on each prefix. Pass 2: promote any
  // prefix that only one scene claims to use its full slug as its key
  // instead — a "group of one" is not a group, and grouping distinct
  // standalone scenes just because they happen to share a first token
  // (e.g. `qa-a-run1`, `qa-b-run1`, `qa-c-run1` all collapsing into one
  // "qa" project) breaks URL-level isolation: only the owner's
  // `/platform/project/<slug>` resolves and everyone else 404s. This
  // also caused the designer-qa parallel sweep to lose bucket
  // isolation — see the smell table.
  interface TentativeKey { key: string; fromVariant: boolean; }
  const tentative = new Map<SceneLike, TentativeKey>();
  const prefixCount = new Map<string, number>();

  for (const scene of scenes) {
    let key: string | undefined;
    let fromVariant = false;

    if (getVariantOf) {
      let cursor: string | undefined = scene.id;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const parent = getVariantOf(cursor);
        if (!parent) break;
        cursor = parent;
      }
      if (cursor && cursor !== scene.id) {
        const parentSlug = slugById.get(cursor);
        if (parentSlug) { key = parentSlug; fromVariant = true; }
      }
    }

    if (!key) key = inferProjectKey(scene.slug);

    tentative.set(scene, { key, fromVariant });
    prefixCount.set(key, (prefixCount.get(key) ?? 0) + 1);
  }

  const groups = new Map<string, SceneLike[]>();
  const ownerCandidates = new Map<string, SceneLike>();

  for (const scene of scenes) {
    const t = tentative.get(scene)!;
    // Demote a prefix group of one to a full-slug group so it becomes
    // its own project. Variant-linked keys stay grouped regardless of
    // count — an explicit variantOf parent ID always means "same
    // project" even if currently only one variant exists.
    const key = t.fromVariant || (prefixCount.get(t.key) ?? 0) > 1
      ? t.key
      : scene.slug;

    let members = groups.get(key);
    if (!members) {
      members = [];
      groups.set(key, members);
    }
    members.push(scene);

    // The owner is the scene with the shortest slug in the group
    // (usually the canonical original) — "nightmarket" wins over
    // "nm-spotify-v5".
    const current = ownerCandidates.get(key);
    if (!current || scene.slug.length < current.slug.length) {
      ownerCandidates.set(key, scene);
    }
  }

  // Flatten groups → ProjectGroup[]
  const result: ProjectGroup[] = [];
  for (const [key, members] of groups) {
    const owner = ownerCandidates.get(key)!;
    result.push({
      slug: owner.slug, // use the owner slug as the project URL key
      name: owner.name || owner.slug,
      ownerId: owner.id,
      members: sortMembers(members, owner.id),
      variantCount: members.length - 1,
    });
  }

  // Sort projects: biggest group first (most variants), then alpha.
  result.sort((a, b) => {
    if (b.variantCount !== a.variantCount) return b.variantCount - a.variantCount;
    return a.name.localeCompare(b.name);
  });

  return result;
}

/** Sort members: owner first, then by slug. */
function sortMembers(members: SceneLike[], ownerId: string): SceneLike[] {
  return [...members].sort((a, b) => {
    if (a.id === ownerId) return -1;
    if (b.id === ownerId) return 1;
    return a.slug.localeCompare(b.slug);
  });
}

/** Find a project by its URL slug. Returns undefined if not found. */
export function findProjectBySlug(
  projects: ProjectGroup[],
  slug: string,
): ProjectGroup | undefined {
  return projects.find(p => p.slug === slug);
}
