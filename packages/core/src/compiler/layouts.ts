import { frame, text, rect, image, solid } from '../builder.js';
import type { NodeBlueprint } from '../builder.js';
import type { CompileContent, ResolvedTheme } from './types.js';

// ─── Shared helpers ──────────────────────────────────────────

function ctaButton(content: string, theme: ResolvedTheme): NodeBlueprint {
  return frame({
    name: 'CTA',
    height: Math.max(44, theme.btnSize * 2.8),
    primaryAxisSizing: 'HUG',
    fills: [solid(theme.primary)],
    cornerRadius: theme.btnRadius,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingLeft: theme.spacing * 4,
    paddingRight: theme.spacing * 4,
    paddingTop: theme.spacing,
    paddingBottom: theme.spacing,
  },
    text(content, {
      name: 'CTA_Label',
      fontSize: theme.btnSize,
      fontWeight: theme.btnWeight,
      fills: [solid('#FFFFFF')],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    })
  );
}

function headlineNode(content: string, theme: ResolvedTheme, align: 'LEFT' | 'CENTER' = 'LEFT'): NodeBlueprint {
  return text(content, {
    name: 'Headline',
    fontSize: theme.heroSize,
    fontWeight: theme.heroWeight,
    fontFamily: theme.heroFont,
    fills: [solid(theme.textColor)],
    lineHeight: Math.round(theme.heroSize * 1.1),
    textAlignHorizontal: align,
    textAutoResize: 'HEIGHT',
    layoutAlignSelf: 'STRETCH',
  });
}

function subheadlineNode(content: string, theme: ResolvedTheme, align: 'LEFT' | 'CENTER' = 'LEFT'): NodeBlueprint {
  return text(content, {
    name: 'Subheadline',
    fontSize: theme.subSize,
    fontWeight: theme.subWeight,
    fontFamily: theme.bodyFont,
    fills: [solid(theme.textColor, 0.7)],
    lineHeight: Math.round(theme.subSize * 1.4),
    textAlignHorizontal: align,
    textAutoResize: 'HEIGHT',
    layoutAlignSelf: 'STRETCH',
  });
}

function bodyNode(content: string, theme: ResolvedTheme, maxWidth: number, align: 'LEFT' | 'CENTER' = 'LEFT'): NodeBlueprint {
  return text(content, {
    name: 'Body',
    fontSize: theme.bodySize,
    fontFamily: theme.bodyFont,
    fills: [solid(theme.textColor, 0.6)],
    lineHeight: Math.round(theme.bodySize * 1.5),
    textAlignHorizontal: align,
    textAutoResize: 'HEIGHT',
    width: maxWidth,
  });
}

function disclaimerNode(content: string, theme: ResolvedTheme, align: 'LEFT' | 'CENTER' = 'LEFT'): NodeBlueprint {
  return text(content, {
    name: 'Disclaimer',
    fontSize: theme.disclaimerSize,
    fontFamily: theme.bodyFont,
    fills: [solid(theme.textColor, 0.4)],
    textAlignHorizontal: align,
    textAutoResize: 'HEIGHT',
    layoutAlignSelf: 'STRETCH',
  });
}

function logoNode(url: string, height: number): NodeBlueprint {
  return rect({
    name: 'Logo',
    width: height * 3,
    height,
    fills: [image(url, 'FIT')],
  });
}

function bgImageNode(url: string, width: number, height: number): NodeBlueprint {
  return rect({
    name: 'BackgroundImage',
    layoutPositioning: 'ABSOLUTE',
    x: 0, y: 0, width, height,
    fills: [image(url, 'FILL', 0.15)],
  });
}

// ─── Layouts ─────────────────────────────────────────────────

export function buildCenteredLayout(width: number, height: number, content: CompileContent, theme: ResolvedTheme): NodeBlueprint {
  const pad = theme.spacing * 3;
  const children: NodeBlueprint[] = [];

  if (content.imageUrl) children.push(bgImageNode(content.imageUrl, width, height));
  if (content.logoUrl) children.push(logoNode(content.logoUrl, Math.round(Math.max(24, Math.min(60, height * 0.06)))));
  if (content.headline) children.push(headlineNode(content.headline, theme, 'CENTER'));
  if (content.subheadline) children.push(subheadlineNode(content.subheadline, theme, 'CENTER'));
  if (content.body) children.push(bodyNode(content.body, theme, Math.round(width * 0.8), 'CENTER'));
  if (content.cta) children.push(ctaButton(content.cta, theme));
  if (content.disclaimer) children.push(disclaimerNode(content.disclaimer, theme, 'CENTER'));

  return frame({
    name: 'Root',
    width,
    height,
    fills: [solid(theme.bg)],
    clipsContent: true,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: pad,
    paddingRight: pad,
    paddingBottom: pad,
    paddingLeft: pad,
    itemSpacing: theme.spacing,
  }, ...children);
}

