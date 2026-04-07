/**
 * Session context — intelligence that accumulates across MCP tool calls.
 *
 * Three systems working together (inspired by Claude Code's context assembly):
 *
 * 1. **Cache layer** — LRU for parsed DESIGN.md, semantic types, layouts.
 *    Like Claude Code's FileStateCache: avoid repeated expensive work.
 *
 * 2. **Scene lifecycle tracker** — knows what's been done to each scene
 *    (imported → audited → fixed → asserted → animated → exported).
 *    Like Claude Code's readFileState that tracks which files were read.
 *
 * 3. **Session advisor** — analyzes current state and recommends next actions.
 *    Like Claude Code's PromptSuggestion, but deterministic (no LLM needed).
 *    Priority-by-recency: recent scenes/issues matter more than old.
 *
 * Lifecycle:
 *   MCP server = child process of Claude Code / any MCP client.
 *   Session lives for the duration of the process.
 *   Restart = clean slate. No persistence, no spam.
 *   Within session: LRU bounds prevent memory bloat.
 */

import { createHash } from 'crypto';
import type { DesignSystem } from '../../core/src/design-system/index.js';
import type { BannerLayoutProfile } from '../../core/src/resize/layout-profile/types.js';

// ─── Types ────────────────────────────────────────────────────

export interface AuditHistoryEntry {
  sceneId: string;
  sceneName: string;
  timestamp: number;
  issueCount: number;
  fixCount: number;
  passed: boolean;
  rules: string[];
}

export interface SessionStats {
  totalImports: number;
  totalAudits: number;
  totalExports: number;
  totalWorkflows: number;
  commonIssues: Map<string, number>;
  toolCallOrder: string[];
}

/** What has been done to a scene — its position in the pipeline. */
export interface SceneLifecycle {
  sceneId: string;
  name: string;
  size: string;
  createdAt: number;
  imported: boolean;
  audited: boolean;
  auditPassed: boolean | null;  // null = not audited yet
  issueCount: number;
  fixCount: number;
  asserted: boolean;
  animated: boolean;
  exported: Set<string>;        // formats exported ('html', 'svg', etc.)
  adapted: boolean;
  diffed: boolean;
  hasDesignSystem: boolean;     // was DESIGN.md used?
}

/** A recommended action for the agent. */
export interface Recommendation {
  priority: number;             // 1 = highest
  action: string;               // human-readable description
  tool: string;                 // MCP tool name
  params: Record<string, any>;  // suggested parameters
  reason: string;               // why this is recommended
}

// ─── LRU Cache ────────────────────────────────────────────────

class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: K): boolean { return this.map.has(key); }
  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}

// ─── Session Context ──────────────────────────────────────────

class SessionContext {
  // ── Caches ───────────────────────────────────────────────
  readonly designSystems = new LRUCache<string, DesignSystem>(8);
  readonly semantics = new LRUCache<string, Map<string, string>>(32);
  readonly layouts = new LRUCache<string, BannerLayoutProfile>(32);

  // ── Scene Lifecycle ──────────────────────────────────────
  readonly sceneLifecycles = new Map<string, SceneLifecycle>();

  // ── Audit History ────────────────────────────────────────
  readonly auditHistory: AuditHistoryEntry[] = [];

  // ── Stats ────────────────────────────────────────────────
  readonly stats: SessionStats = {
    totalImports: 0,
    totalAudits: 0,
    totalExports: 0,
    totalWorkflows: 0,
    commonIssues: new Map(),
    toolCallOrder: [],
  };

  // Has the agent provided a DESIGN.md at any point?
  private _hasDesignMd = false;
  get hasDesignMd(): boolean { return this._hasDesignMd; }

  // ── Active Brand ────────────────────────────────────────
  private _activeBrand: string | null = null;
  private _activeDesignMd: string | null = null;
  private _activeDesignSystem: DesignSystem | null = null;

  get activeBrand(): string | null { return this._activeBrand; }
  get activeDesignMd(): string | null { return this._activeDesignMd; }
  get activeDesignSystem(): DesignSystem | null { return this._activeDesignSystem; }

  /** Set the active brand — persists across all subsequent tool calls. */
  setBrand(brand: string, designMd: string, ds: DesignSystem): void {
    this._activeBrand = brand;
    this._activeDesignMd = designMd;
    this._activeDesignSystem = ds;
    this._hasDesignMd = true;
  }

