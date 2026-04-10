import { type INode, type IFontName, NodeType, MIXED } from '../../host';
import { getHost } from '../../host/context';
import { GuideElement, BannerElementType, GuideSize } from '../contracts/types';
import { buildSourceToResultNodeIdMap } from './node-id-mapper';
import { scaleElement } from '../scaling/scaler';
import { getBoundsInFrame, collectAllDescendants } from './layout-utils';
import type { DesignSystem } from '../../design-system/types';
import { fontSizeMatchesRole, typographyRolesForSlot } from '../../design-system/types';
import {
  hasVisibleImageFill,
  isEffectivelyNoFill,
  hasVisibleGeometryStroke,
  hasStructuralWrapperEffects
} from './semantic-node-paint';
import { isAncestor, depth, depthFromBannerAncestor } from './semantic-slot-geometry';
import { looksLikeButtonHitRectBounds } from './semantic-logo-cta';

export {
  hasVisibleImageFill,
  subtreeHasVisibleImageFill,
  isEffectivelyNoFill,
  hasVisibleGeometryStroke,
  hasStructuralWrapperEffects
} from './semantic-node-paint';

export {
  getButtonFitSizeInFrame,
  getBestButtonHitRectBoundsInNode,
  getCtaGroupWrapper,
  looksLikeCtaLabelText,
  subtreeHasButtonChromeLabel,
  subtreeHasCtaLabelText,
  masterButtonSubtreeHasCtaLabelText,
  looksLikeButtonHitRect,
  looksLikeButtonHitRectBounds,
  subtreeHasCtaRectTextOverlapStack,
  promoteButtonPlacementToChromeRoot,
  isLikelyCornerLogoLockup,
  findDetachedCTARectTextPair,
  removeDetachedCTALabelSiblings,
  logoCornerDistanceNorm,
  logoInstanceStructuralBoost,
  logoLockupStructureBoost,
  looksLikeLogoTypographyText,
  isCornerPillNotLogo,
  isLikelyWideHeroChunkNotLogo,
  logoGraphicCandidateScore,
  tryPickLogoNode,
  tryPickLogoDesperateFallback,
  tryPickLogoLastResortEdgeInstance,
  tryPickLogoTextNode,
  buttonUniformScaleForSlot
} from './semantic-logo-cta';

export {
  countGlowBlurPlateLeavesInSubtree,
  isEllipseGlowIllustrationContainer,
  isGlowBlurPlate,
  isNonEllipseHeroShape,
  subtreeHasHeroOrNonEllipseVisual,
  isEllipseOnlyClusterContainer,
  isGlowDecorClusterContainer
} from './semantic-decor-containers';

export type { RememberLayoutMetrics } from './semantic-slot-geometry';
export {
  alignVisualCenterToFramePoint,
  boundsOverlapPixels,
  countDirectEllipseChildren,
  countEllipseLeavesInSubtree,
  depth,
  depthFromBannerAncestor,
  horizontalOverlapFraction,
  isAncestor,
  isDescendantOfFrameForAuto,
  snapAgeRatingVisualToRememberSlot,
  slotUniformScaleFit,
  slotUniformScaleFitExactSession
} from './semantic-slot-geometry';

export const SLOT_ORDER: BannerElementType[] = [
  'background', 'title', 'description', 'logo', 'button', 'disclaimer', 'ageRating', 'other'
];

export function slotOrderIndex(t: BannerElementType): number {
  const i = SLOT_ORDER.indexOf(t);
  return i >= 0 ? i : SLOT_ORDER.length;
}

export function nodeOrDescendantInSet(n: INode, ids: Set<string>): boolean {
  if (ids.has(n.id)) return true;
  if (n.children) {
    for (const child of n.children) {
      if (nodeOrDescendantInSet(child, ids)) return true;
    }
  }
  return false;
}

/**
 * Empty shells after hoist (as in oLD/guide-scaler): depth-first — stable removal.
 */
export function removeEmptyFrameGroupsUnder(root: INode): void {
  let changed = true;
  while (changed) {
    changed = false;
    const nodes = collectAllDescendants(root).slice(1);
    nodes.sort((a, b) => depthFromBannerAncestor(b, root) - depthFromBannerAncestor(a, root));
    for (const n of nodes) {
      if (n.removed) continue;
      if (n.type !== NodeType.Frame && n.type !== NodeType.Group) continue;
      const ch = (n.children ?? []).filter(c => !c.removed);
      if (ch.length > 0) continue;
      try {
        n.remove!();
        changed = true;
      } catch (_) {}
    }
  }
}

/**
 * Unwrap only **transparent** wrapper with a single nested FRAME/GROUP (as in oLD).
 * Incorrect version unwrapped wrappers **with fills** -> broke button with gradient on FRAME.
 */
