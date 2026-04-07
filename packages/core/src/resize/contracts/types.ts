import type { INode } from '../../host';

export interface ScaleParams {
  width: number;
  height: number;
}

export interface RelativePosition {
  relativeX: number;
  relativeY: number;
  relativeWidth: number;
  relativeHeight: number;
}

export type BannerElementType = 'title' | 'description' | 'disclaimer' | 'ageRating' | 'button' | 'logo' | 'background' | 'other';

export interface NodeTransform {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  position: RelativePosition;
  fontSize?: number;
  fontSizeRelative?: number;
  elementType?: BannerElementType;
}

export type BackgroundType = 'solid' | 'gradient' | 'image' | 'none';

export interface FrameAnalysis {
  frameId: string;
  width: number;
  height: number;
  hasTextNodes: boolean;
  hasVectorNodes: boolean;
  hasRasterImages: boolean;
  hasNestedFrames: boolean;
  backgroundType: BackgroundType;
  backgroundImageHash: string | null;
  transforms: Map<string, NodeTransform>;
}

export interface ScaleContext {
  originalWidth: number;
  originalHeight: number;
  newWidth: number;
  newHeight: number;
  scaleX: number;
  scaleY: number;
  mode: 'cluster';
  transforms: Map<string, NodeTransform>;
  preserveProportions?: boolean;
}

export interface ScaleModule {
  name: string;
  shouldApply(analysis: FrameAnalysis): boolean;
  apply(frame: INode, context: ScaleContext): Promise<void>;
}

export interface SessionSlotBrief {
  slotType: BannerElementType;
  nodeName: string;
  nodeId: string;
}

export interface TempCaptureBrief {
  id: string;
  label: string;
  rootFrameId: string;
  width: number;
  height: number;
  regionCount: number;
}

export type CodeToUIMessage =
  | {
      type: 'selection-changed';
      frame: { id: string; name: string; width: number; height: number } | null;
      sessionRoot: { id: string; name: string; width: number; height: number } | null;
      selectedLeaf: { name: string; type: string } | null;
      sessionSlots: SessionSlotBrief[];
      tempCaptures: TempCaptureBrief[];
      activeTempId: string | null;
    }
  | {
      type: 'scale-complete';
      success: boolean;
      message?: string;
      runLogMarkdown?: string;
      runLogFilename?: string;
    }
  | { type: 'error'; message: string }
  | {
      type: 'session-log-data';
      markdown: string;
      filename: string;
      runCount: number;
    };

export type UIToCodeMessage =
  | {
      type: 'scale';
      width: number;
      height: number;
      options?: {
        preserveProportions?: boolean;
        useGuide?: boolean;
        guideKey?: string;
        useSessionGuide?: boolean;
        tempCaptureId?: string;
      };
    }
  | { type: 'cancel' }
  | { type: 'session-remember-layout' }
  | { type: 'session-clear-slots' }
  | { type: 'session-select-temp'; id: string }
  | { type: 'log-start' }
  | { type: 'log-stop' };

export type GuideSlotType = BannerElementType;

export interface GuideElement {
  name: string;
  type: 'background' | 'frame' | 'text' | 'instance' | 'rounded-rectangle' | 'image' | 'shape';
  slotType?: GuideSlotType;
  fill?: boolean;
  left?: number;
  top?: number;
  widthRatio?: number;
  heightRatio?: number;
  rememberFontRelMinSide?: number;
  rememberFontRelHeight?: number;
  rememberFontPx?: number;
  rememberTextAlign?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  rememberLineHeightPx?: number;
  rememberLineHeightPercent?: number;
  rememberLineHeightRelMin?: number;
  rememberLetterSpacingPx?: number;
  rememberLetterSpacingRelMin?: number;
  rememberCornerRadiusRelMin?: number;
  rememberStrokeWeightRelMin?: number;
  rememberOpacity?: number;
  rememberPrimaryFillOpacity?: number;
}

export interface GuideSize {
  width: number;
  height: number;
  elements: GuideElement[];
}

export interface GuidePreset {
  width: number;
  height: number;
  key: string;
}

export interface GuideData {
  presets: GuidePreset[];
  guides: Record<string, GuideSize>;
}