  // ── Design System Cache ──────────────────────────────────

  hashDesignMd(md: string): string {
    return createHash('md5').update(md).digest('hex').slice(0, 12);
  }

  getOrParseDesignMd(md: string, parseFn: (md: string) => DesignSystem): DesignSystem {
    this._hasDesignMd = true;
    const key = this.hashDesignMd(md);
    let ds = this.designSystems.get(key);
    if (!ds) {
      ds = parseFn(md);
      this.designSystems.set(key, ds);
    }
    return ds;
  }

  // ── Semantic Cache ───────────────────────────────────────

  getSemantics(sceneId: string): Map<string, string> | undefined {
    return this.semantics.get(sceneId);
  }

  setSemantics(sceneId: string, types: Map<string, string>): void {
    this.semantics.set(sceneId, types);
  }

  // ── Layout Cache ─────────────────────────────────────────

  getLayout(sceneId: string): BannerLayoutProfile | undefined {
    return this.layouts.get(sceneId);
  }

  setLayout(sceneId: string, profile: BannerLayoutProfile): void {
    this.layouts.set(sceneId, profile);
  }

  // ── Scene Lifecycle Tracking ─────────────────────────────

  /** Register a newly imported scene. */
  trackImport(sceneId: string, name: string, width: number, height: number, withDesignMd: boolean): void {
    this.sceneLifecycles.set(sceneId, {
      sceneId,
      name,
      size: `${Math.round(width)}×${Math.round(height)}`,
      createdAt: Date.now(),
      imported: true,
      audited: false,
      auditPassed: null,
      issueCount: 0,
      fixCount: 0,
      asserted: false,
      animated: false,
      exported: new Set(),
      adapted: false,
      diffed: false,
      hasDesignSystem: withDesignMd,
    });
    this.stats.totalImports++;
  }

  /** Mark scene as audited. */
  trackAudit(sceneId: string, passed: boolean, issueCount: number, fixCount: number): void {
    const lc = this.sceneLifecycles.get(sceneId);
    if (lc) {
      lc.audited = true;
      lc.auditPassed = passed;
      lc.issueCount = issueCount;
      lc.fixCount = fixCount;
    }
  }

  /** Mark scene as asserted. */
  trackAssert(sceneId: string): void {
    const lc = this.sceneLifecycles.get(sceneId);
    if (lc) lc.asserted = true;
  }

  /** Mark scene as animated. */
  trackAnimate(sceneId: string): void {
    const lc = this.sceneLifecycles.get(sceneId);
    if (lc) lc.animated = true;
  }

  /** Mark scene as exported in a format. */
  trackExport(sceneId: string, format: string): void {
    const lc = this.sceneLifecycles.get(sceneId);
    if (lc) lc.exported.add(format);
    this.stats.totalExports++;
  }

  /** Mark scene as adapted. */
  trackAdapt(sceneId: string): void {
    const lc = this.sceneLifecycles.get(sceneId);
    if (lc) lc.adapted = true;
  }

  /** Mark scene as diffed. */
  trackDiff(sceneIdA: string, sceneIdB: string): void {
    const a = this.sceneLifecycles.get(sceneIdA);
    const b = this.sceneLifecycles.get(sceneIdB);
    if (a) a.diffed = true;
    if (b) b.diffed = true;
  }

  // ── Audit History ────────────────────────────────────────

  recordAudit(entry: AuditHistoryEntry): void {
    this.auditHistory.push(entry);
    for (const rule of entry.rules) {
      this.stats.commonIssues.set(rule, (this.stats.commonIssues.get(rule) ?? 0) + 1);
    }
    this.stats.totalAudits++;
    this.trackAudit(entry.sceneId, entry.passed, entry.issueCount, entry.fixCount);
  }

  topIssues(n = 5): Array<{ rule: string; count: number }> {
    return [...this.stats.commonIssues.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([rule, count]) => ({ rule, count }));
  }

  // ── Stats ────────────────────────────────────────────────

  recordToolCall(toolName: string): void {
    this.stats.toolCallOrder.push(toolName);
    if (this.stats.toolCallOrder.length > 100) this.stats.toolCallOrder.shift();
  }