export function unwrapTransparentSingleChildContainer(wrapper: INode, root: INode): boolean {
  if (wrapper === root) return false;
  if (wrapper.type !== NodeType.Frame && wrapper.type !== NodeType.Group) return false;
  if (wrapper.type === NodeType.Frame && (wrapper as INode).clipsContent) return false;
  if (!isEffectivelyNoFill(wrapper)) return false;
  if (hasVisibleGeometryStroke(wrapper)) return false;
  if (hasStructuralWrapperEffects(wrapper)) return false;
  const ch = (wrapper.children ?? []).filter(c => !c.removed);
  if (ch.length !== 1) return false;
  const only = ch[0];
  if (only.type !== NodeType.Frame && only.type !== NodeType.Group) return false;
  const parent = wrapper.parent;
  if (!parent || !parent.insertChild) return false;
  try {
    const idx = parent.children ? Array.from(parent.children).indexOf(wrapper) : -1;
    if (idx < 0) return false;
    const wx = wrapper.x;
    const wy = wrapper.y;
    const cx = only.x;
    const cy = only.y;
    parent.insertChild!(idx, only);
    only.x = Math.round(wx + cx);
    only.y = Math.round(wy + cy);
    wrapper.remove!();
    return true;
  } catch (_) {
    return false;
  }
}

export function collapseRedundantNestedFramesUnderBanner(root: INode): void {
  removeEmptyFrameGroupsUnder(root);
  for (let g = 0; g < 64; g++) {
    const frames = collectAllDescendants(root).filter(
      n =>
        n !== root &&
        (n.type === NodeType.Frame || n.type === NodeType.Group) &&
        !('removed' in n && n.removed)
    ) as INode[];
    frames.sort((a, b) => depthFromBannerAncestor(b, root) - depthFromBannerAncestor(a, root));
    let any = false;
    for (const fr of frames) {
      if (unwrapTransparentSingleChildContainer(fr, root)) {
        any = true;
        break;
      }
    }
    if (!any) break;
  }
  removeEmptyFrameGroupsUnder(root);
}

/** Like `oLD/guide-scaler.ts`: distance from age-text candidate to normalized master slot center. */
export function scoreAgeLabelSourceVsMasterSlot(
  s: INode,
  srcFrame: INode,
  masterNx: number,
  masterNy: number
): number {
  const sW = Math.max(srcFrame.width, 1e-6);
  const sH = Math.max(srcFrame.height, 1e-6);
  const sb = getBoundsInFrame(s, srcFrame);
  const srcNx = (sb.x + sb.w / 2) / sW;
  const srcNy = (sb.y + sb.h / 2) / sH;
  let d = 1.25 * (masterNx - srcNx) ** 2 + (masterNy - srcNy) ** 2;
  if (srcNy < 0.66) d += 1.35;
  if (srcNx < 0.62) d += 0.65;
  const rightR = (sb.x + sb.w) / sW;
  if (rightR < 0.78) d += 0.45;
  return d;
}

export function collectAgePatternTextNodesInFrame(frame: INode): INode[] {
  const out: INode[] = [];
  for (const n of collectAllDescendants(frame)) {
    if (n.type === NodeType.Text) {
      const t = n;
      if (t.characters!.includes('18+') || t.characters!.includes('16+') || t.characters!.includes('0+')) {
        out.push(t);
      }
    }
  }
  return out;
}

export function readPrimaryFontSize(t: INode): number | null {
  if (t.fontSize === MIXED) return null;
  return t.fontSize as number;
}

export async function loadAllFontsForTextNode(t: INode): Promise<void> {
  const len = t.characters!.length;
  if (len === 0) {
    if (t.fontName !== MIXED) await getHost().loadFont(t.fontName as IFontName);
    return;
  }
  const fonts = t.getRangeAllFontNames!(0, len);
  await Promise.all(fonts.map((f: IFontName) => getHost().loadFont(f)));
}

export function isDescendantOfSemanticSlot(
  node: INode,
  frame: INode,
  slotMap: Map<string, BannerElementType>
): boolean {
  let cur: INode | null = node.parent;
  while (cur && cur !== frame) {
    if (slotMap.has(cur.id)) return true;
    cur = cur.parent;
  }
  return false;
}

export function overlapFrac(a: RectLike, b: RectLike): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h);
}

/**
 * Options for {@link assignSemanticTypes}.
 *
 * Default mode is single-slot (banner): each role picks at most one node,
 * matching the legacy figma-banner-resizer behavior. Pass `multiSlot: true`
 * for long-form content (emails, landing pages, docs) where one design has
 * many titles, many CTAs, multiple section backgrounds, etc.
 */
export interface AssignSemanticOptions {
  /** Permit multiple matches per semantic role. Default false. */
  multiSlot?: boolean;
}

