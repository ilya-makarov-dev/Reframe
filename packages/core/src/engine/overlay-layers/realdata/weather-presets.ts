/**
 * Weather preset config for realdata-weather (T2 #29).
 *
 * Five atmospheric conditions, each with a deterministic preset
 * particle-behavior + tint shape. NOT a live-API integration —
 * "real data" here means "real-world atmospheric vocabulary"
 * (designer picks "rainy" because the brand is melancholic),
 * not "current weather in Paris".
 *
 * Live-weather-API variant deferred — different category with
 * external dependency profile incompatible с offline bundles.
 */

export type WeatherCondition = 'rainy' | 'snowy' | 'sunny' | 'stormy' | 'clear';

export interface WeatherPreset {
  /** Optional canvas-fill tint applied as a subtle overlay (rgba). */
  tint: string | null;
  /** Per-condition particle behavior tag — render branch dispatches on this. */
  particleKind: 'rain' | 'snow' | 'sparkle' | 'lightning' | 'haze';
  /** Default particle count multiplier (intensity 1.0 maps to this). */
  baseCount: number;
  /** Default vertical drift speed in px/sec at intensity 1.0. */
  baseSpeed: number;
}

export const WEATHER_PRESETS: Record<WeatherCondition, WeatherPreset> = {
  rainy: {
    tint: 'rgba(60, 80, 120, 0.15)',
    particleKind: 'rain',
    baseCount: 250,
    baseSpeed: 600,
  },
  snowy: {
    tint: 'rgba(220, 230, 250, 0.10)',
    particleKind: 'snow',
    baseCount: 180,
    baseSpeed: 80,
  },
  sunny: {
    tint: 'rgba(255, 220, 160, 0.10)',
    particleKind: 'sparkle',
    baseCount: 50,
    baseSpeed: 0,
  },
  stormy: {
    tint: 'rgba(40, 50, 70, 0.30)',
    particleKind: 'lightning',
    baseCount: 200,  // rain particles + occasional flashes
    baseSpeed: 700,
  },
  clear: {
    tint: 'rgba(180, 210, 230, 0.05)',
    particleKind: 'haze',
    baseCount: 0,    // no particles, just tint
    baseSpeed: 0,
  },
};

export const KNOWN_WEATHER_CONDITIONS: ReadonlyArray<WeatherCondition> = [
  'rainy', 'snowy', 'sunny', 'stormy', 'clear',
];