  recordImport(): void { this.stats.totalImports++; }
  recordExport(): void { this.stats.totalExports++; }
  recordWorkflow(): void { this.stats.totalWorkflows++; }

  // ── Session Advisor ──────────────────────────────────────

  /**
   * Generate contextual recommendations based on current session state.
   * Priority-by-recency: recent scenes matter more.
   * Uses actual scene data, audit history, and timing for intelligent suggestions.
   * Returns up to 5 most important recommendations.
   */
  getRecommendations(): Recommendation[] {
    const recs: Recommendation[] = [];
    const now = Date.now();
    const scenes = [...this.sceneLifecycles.values()]
      .sort((a, b) => b.createdAt - a.createdAt);  // newest first

    if (scenes.length === 0) {
      recs.push({
        priority: 1,
        action: 'Import your first design',
        tool: 'reframe_compile',
        params: { html: '<your HTML>', exports: ['html'] },
        reason: 'No scenes in session. Start by importing HTML — reframe_compile handles import + audit + export in one call.',
      });
      if (!this._hasDesignMd) {
        recs.push({
          priority: 2,
          action: 'Extract brand rules from existing website',
          tool: 'reframe_extract_design',
          params: { html: '<website HTML>' },
          reason: 'No DESIGN.md in session. Extract brand rules first for better audit results.',
        });
      }
      return recs.slice(0, 5);
    }

    // ── Stale scenes: imported > 2 min ago but never audited ──
    const staleUnaudited = scenes.filter(s => !s.audited && (now - s.createdAt) > 120_000);
    const freshUnaudited = scenes.filter(s => !s.audited && (now - s.createdAt) <= 120_000);

    if (staleUnaudited.length > 0) {
      const names = staleUnaudited.slice(0, 3).map(s => `"${s.name}"`).join(', ');
      recs.push({
        priority: 1,
        action: `Audit ${staleUnaudited.length} stale scene(s): ${names}`,
        tool: staleUnaudited.length === 1 ? 'reframe_inspect' : 'reframe_compile',
        params: staleUnaudited.length === 1
          ? { sceneId: staleUnaudited[0].sceneId }
          : { audit: true },
        reason: `${staleUnaudited.length} scene(s) imported over 2 minutes ago without audit. Issues may be accumulating.`,
      });
    } else if (freshUnaudited.length > 0) {
      if (freshUnaudited.length === 1) {
        const s = freshUnaudited[0];
        recs.push({
          priority: 1,
          action: `Audit "${s.name}" (${s.size})`,
          tool: 'reframe_inspect',
          params: { sceneId: s.sceneId },
          reason: `Scene "${s.name}" (${s.sceneId}) was imported but never audited.`,
        });
      } else {
        recs.push({
          priority: 1,
          action: `Audit ${freshUnaudited.length} unaudited scenes`,
          tool: 'reframe_compile',
          params: { audit: true },
          reason: `${freshUnaudited.length} scenes imported but not audited.`,
        });
      }
    }

    // ── Systemic pattern: same rule failing in 3+ scenes → prompt-level fix ──
    const topIssues = this.topIssues(3);
    const systemicIssue = topIssues.find(i => i.count >= 3);
    if (systemicIssue) {
      // Find which scenes had this issue
      const affectedScenes = this.auditHistory
        .filter(h => h.rules.includes(systemicIssue.rule))
        .map(h => h.sceneName);
      const uniqueScenes = [...new Set(affectedScenes)];
      const fix = issueToFix(systemicIssue.rule);

      recs.push({
        priority: 1,
        action: `Fix systemic "${systemicIssue.rule}" (${systemicIssue.count}× in ${uniqueScenes.length} scenes)`,
        tool: 'reframe_prompt',
        params: {},
        reason: `"${systemicIssue.rule}" recurs in scenes: ${uniqueScenes.slice(0, 4).join(', ')}. ${fix ?? 'Adjust HTML generation to prevent this.'}`,
      });
    }

    // ── Scenes with issues that could use auto-fix — reference specific rules ──
    const withIssues = scenes.filter(s => s.audited && !s.auditPassed && s.fixCount === 0);
    for (const s of withIssues.slice(0, 2)) {
      // Find what rules failed for this scene
      const lastAudit = [...this.auditHistory].reverse().find(h => h.sceneId === s.sceneId);
      const failedRules = lastAudit?.rules.slice(0, 3).join(', ') ?? 'unknown';
      recs.push({
        priority: 2,
        action: `Auto-fix ${s.issueCount} issues in "${s.name}" (${failedRules})`,
        tool: 'reframe_compile',
        params: { audit: { autoFix: true } },
        reason: `Scene "${s.name}" (${s.sceneId}) has ${s.issueCount} unfixed issues: ${failedRules}. Re-import with autoFix: true.`,
      });
    }

    // ── No DESIGN.md but scenes exist ──
    if (!this._hasDesignMd && scenes.length > 0) {
      const hasDesignIssues = topIssues.some(i =>
        ['font-in-palette', 'color-in-palette'].includes(i.rule)
      );
      recs.push({
        priority: hasDesignIssues ? 1 : 2,
        action: 'Add DESIGN.md for brand compliance',
        tool: 'reframe_extract_design',
        params: {},
        reason: hasDesignIssues
          ? 'Font/color palette issues detected but no DESIGN.md loaded — these checks need brand rules to auto-fix.'
          : 'No design system loaded. Brand compliance checks (font/color palette) are disabled.',
      });
    }

    // ── Clean scenes not yet exported ──
    const cleanNotExported = scenes.filter(s =>
      s.audited && (s.auditPassed || s.fixCount > 0) && s.exported.size === 0
    );
    if (cleanNotExported.length > 0) {
      const names = cleanNotExported.slice(0, 3).map(s => `"${s.name}"`).join(', ');
      recs.push({
        priority: 3,
        action: `Export ${cleanNotExported.length} clean scene(s): ${names}`,
        tool: cleanNotExported.length === 1 ? 'reframe_export' : 'reframe_compile',
        params: cleanNotExported.length === 1
          ? { sceneId: cleanNotExported[0].sceneId }
          : { exports: ['html', 'svg'] },
        reason: `${cleanNotExported.length} scene(s) passed audit but haven't been exported yet.`,
      });
    }

    // ── Multiple scenes that haven't been compared ──
    const auditedScenes = scenes.filter(s => s.audited);
    if (auditedScenes.length >= 2 && !scenes.some(s => s.diffed)) {
      recs.push({
        priority: 4,
        action: `Compare "${auditedScenes[0].name}" vs "${auditedScenes[1].name}"`,
        tool: 'reframe_inspect',
        params: { sceneAId: auditedScenes[0].sceneId, sceneBId: auditedScenes[1].sceneId },
        reason: `${auditedScenes.length} scenes audited but never compared. Diff to catch structural inconsistencies.`,
      });
    }

    // ── Cross-size batch ──
    if (auditedScenes.length >= 3 && this.stats.totalWorkflows === 0) {
      recs.push({
        priority: 4,
        action: `Cross-size consistency check on ${auditedScenes.length} scenes`,
        tool: 'reframe_compile',
        params: { crossSizeAudit: true },
        reason: `${auditedScenes.length} scenes available. Check color, font, and CTA consistency across sizes.`,
      });
    }

    // ── Animation consistency ──
    const hasAnimation = scenes.some(s => s.animated);
    if (hasAnimation) {
      const notAnimated = scenes.filter(s => !s.animated && s.audited);
      if (notAnimated.length > 0) {
        const names = notAnimated.slice(0, 3).map(s => `"${s.name}"`).join(', ');
        recs.push({
          priority: 5,
          action: `Add animation to ${notAnimated.length} scene(s): ${names}`,
          tool: 'reframe_export',
          params: { sceneId: notAnimated[0].sceneId },
          reason: 'Some scenes animated, others not. Add motion for consistency.',
        });
      }
    }

    return recs
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 5);
  }

  // ── Summary ──────────────────────────────────────────────

  /** Full session intelligence: summary + lifecycle + recommendations. */
  getSummary(): string | null {
    const s = this.stats;
    if (s.totalImports === 0 && s.totalAudits === 0 && this.sceneLifecycles.size === 0) return null;

    const lines: string[] = [];

    // Stats
    const parts: string[] = [];
    if (s.totalImports > 0) parts.push(`${s.totalImports} imports`);
    if (s.totalAudits > 0) parts.push(`${s.totalAudits} audits`);
    if (s.totalExports > 0) parts.push(`${s.totalExports} exports`);
    if (s.totalWorkflows > 0) parts.push(`${s.totalWorkflows} workflows`);
    if (parts.length > 0) lines.push(`Activity: ${parts.join(', ')}`);

    // Common issues
    const top = this.topIssues(3);
    if (top.length > 0) {
      lines.push(`Top issues: ${top.map(t => `${t.rule} (${t.count}×)`).join(', ')}`);
    }

    // Cache status
    const caches: string[] = [];
    if (this.designSystems.size > 0) caches.push(`${this.designSystems.size} design system(s)`);
    if (this.semantics.size > 0) caches.push(`${this.semantics.size} semantic map(s)`);
    if (caches.length > 0) lines.push(`Cached: ${caches.join(', ')}`);

    // Scene lifecycle summary
    const scenes = [...this.sceneLifecycles.values()];
    if (scenes.length > 0) {
      lines.push('');
      lines.push('Scenes:');
      for (const lc of scenes) {
        const stages: string[] = [];
        if (lc.imported) stages.push('imported');
        if (lc.audited) stages.push(lc.auditPassed ? 'audit:PASS' : `audit:${lc.issueCount} issues`);
        if (lc.fixCount > 0) stages.push(`${lc.fixCount} fixed`);
        if (lc.asserted) stages.push('asserted');
        if (lc.animated) stages.push('animated');
        if (lc.adapted) stages.push('adapted');
        if (lc.exported.size > 0) stages.push(`exported:${[...lc.exported].join(',')}`);
        if (lc.diffed) stages.push('diffed');
        lines.push(`  ${lc.sceneId} "${lc.name}" ${lc.size} → ${stages.join(' → ')}`);
      }
    }

    // Recommendations
    const recs = this.getRecommendations();
    if (recs.length > 0) {
      lines.push('');
      lines.push('Recommended next:');
      for (const rec of recs) {
        lines.push(`  ${rec.priority}. ${rec.action}`);
        lines.push(`     → ${rec.tool}(${formatParams(rec.params)})`);
        lines.push(`     ${rec.reason}`);
      }
    }

    return lines.join('\n');
  }

  /** Reset session (for testing). */
  reset(): void {
    this.designSystems.clear();
    this.semantics.clear();
    this.layouts.clear();
    this.sceneLifecycles.clear();
    this.auditHistory.length = 0;
    this._hasDesignMd = false;
    this.stats.totalImports = 0;
    this.stats.totalAudits = 0;
    this.stats.totalExports = 0;
    this.stats.totalWorkflows = 0;
    this.stats.commonIssues.clear();
    this.stats.toolCallOrder.length = 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Map common audit issue to actionable fix suggestion. */
function issueToFix(rule: string): string | null {
  const fixes: Record<string, string> = {
    'contrast-minimum': 'Darken text or lighten backgrounds. Update DESIGN.md primary/text colors.',
    'text-overflow': 'Reduce font sizes or container widths. Check responsive sizing.',
    'min-font-size': 'Increase small text sizes. Minimum 10px recommended for readability.',
    'no-empty-text': 'Remove empty text nodes or add content.',
    'no-zero-size': 'Set explicit width/height on elements.',
    'font-in-palette': 'Use fonts from DESIGN.md. Check font-family in your HTML.',
    'color-in-palette': 'Use colors from DESIGN.md. Check hex values in your HTML.',
    'node-overflow': 'Child elements overflow parent. Check absolute positioning or flex sizing.',
    'no-hidden-nodes': 'Hidden nodes found. Remove or make visible.',
    'min-touch-target': 'Interactive elements too small. Minimum 44×44px for accessibility.',
    'visual-hierarchy': 'Title should be largest text. Check font-size ordering.',
    'cta-visibility': 'CTA button may be too small or low-contrast. Make it prominent.',
  };
  return fixes[rule] ?? null;
}

/** Format params for display. */
function formatParams(params: Record<string, any>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (typeof v === 'string' && v.startsWith('<')) return `${k}: ...`;
      if (typeof v === 'object') return `${k}: {...}`;
      return `${k}: ${JSON.stringify(v)}`;
    });
  return entries.join(', ');
}

// ─── Singleton ────────────────────────────────────────────────

const session = new SessionContext();
export function getSession(): SessionContext { return session; }
export type { SessionContext };