/**
 * Slot heuristics as in `figma-banner-resizer` legacy + `oLD`: across all frame descendants, not a stub.
 * Optional DesignSystem param enables design-system-informed classification (higher confidence).
 */
export function assignSemanticTypes(
  nodes: INode[],
  frame: INode,
  ds?: DesignSystem,
  options?: AssignSemanticOptions,
): Map<string, BannerElementType> {
  const multiSlot = options?.multiSlot === true;
  const W = frame.width;
  const H = frame.height;
  const areaFrame = W * H;
  const result = new Map<string, BannerElementType>();

  const boundsMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of nodes) {
    boundsMap.set(node.id, getBoundsInFrame(node, frame));
  }

  const texts = nodes.filter(n => n.type === NodeType.Text);
  const withFills = nodes.filter(n => {
    if ('fills' in n && n.fills !== MIXED && n.fills && n.fills.length > 0) return true;
    return false;
  });
  const instances = nodes.filter(n => n.type === NodeType.Instance);
  const framesOrComponents = nodes.filter(n => n.type === NodeType.Frame || n.type === NodeType.Component);
  const groups = nodes.filter(n => n.type === NodeType.Group);

  // Background detection. In single mode the largest direct-child fill wins;
  // in multi mode every direct-child fill above the area threshold counts
  // (sectioned designs like emails have multiple full-width section bgs).
  const bgCandidates: Array<{ id: string; area: number }> = [];
  for (const node of withFills) {
    const b = boundsMap.get(node.id)!;
    const area = b.w * b.h;
    if (area > areaFrame * 0.25 && isDirectChild(node, frame)) {
      bgCandidates.push({ id: node.id, area });
    }
  }
  if (bgCandidates.length === 0) {
    // Fallback: a direct-child container that itself has fills, or whose
    // first child is a >25% rectangle with fills (covers the "wrapped bg"
    // pattern from imported HTML where the bg is a rect inside a section).
    for (const node of [...framesOrComponents, ...groups]) {
      if (!isDirectChild(node, frame)) continue;
      const b = boundsMap.get(node.id)!;
      const area = b.w * b.h;
      if (area < areaFrame * 0.25) continue;
      const selfFills = 'fills' in node && node.fills !== MIXED && node.fills && node.fills.length > 0;
      if (selfFills) {
        bgCandidates.push({ id: node.id, area });
        if (!multiSlot) break;
        continue;
      }
      if (node.children) {
        for (const child of node.children) {
          const cb = boundsMap.get(child.id);
          if (!cb) continue;
          const childArea = cb.w * cb.h;
          const childFills = 'fills' in child && child.fills !== MIXED && child.fills && child.fills.length > 0;
          if (childFills && childArea > areaFrame * 0.25) {
            bgCandidates.push({ id: node.id, area });
            break;
          }
        }
      }
      if (!multiSlot && bgCandidates.length > 0) break;
    }
  }
  bgCandidates.sort((a, b) => b.area - a.area);
  const bgPicks = multiSlot ? bgCandidates : bgCandidates.slice(0, 1);
  for (const bg of bgPicks) result.set(bg.id, 'background');

  for (const node of texts) {
    const t = node;
    const len = t.characters!.length;
    const b = boundsMap.get(node.id)!;
    const topR = b.y / H;
    const rightR = (b.x + b.w) / W;
    const fontSize = typeof t.fontSize === 'number' ? t.fontSize : 12;
    if (len <= 4 && (/\d+\+/.test(t.characters!) || (topR > 0.8 && rightR > 0.85 && fontSize < 16))) {
      result.set(node.id, 'ageRating');
      break;
    }
  }

  // For long-form designs, content height frequently exceeds the source frame
  // height (an HTML import with no explicit height inherits a 1080 default).
  // Computing y/H against the nominal frame loses meaning past 1.0, so derive
  // an effective content bottom from the union of all candidate bounds.
  const contentBottomCandidates = texts
    .map(t => boundsMap.get(t.id)!)
    .filter(b => b && b.h > 0);
  const contentBottom = contentBottomCandidates.length > 0
    ? Math.max(H, ...contentBottomCandidates.map(b => b.y + b.h))
    : H;

  const bottomTexts = texts
    .filter(t => !result.has(t.id))
    .map(t => {
      const tn = t;
      const fsNum = typeof tn.fontSize === 'number' ? tn.fontSize : 12;
      return {
        node: t,
        b: boundsMap.get(t.id)!,
        len: tn.characters!.length,
        fs: fsNum
      };
    })
    .filter(x => {
      // DS-informed: if DS defines disclaimer/caption fontSize, use it as upper bound
      let maxFs = 18;
      if (ds) {
        const disclaimerRule = ds.typography.hierarchy.find(r => r.role === 'disclaimer' || r.role === 'caption');
        if (disclaimerRule) maxFs = disclaimerRule.fontSize * 1.3;
      }
      // In multi mode tighten the size cap and use content-relative bottom so
      // body paragraphs in long emails don't get mass-tagged as disclaimers.
      const tightFs = multiSlot ? Math.min(14, maxFs) : maxFs;
      const yRel = (x.b.y + x.b.h) / contentBottom;
      const yThreshold = multiSlot ? 0.75 : 0.65;
      return yRel > yThreshold && x.len > 40 && x.fs < tightFs;
    })
    .sort((a, b) => b.b.y - a.b.y || b.len - a.len);
  // Multi mode: every text matching the bottom-of-content + tight size rule,
  // capped at 2 (multiple disclaimers are rare; cap suppresses runaway tags).
  // Single mode: the most-bottom one wins.
  const disclaimerPicks = multiSlot ? bottomTexts.slice(0, 2) : bottomTexts.slice(0, 1);
  for (const d of disclaimerPicks) result.set(d.node.id, 'disclaimer');

  // Logo detection. Multiple logos are rare even on long-form content
  // (header logo + footer logo at most), so multi mode just doesn't break
  // after the first match — single mode keeps `break` for backward compat.
  for (const node of instances) {
    if (result.has(node.id)) continue;
    const b = boundsMap.get(node.id)!;
    if (looksLikeButtonHitRectBounds(b, W, H)) continue;
    if (b.y / H < 0.25 && (b.w * b.h) / areaFrame < 0.2) {
      result.set(node.id, 'logo');
      if (!multiSlot) break;
    }
  }
  if (instances.length === 0) {
    const topSmall = nodes
      .filter(n => !result.has(n.id) && (n.type === NodeType.Frame || n.type === NodeType.Group))
      .filter(n => {
        const b = boundsMap.get(n.id)!;
        if (looksLikeButtonHitRectBounds(b, W, H)) return false;
        // Real logos sit in the very top strip (header row), not just
        // the "top 20%". Tightening this threshold keeps the fallback
        // from firing on hero sub-sections, feature icons, and
        // badges-on-cards.
        if (b.y / H >= 0.08) return false;
        if ((b.w * b.h) / areaFrame >= 0.08) return false;
        // Logo-ish proportions: slightly square or wider-than-tall,
        // never extreme strips. Navigation link wrappers end up ~60×16
        // (aspect ~3.75) and are NOT logos; footer columns end up
        // 0.2 × page (aspect ~0.2) and are NOT logos either.
        const aspect = b.w / Math.max(1, b.h);
        if (aspect > 2.5 || aspect < 0.5) return false;
        // A real logo node is either a vector/group containing graphics
        // or a named wrapper ("logo", "brand", "mark"). Reject any
        // candidate whose only descendant is a text node longer than
        // a few characters — that's a nav link or label, not a logo.
        const name = ((n as any).name ?? '').toLowerCase();
        const named = /logo|brand|mark|wordmark/.test(name);
        if (named) return true;
        const textDescendants: INode[] = [];
        const collect = (x: INode) => {
          if (x.children) {
            for (const c of x.children as INode[]) {
              if (c.type === NodeType.Text) textDescendants.push(c);
              else collect(c);
            }
          }
        };
        collect(n);
        if (textDescendants.length > 0) {
          const chars = textDescendants
            .map(t => (t as any).characters ?? (t as any).text ?? '')
            .join(' ')
            .trim();
          // Logo wordmarks are short ("Stripe", "Linear", "Notion"). A
          // nav link or badge with >12 chars is almost certainly not a
          // logo.
          if (chars.length > 12) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          boundsMap.get(a.id)!.w * boundsMap.get(a.id)!.h - boundsMap.get(b.id)!.w * boundsMap.get(b.id)!.h
      );
    // Cap picks: a landing page has at most one header logo. Even in
    // multi-slot mode we keep it to 1 here because the heuristic is
    // about "is this the brand mark", and that question has a single
    // correct answer per page.
    const logoPicks = topSmall.slice(0, 1);
    for (const l of logoPicks) result.set(l.id, 'logo');
  }

  // Title detection. Single mode keeps the legacy "top half + sort by font
  // size, pick one" rule. Multi mode drops the position filter and treats
  // every text whose font size matches a DS title/hero role as a section
  // heading — required for emails and landings where section heads sit at
  // many y positions and the largest font may not be at the top.
  const titleCandidatesAll = texts
    .filter(t => !result.has(t.id))
    .map(t => {
      const tn = t;
      const fsNum = typeof tn.fontSize === 'number' ? tn.fontSize : 12;
      return {
        node: t,
        b: boundsMap.get(t.id)!,
        fs: fsNum,
        len: tn.characters!.length,
      };
    });

  let titlePicks: typeof titleCandidatesAll;
  if (multiSlot && ds) {
    // Pick every text whose font size matches DS hero or title role.
    titlePicks = titleCandidatesAll
      .filter(x =>
        fontSizeMatchesRole(ds, x.fs, 'hero') ||
        fontSizeMatchesRole(ds, x.fs, 'title'),
      )
      .sort((a, b) => b.fs - a.fs || a.b.y - b.b.y);
  } else if (multiSlot) {
    // No DS: take texts >= 80% of largest, anywhere on canvas.
    const maxFs = Math.max(0, ...titleCandidatesAll.map(x => x.fs));
    titlePicks = titleCandidatesAll
      .filter(x => x.fs >= maxFs * 0.8)
      .sort((a, b) => b.fs - a.fs || a.b.y - b.b.y);
  } else {
    const topTexts = titleCandidatesAll
      .filter(x => x.b.y / H < 0.55)
      .sort((a, b) => {
        if (ds) {
          const aMatchesTitle = fontSizeMatchesRole(ds, a.fs, 'hero') || fontSizeMatchesRole(ds, a.fs, 'title');
          const bMatchesTitle = fontSizeMatchesRole(ds, b.fs, 'hero') || fontSizeMatchesRole(ds, b.fs, 'title');
          if (aMatchesTitle && !bMatchesTitle) return -1;
          if (!aMatchesTitle && bMatchesTitle) return 1;
        }
        return b.fs - a.fs || a.b.y - b.b.y || a.len - b.len;
      });
    titlePicks = topTexts.slice(0, 1);
  }
  for (const t of titlePicks) result.set(t.node.id, 'title');

  for (const t of texts) {
    if (!result.has(t.id)) result.set(t.id, 'description');
  }

  // Button detection. Multi mode picks every frame/component matching the
  // size+position+children filter (long-form designs typically have several
  // CTAs); the y-filter is dropped because email/landing CTAs sit anywhere
  // including the top hero. Single mode keeps the legacy y > 0.35 + best-area
  // pick for banner backward compat.
  // For multi mode tightening: a button typically has its own background
  // (fills) so wrapper rows of buttons are excluded; small child count
  // (1 text label or icon+label); short height; and is not full-width.
  const hasOwnFills = (n: INode): boolean =>
    'fills' in n && n.fills !== MIXED && Array.isArray(n.fills) && n.fills.length > 0;
  const containsTextChild = (n: INode): boolean =>
    !!(n.children && n.children.some(c => c.type === NodeType.Text));

  const buttonCandidates = framesOrComponents
    .filter(n => !result.has(n.id))
    .map(n => {
      const b = boundsMap.get(n.id)!;
      const area = (b.w * b.h) / areaFrame;
      let dsBoost = 0;
      if (ds?.components.button) {
        const cr = typeof n.cornerRadius === 'number' ? n.cornerRadius : -1;
        if (ds.components.button.style === 'pill' && (cr >= 50 || cr >= Math.min(b.w, b.h) / 2 - 2)) {
          dsBoost = -0.1;
        } else if (ds.components.button.style === 'square' && cr === 0) {
          dsBoost = -0.1;
        } else if (cr >= 0 && Math.abs(cr - ds.components.button.borderRadius) < 4) {
          dsBoost = -0.05;
        }
      }
      return { node: n, b, area, children: n.children ? n.children.length : 0, dsBoost };
    })
    .filter(x => {
      if (x.area < 0.01 || x.area > 0.3) return false;
      if (x.children < 1) return false;
      if (!multiSlot && x.b.y / H <= 0.35) return false;
      if (multiSlot) {
        // Tight multi-mode constraints: real buttons are short, not full-width,
        // have their own background fill, and at most a couple children
        // (typically just a label text). Wrapper rows and card containers
        // get filtered out by these checks.
        if (x.b.h > 100) return false;
        // Width cap: real buttons are narrow. Anything wider than ~40% of
        // the canvas is a text block or section wrapper, not a CTA.
        // `<p>` with explicit background color was slipping past the old
        // 85% cap and tagging paragraph copy as a button in landing pages.
        if (x.b.w > W * 0.4) return false;
        if (x.children > 2) return false;
        if (!hasOwnFills(x.node)) return false;
        if (!containsTextChild(x.node)) return false;
        // Text child content check: real button labels are short. A
        // paragraph full of prose with its own background fill is still
        // a paragraph, not a button.
        const textChild = (x.node.children ?? []).find(c => c.type === NodeType.Text);
        if (textChild) {
          const chars = (textChild as any).characters ?? (textChild as any).text ?? '';
          // CTAs rarely exceed 30 chars ("Get started free", "Start
          // building", "Book a demo"). Prose paragraphs always do.
          if (chars.length > 30) return false;
        }
      }
      return true;
    })
    .sort((a, b) => (Math.abs(a.area - 0.05) + a.dsBoost) - (Math.abs(b.area - 0.05) + b.dsBoost));

  const buttonPicks = multiSlot ? buttonCandidates : buttonCandidates.slice(0, 1);
  if (buttonPicks.length > 0) {
    for (const bp of buttonPicks) result.set(bp.node.id, 'button');
  } else {
    const rectButtons = nodes
      .filter(n => !result.has(n.id) && n.type === NodeType.Rectangle)
      .map(n => ({
        node: n,
        b: boundsMap.get(n.id)!,
        area: (boundsMap.get(n.id)!.w * boundsMap.get(n.id)!.h) / areaFrame,
      }))
      .filter(x => {
        if (!looksLikeButtonHitRectBounds(x.b, W, H)) return false;
        if (x.area < 0.01 || x.area > 0.3) return false;
        if (!multiSlot && x.b.y / H <= 0.35) return false;
        return true;
      })
      .sort((a, b) => Math.abs(a.area - 0.05) - Math.abs(b.area - 0.05));
    const rectPicks = multiSlot ? rectButtons : rectButtons.slice(0, 1);
    for (const rp of rectPicks) result.set(rp.node.id, 'button');
  }

  const assignedIds = new Set(result.keys());
  const hasAssignedDescendant = (node: INode): boolean => {
    if (assignedIds.has(node.id)) return true;
    if (node.children && node.type !== NodeType.Instance) {
      for (const c of node.children) {
        if (hasAssignedDescendant(c as INode)) return true;
      }
    }
    return false;
  };
  const remaining = nodes.filter(
    n => !result.has(n.id) && n.type !== NodeType.Text && !hasAssignedDescendant(n)
  );
  if (remaining.length > 0) {
    const byArea = remaining
      .map(n => ({ node: n, area: (boundsMap.get(n.id)!.w * boundsMap.get(n.id)!.h) / areaFrame }))
      .sort((a, b) => b.area - a.area);
    /** Don't assign "whole scene wrapper" (bbox >> frame) as other — breaks cross and overlap. */
    const OTHER_MAX_AREA_RATIO = 3.2;
    const pick = byArea.find(x => x.area <= OTHER_MAX_AREA_RATIO);
    if (pick) result.set(pick.node.id, 'other');
  }

  return result;
}

export function sceneNodeToGuideElementType(node: INode): GuideElement['type'] {
  const nt = (node as { type: string }).type;
  if (nt === NodeType.Text) return 'text';
  if (nt === 'IMAGE') return 'image';
  if (hasVisibleImageFill(node)) return 'image';
  return 'shape';
}

/** Slot type in guide — from `slotType` in JSON or by element type (as in `oLD`). */
export function getGuideSlotType(el: GuideElement): BannerElementType {
  if (el.slotType) return el.slotType;
  if (el.type === 'background' || el.fill) return 'background';
  if (el.type === 'instance') return 'logo';
  if (el.type === 'frame') return 'button';
  if (el.type === 'text') return 'description';
  return 'other';
}

/**
 * Semantics from source size guide: source nodes <-> guide elements by position (normalized).
 */
export function getSemanticTypesFromSourceGuide(
  sourceFrame: INode,
  sourceGuide: GuideSize
): Map<string, BannerElementType> {
  const W = sourceFrame.width;
  const H = sourceFrame.height;
  const areaFrame = W * H;
  const allNodes = collectAllDescendants(sourceFrame).slice(1);
  const boundsMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of allNodes) boundsMap.set(node.id, getBoundsInFrame(node, sourceFrame));

  const result = new Map<string, BannerElementType>();
  const used = new Set<string>();

  const bgEl = sourceGuide.elements.find(el => el.fill && getGuideSlotType(el) === 'background');
  if (bgEl) {
    let bestBg: { id: string; area: number } | null = null;
    for (const node of allNodes) {
      if (used.has(node.id)) continue;
      const b = boundsMap.get(node.id);
      if (!b) continue;
      const area = b.w * b.h;
      if (area < areaFrame * 0.25 || !isDirectChild(node, sourceFrame)) continue;
      const selfFills = 'fills' in node && node.fills !== MIXED && node.fills && node.fills.length > 0;
      if (selfFills && area > (bestBg?.area ?? 0)) bestBg = { id: node.id, area };
      if (!selfFills && node.children) {
        for (const child of node.children) {
          const cb = boundsMap.get(child.id);
          if (!cb) continue;
          const childFills = 'fills' in child && child.fills !== MIXED && child.fills && child.fills.length > 0;
          if (childFills && cb.w * cb.h > areaFrame * 0.25 && area > (bestBg?.area ?? 0)) bestBg = { id: node.id, area };
        }
      }
    }
    if (bestBg) {
      result.set(bestBg.id, 'background');
      used.add(bestBg.id);
    }
  }

  const guideSlots = sourceGuide.elements
    .filter(el => (el.left != null && el.top != null) && !(el.fill && getGuideSlotType(el) === 'background'))
    .map(el => ({ el, slotType: getGuideSlotType(el) }))
    .sort((a, b) => (a.el.top ?? 0) - (b.el.top ?? 0) || (a.el.left ?? 0) - (b.el.left ?? 0));

  for (const { el, slotType } of guideSlots) {
    const gx = el.left ?? 0;
    const gy = el.top ?? 0;
    const guideIsText = el.type === 'text';
    const guideIsVisual = el.type === 'rounded-rectangle' || el.type === 'instance';
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const node of allNodes) {
      if (used.has(node.id)) continue;
      const b = boundsMap.get(node.id);
      if (!b) continue;
      const nx = b.x / W;
      const ny = b.y / H;
      let dist = (nx - gx) ** 2 + (ny - gy) ** 2;
      const nodeIsText = node.type === NodeType.Text;
      if (guideIsText && !nodeIsText) dist *= 3;
      else if (guideIsText && nodeIsText) dist *= 0.5;
      if (guideIsVisual && nodeIsText) dist *= 3;
      else if (guideIsVisual && !nodeIsText) dist *= 0.5;
      if (dist < bestDist) {
        bestDist = dist;
        bestId = node.id;
      }
    }
    if (bestId) {
      result.set(bestId, slotType);
      used.add(bestId);
    }
  }

  return result;
}

