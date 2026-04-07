/**
 * Default design tokens for @reframe/ui components.
 *
 * These values are used when no theme is provided.
 * Based on a neutral gray palette (Tailwind-inspired).
 * All colors are overridden when using themed() or createTheme().
 */

export const DEFAULTS = {
  // Brand
  primary: '#6366f1',        // indigo-500

  // Text
  text: '#111827',           // gray-900
  textMuted: '#6b7280',      // gray-500
  textInverse: '#ffffff',    // white
  textDisabled: '#9ca3af',   // gray-400

  // Surfaces
  surface: '#ffffff',        // white
  surfaceAlt: '#f3f4f6',     // gray-100
  surfaceDark: '#111827',    // gray-900
  surfaceElevated: '#ffffff',

  // Borders
  border: '#d1d5db',         // gray-300
  borderLight: '#e5e7eb',    // gray-200
  borderDark: '#374151',     // gray-700

  // Interactive
  placeholder: '#9ca3af',   // gray-400
  focus: '#6366f1',          // indigo-500
  hover: '#f9fafb',          // gray-50

  // Status
  success: '#10b981',        // emerald-500
  error: '#ef4444',          // red-500
  warning: '#f59e0b',        // amber-500
  info: '#3b82f6',           // blue-500

  // Component-specific
  avatarBg: '#e5e7eb',       // gray-200
  avatarText: '#374151',     // gray-700
  chipBg: '#f3f4f6',         // gray-100
  chipText: '#374151',       // gray-700
  quoteBorder: '#6366f1',    // indigo-500
  skeletonBg: '#e5e7eb',     // gray-200
  skeletonBgDark: '#27272a', // zinc-800

  // Pill radius
  pill: 9999,
} as const;

/** Status color map for feedback components. */
export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  info:    { bg: 'rgba(59, 130, 246, 0.1)',  text: '#3b82f6', border: '#3b82f6', dot: '#3b82f6' },
  success: { bg: 'rgba(16, 185, 129, 0.1)',  text: '#10b981', border: '#10b981', dot: '#10b981' },
  warning: { bg: 'rgba(245, 158, 11, 0.1)',  text: '#f59e0b', border: '#f59e0b', dot: '#f59e0b' },
  error:   { bg: 'rgba(239, 68, 68, 0.1)',   text: '#ef4444', border: '#ef4444', dot: '#ef4444' },
};