export function buildLeftAlignedLayout(width: number, height: number, content: CompileContent, theme: ResolvedTheme): NodeBlueprint {
  const pad = theme.spacing * 3;
  const children: NodeBlueprint[] = [];

  if (content.imageUrl) children.push(bgImageNode(content.imageUrl, width, height));
  if (content.logoUrl) children.push(logoNode(content.logoUrl, Math.round(Math.max(24, Math.min(48, height * 0.06)))));
  if (content.headline) children.push(headlineNode(content.headline, theme));
  if (content.subheadline) children.push(subheadlineNode(content.subheadline, theme));
  if (content.body) children.push(bodyNode(content.body, theme, Math.round(width * 0.7)));
  if (content.cta) children.push(ctaButton(content.cta, theme));
  if (content.disclaimer) children.push(disclaimerNode(content.disclaimer, theme));

  return frame({
    name: 'Root',
    width,
    height,
    fills: [solid(theme.bg)],
    clipsContent: true,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'MIN',
    paddingTop: pad,
    paddingRight: pad,
    paddingBottom: pad,
    paddingLeft: pad,
    itemSpacing: theme.spacing,
  }, ...children);
}

export function buildSplitLayout(width: number, height: number, content: CompileContent, theme: ResolvedTheme): NodeBlueprint {
  const pad = theme.spacing * 3;
  const leftW = Math.round(width * 0.55);
  const rightW = width - leftW;

  const leftChildren: NodeBlueprint[] = [];
  if (content.logoUrl) leftChildren.push(logoNode(content.logoUrl, Math.round(Math.max(24, Math.min(48, height * 0.06)))));
  if (content.headline) leftChildren.push(headlineNode(content.headline, theme));
  if (content.subheadline) leftChildren.push(subheadlineNode(content.subheadline, theme));
  if (content.body) leftChildren.push(bodyNode(content.body, theme, Math.round(leftW * 0.85)));
  if (content.cta) leftChildren.push(ctaButton(content.cta, theme));
  if (content.disclaimer) leftChildren.push(disclaimerNode(content.disclaimer, theme));

  const leftCol = frame({
    name: 'LeftColumn',
    width: leftW,
    layoutAlignSelf: 'STRETCH',
    layoutMode: 'VERTICAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'MIN',
    paddingTop: pad,
    paddingRight: pad,
    paddingBottom: pad,
    paddingLeft: pad,
    itemSpacing: theme.spacing,
  }, ...leftChildren);

  const rightCol = frame({
    name: 'RightColumn',
    width: rightW,
    layoutAlignSelf: 'STRETCH',
    fills: [content.imageUrl ? image(content.imageUrl, 'CROP') : solid(theme.accent, 0.1)],
  });

  return frame({
    name: 'Root',
    width,
    height,
    fills: [solid(theme.bg)],
    clipsContent: true,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
  }, leftCol, rightCol);
}

export function buildStackedLayout(width: number, height: number, content: CompileContent, theme: ResolvedTheme): NodeBlueprint {
  const pad = theme.spacing * 2;
  const imgH = content.imageUrl ? Math.round(height * 0.4) : 0;

  const topChildren: NodeBlueprint[] = [];
  if (content.imageUrl) {
    topChildren.push(frame({
      name: 'ImageArea',
      width,
      height: imgH,
      fills: [image(content.imageUrl, 'FILL')],
      clipsContent: true,
    }));
  }

  const contentChildren: NodeBlueprint[] = [];
  if (content.logoUrl && !content.imageUrl) {
    contentChildren.push(logoNode(content.logoUrl, Math.round(Math.max(20, Math.min(40, (height - imgH) * 0.08)))));
  }
  if (content.headline) contentChildren.push(headlineNode(content.headline, theme, 'CENTER'));
  if (content.subheadline) contentChildren.push(subheadlineNode(content.subheadline, theme, 'CENTER'));
  if (content.cta) contentChildren.push(ctaButton(content.cta, theme));
  if (content.disclaimer) contentChildren.push(disclaimerNode(content.disclaimer, theme, 'CENTER'));

  const contentFrame = frame({
    name: 'ContentArea',
    layoutGrow: 1,
    layoutAlignSelf: 'STRETCH',
    layoutMode: 'VERTICAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: pad,
    paddingRight: pad,
    paddingBottom: pad,
    paddingLeft: pad,
    itemSpacing: theme.spacing,
  }, ...contentChildren);

  return frame({
    name: 'Root',
    width,
    height,
    fills: [solid(theme.bg)],
    clipsContent: true,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
  }, ...topChildren, contentFrame);
}