/** Only "topmost" assigned nodes: don't place descendant if parent is also in a slot (as in `oLD`). */
export function topmostBySlotType(
  items: { node: INode; slotType: BannerElementType }[]
): { node: INode; slotType: BannerElementType }[] {
  const byType = new Map<BannerElementType, { node: INode; slotType: BannerElementType }[]>();
  for (const item of items) {
    if (!byType.has(item.slotType)) byType.set(item.slotType, []);
    byType.get(item.slotType)!.push(item);
  }
  const result: { node: INode; slotType: BannerElementType }[] = [];
  for (const list of byType.values()) {
    list.sort(
      (a, b) =>
        depth(a.node) - depth(b.node) || (('y' in a.node ? a.node.y : 0) - ('y' in b.node ? b.node.y : 0))
    );
    const kept: { node: INode; slotType: BannerElementType }[] = [];
    for (const item of list) {
      if (!kept.some(k => isAncestor(k.node, item.node))) kept.push(item);
    }
    result.push(...kept);
  }
  const resultIds = new Set(result.map(r => r.node.id));
  const onlyRoots = result.filter(item => {
    let p: INode | null = item.node.parent;
    while (p) {
      if (resultIds.has(p.id)) return false;
      p = p.parent;
    }
    return true;
  });
  return onlyRoots.sort(
    (a, b) =>
      slotOrderIndex(a.slotType) - slotOrderIndex(b.slotType) ||
      (('y' in a.node ? a.node.y : 0) - ('y' in b.node ? b.node.y : 0))
  );
}

