import type { DesignSystem } from '../design-system/types.js';

export type LayoutStyle = 'centered' | 'left-aligned' | 'split' | 'stacked';

export interface CompileContent {
  headline?: string;
  subheadline?: string;
  body?: string;
  cta?: string;
  disclaimer?: string;
  imageUrl?: string;
  logoUrl?: string;
}

export interface CompileOptions {
  designSystem: DesignSystem;
  width: number;
  height: number;
  layout?: LayoutStyle;
  content: CompileContent;
}

export interface ResolvedTheme {
  bg: string;
  textColor: string;
  primary: string;
  accent: string;
  btnRadius: number;
  spacing: number;
  
  heroSize: number;
  subSize: number;
  bodySize: number;
  btnSize: number;
  disclaimerSize: number;
  
  heroFont: string;
  bodyFont: string;
  
  heroWeight: number;
  subWeight: number;
  btnWeight: number;
}