export function findFallbackTitleDescription(
  frame: INode,
  allNodes: INode[],
  assignedIds: Set<string>,
  targetGuide: GuideSize
): Map<string, BannerElementType> {
  const hasTitleSlot = targetGuide.elements.some(el => getGuideSlotType(el) === 'title' && el.left != null);
  const hasDescSlot = targetGuide.elements.some(el => getGuideSlotType(el) === 'description' && el.left != null);
  if (!hasTitleSlot && !hasDescSlot) return new Map();

  const H = frame.height;
  const texts = allNodes.filter(n => n.type === NodeType.Text && !assignedIds.has(n.id));
  if (texts.length === 0) return new Map();

  const boundsMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of allNodes) boundsMap.set(n.id, getBoundsInFrame(n, frame));

  const out = new Map<string, BannerElementType>();

  if (hasTitleSlot) {
    const topTexts = texts
      .filter(t => (boundsMap.get(t.id)!.y / H) < 0.55)
      .map(t => ({ node: t, b: boundsMap.get(t.id)!, fs: typeof t.fontSize === 'number' ? t.fontSize : 12 }))
      .sort((a, b) => b.fs - a.fs || a.b.y - b.b.y);
    if (topTexts.length > 0) {
      out.set(topTexts[0].node.id, 'title');
      assignedIds.add(topTexts[0].node.id);
    }
  }

  if (hasDescSlot) {
    const rest = texts.filter(t => !out.has(t.id));
    const descCandidates = rest
      .filter(t => {
        const bx = boundsMap.get(t.id);
        if (!bx) return false;
        const ny = bx.y / H;
        return ny > 0.3 && ny < 0.9;
      })
      .map(t => ({ node: t, b: boundsMap.get(t.id)! }))
      .sort((a, b) => a.b.y - b.b.y);
    if (descCandidates.length > 0) out.set(descCandidates[0].node.id, 'description');
  }

  return out;
}

export function buildSemanticByType(_nodes: INode[], _frame: INode): Map<BannerElementType, INode[]> {
  const map = new Map<BannerElementType, INode[]>();
  return map;
}

/**
 * Semantics for result: from source (once) + sourceId -> resultId mapping.
 * If sourceGuide is provided — "what we resize from" is taken by source size guide (position matching).
 * Otherwise — assignSemanticTypes heuristic. "Where to" is always set by target guide in applyGuidePostProcess.
 */
export async function getSemanticTypesForResultFrame(
  sourceFrame: INode,
  resultFrame: INode,
  sourceGuide?: GuideSize,
  /** Explicit assignments (source node id -> slot): priority over guide/heuristic (recording session). */
  explicitSourceAssignments?: Map<string, BannerElementType>
): Promise<Map<string, BannerElementType>> {
  const idMap = await buildSourceToResultNodeIdMap(sourceFrame, resultFrame);
  const resultMap = new Map<string, BannerElementType>();

  if (explicitSourceAssignments && explicitSourceAssignments.size > 0) {
    for (const [sourceId, slotType] of explicitSourceAssignments) {
      const resultId = idMap.get(sourceId);
      if (resultId) resultMap.set(resultId, slotType);
    }
    return resultMap;
  }

  const allSourceNodes = collectAllDescendants(sourceFrame).slice(1);
  const semanticSource = sourceGuide
    ? getSemanticTypesFromSourceGuide(sourceFrame, sourceGuide)
    : assignSemanticTypes(allSourceNodes, sourceFrame);
  for (const [sourceId, slotType] of semanticSource) {
    const resultId = idMap.get(sourceId);
    if (resultId) resultMap.set(resultId, slotType);
  }
  return resultMap;
}

/**
 * Text in slot: width = slot, height by content (HEIGHT), without stretching to slot rectangle.
 * If after reflow taller than slot — additional uniform scale to fit by height.
 */
export async function fitTextInSlotPreserveProportions(
  t: INode,
  slotType: BannerElementType,
  guideW: number,
  guideH: number
): Promise<void> {
  if (!('resize' in t)) return;
  const tw = Math.max(1, Math.round(guideW));
  const gh = Math.max(1, Math.round(guideH));

  try {
    // 1. First force HEIGHT so text can expand downward.
    t.textAutoResize = 'HEIGHT';

    // 2. Set minimum width.
    // Use Math.max(guideH, t.height) instead of (t.height) to avoid collapsing to 8px before font loads.
    const minH = Math.max(12, typeof t.fontSize === 'number' ? t.fontSize : 0);
    t.resize(tw, Math.max(minH, t.height));
  } catch (_) {}

  // 3. After reflow check height.
  const nh = Math.max(t.height, 1);
  if (nh > gh + 0.5) {
    const s = Math.max(0.12, Math.min(1, gh / nh));
    if (Math.abs(s - 1) > 0.005) {
      await scaleElement(t, s, slotType, true);
      try {
        t.textAutoResize = 'HEIGHT';
        t.resize(tw, t.height);
      } catch (_) {}
    }
  }
}

export function isDirectChild(node: INode, frame: INode): boolean {
  return node.parent === frame;
}

/**
 * After `executeUniformLetterbox` visual content is an "island" rectangle inside target frame.
 * If mapping JSON guide slots to full target W*H, at 970*250 -> 9:16 all Y centers give ~0.5 —
 * (nx,ny) matching breaks, slots get mixed up.
 */
export function inferLetterboxContentIsland(
  frame: INode,
  semanticTypes: Map<string, BannerElementType>,
  tw: number,
  th: number
): { x: number; y: number; w: number; h: number } {
  const areaF = Math.max(tw * th, 1);
  const children = (frame.children ?? []).filter((c: any) => !('removed' in c && c.removed)) as INode[];

  const isLikelyFullBleed = (c: INode): boolean => {
    if (semanticTypes.get(c.id) === 'background') return true;
    const b = getBoundsInFrame(c, frame);
    return b.w * b.h >= areaF * 0.86;
  };

  const pool = children.filter(c => !isLikelyFullBleed(c));
  const use = pool.length > 0 ? pool : children;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of use) {
    const b = getBoundsInFrame(c, frame);
    if (b.w < 2 || b.h < 2) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: tw, h: th };
  }

  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return { x: minX, y: minY, w, h };
}

interface RectLike { x: number; y: number; w: number; h: number }
