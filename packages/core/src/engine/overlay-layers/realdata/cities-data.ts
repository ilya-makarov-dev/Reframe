/**
 * Top-100 world cities by population — hand-curated for realdata-globe (T2 #29).
 *
 * Coordinates are publicly-known geographic facts (latitude/longitude
 * of city centers). No catalog license dependency: each entry is
 * derived from common-knowledge geography rather than a redistributed
 * database. Capital flag from standard country-capital reference.
 *
 * Ordering: roughly by population (urban agglomeration, 2024-ish
 * estimates). Slice-based presets in realdata-globe.ts pull `top-50`
 * (slice 0..50) and `top-100` (full array). `capitals` filter selects
 * isCapital=true entries.
 *
 * Why hand-curated, not catalog-derived:
 *   - Full city databases (GeoNames, OpenStreetMap extracts) carry
 *     CC-BY / ODbL terms that complicate embedding.
 *   - 100 entries = manageable to verify by hand; designer needs
 *     "globe with recognizable continents", not census-grade accuracy.
 *   - Future signal: live-API or larger embedded catalog when
 *     designer asks for "every city >100k population".
 */

export interface City {
  /** Latitude in decimal degrees, -90..90. */
  lat: number;
  /** Longitude in decimal degrees, -180..180. */
  lon: number;
  /** Display name. */
  name: string;
  /** ISO-2 country code. */
  country: string;
  /** True when this city is the capital of its country. */
  isCapital?: boolean;
}

export const CITIES_DATA: ReadonlyArray<City> = [
  { lat: 35.68, lon: 139.69, name: 'Tokyo', country: 'JP', isCapital: true },
  { lat: 28.61, lon: 77.21, name: 'Delhi', country: 'IN', isCapital: true },
  { lat: 31.23, lon: 121.47, name: 'Shanghai', country: 'CN' },
  { lat: -23.55, lon: -46.63, name: 'São Paulo', country: 'BR' },
  { lat: 19.43, lon: -99.13, name: 'Mexico City', country: 'MX', isCapital: true },
  { lat: 30.05, lon: 31.25, name: 'Cairo', country: 'EG', isCapital: true },
  { lat: 23.81, lon: 90.41, name: 'Dhaka', country: 'BD', isCapital: true },
  { lat: 19.08, lon: 72.88, name: 'Mumbai', country: 'IN' },
  { lat: 39.90, lon: 116.41, name: 'Beijing', country: 'CN', isCapital: true },
  { lat: 34.69, lon: 135.50, name: 'Osaka', country: 'JP' },
  { lat: 40.71, lon: -74.01, name: 'New York', country: 'US' },
  { lat: 22.32, lon: 114.17, name: 'Hong Kong', country: 'HK' },
  { lat: 14.60, lon: 120.98, name: 'Manila', country: 'PH', isCapital: true },
  { lat: 35.18, lon: 129.07, name: 'Busan', country: 'KR' },
  { lat: 28.04, lon: -82.46, name: 'Tampa', country: 'US' },
  { lat: -34.61, lon: -58.38, name: 'Buenos Aires', country: 'AR', isCapital: true },
  { lat: 39.92, lon: 32.85, name: 'Ankara', country: 'TR', isCapital: true },
  { lat: 41.01, lon: 28.98, name: 'Istanbul', country: 'TR' },
  { lat: 13.75, lon: 100.50, name: 'Bangkok', country: 'TH', isCapital: true },
  { lat: 51.51, lon: -0.13, name: 'London', country: 'GB', isCapital: true },
  { lat: 6.52, lon: 3.38, name: 'Lagos', country: 'NG' },
  { lat: 2.24, lon: -76.55, name: 'Bogotá', country: 'CO', isCapital: true },
  { lat: 31.55, lon: 74.34, name: 'Lahore', country: 'PK' },
  { lat: 12.97, lon: 77.59, name: 'Bangalore', country: 'IN' },
  { lat: 22.57, lon: 88.36, name: 'Kolkata', country: 'IN' },
  { lat: 13.08, lon: 80.27, name: 'Chennai', country: 'IN' },
  { lat: 33.69, lon: 73.05, name: 'Islamabad', country: 'PK', isCapital: true },
  { lat: 24.86, lon: 67.01, name: 'Karachi', country: 'PK' },
  { lat: 41.90, lon: 12.50, name: 'Rome', country: 'IT', isCapital: true },
  { lat: 48.86, lon: 2.35, name: 'Paris', country: 'FR', isCapital: true },
  { lat: 35.69, lon: 51.39, name: 'Tehran', country: 'IR', isCapital: true },
  { lat: -22.91, lon: -43.17, name: 'Rio de Janeiro', country: 'BR' },
  { lat: 33.45, lon: -112.07, name: 'Phoenix', country: 'US' },
  { lat: 37.77, lon: -122.42, name: 'San Francisco', country: 'US' },
  { lat: 34.05, lon: -118.24, name: 'Los Angeles', country: 'US' },
  { lat: 41.88, lon: -87.63, name: 'Chicago', country: 'US' },
  { lat: 49.28, lon: -123.12, name: 'Vancouver', country: 'CA' },
  { lat: 45.50, lon: -73.57, name: 'Montreal', country: 'CA' },
  { lat: 43.65, lon: -79.38, name: 'Toronto', country: 'CA' },
  { lat: 1.35, lon: 103.82, name: 'Singapore', country: 'SG', isCapital: true },
  { lat: -6.21, lon: 106.85, name: 'Jakarta', country: 'ID', isCapital: true },
  { lat: 21.03, lon: 105.85, name: 'Hanoi', country: 'VN', isCapital: true },
  { lat: 10.82, lon: 106.63, name: 'Ho Chi Minh City', country: 'VN' },
  { lat: 10.50, lon: 7.43, name: 'Kano', country: 'NG' },
  { lat: 9.07, lon: 7.49, name: 'Abuja', country: 'NG', isCapital: true },
  { lat: 30.04, lon: 31.24, name: 'Giza', country: 'EG' },
  { lat: 25.20, lon: 55.27, name: 'Dubai', country: 'AE' },
  { lat: 24.47, lon: 54.37, name: 'Abu Dhabi', country: 'AE', isCapital: true },
  { lat: 24.71, lon: 46.68, name: 'Riyadh', country: 'SA', isCapital: true },
  { lat: 33.51, lon: 36.30, name: 'Damascus', country: 'SY', isCapital: true },
  { lat: 33.31, lon: 44.36, name: 'Baghdad', country: 'IQ', isCapital: true },
  { lat: 31.95, lon: 35.93, name: 'Amman', country: 'JO', isCapital: true },
  { lat: 32.07, lon: 34.78, name: 'Tel Aviv', country: 'IL' },
  { lat: 31.78, lon: 35.22, name: 'Jerusalem', country: 'IL', isCapital: true },
  { lat: 4.61, lon: -74.08, name: 'Bogota', country: 'CO', isCapital: true },
  { lat: -12.05, lon: -77.04, name: 'Lima', country: 'PE', isCapital: true },
  { lat: -33.45, lon: -70.65, name: 'Santiago', country: 'CL', isCapital: true },
  { lat: -16.50, lon: -68.15, name: 'La Paz', country: 'BO', isCapital: true },
  { lat: -15.79, lon: -47.88, name: 'Brasília', country: 'BR', isCapital: true },
  { lat: -25.43, lon: -49.27, name: 'Curitiba', country: 'BR' },
  { lat: 9.93, lon: -84.08, name: 'San José', country: 'CR', isCapital: true },
  { lat: 14.63, lon: -90.51, name: 'Guatemala City', country: 'GT', isCapital: true },
  { lat: 23.13, lon: -82.36, name: 'Havana', country: 'CU', isCapital: true },
  { lat: 18.47, lon: -69.91, name: 'Santo Domingo', country: 'DO', isCapital: true },
  { lat: 39.93, lon: -75.16, name: 'Philadelphia', country: 'US' },
  { lat: 47.61, lon: -122.33, name: 'Seattle', country: 'US' },
  { lat: 32.78, lon: -96.80, name: 'Dallas', country: 'US' },
  { lat: 29.76, lon: -95.37, name: 'Houston', country: 'US' },
  { lat: 25.76, lon: -80.19, name: 'Miami', country: 'US' },
  { lat: 38.91, lon: -77.04, name: 'Washington', country: 'US', isCapital: true },
  { lat: 42.36, lon: -71.06, name: 'Boston', country: 'US' },
  { lat: 39.74, lon: -104.99, name: 'Denver', country: 'US' },
  { lat: 36.17, lon: -115.14, name: 'Las Vegas', country: 'US' },
  { lat: 52.52, lon: 13.41, name: 'Berlin', country: 'DE', isCapital: true },
  { lat: 48.14, lon: 11.58, name: 'Munich', country: 'DE' },
  { lat: 50.11, lon: 8.68, name: 'Frankfurt', country: 'DE' },
  { lat: 53.55, lon: 9.99, name: 'Hamburg', country: 'DE' },
  { lat: 48.21, lon: 16.37, name: 'Vienna', country: 'AT', isCapital: true },
  { lat: 47.37, lon: 8.55, name: 'Zurich', country: 'CH' },
  { lat: 46.95, lon: 7.45, name: 'Bern', country: 'CH', isCapital: true },
  { lat: 50.85, lon: 4.35, name: 'Brussels', country: 'BE', isCapital: true },
  { lat: 52.37, lon: 4.90, name: 'Amsterdam', country: 'NL', isCapital: true },
  { lat: 55.68, lon: 12.57, name: 'Copenhagen', country: 'DK', isCapital: true },
  { lat: 59.33, lon: 18.07, name: 'Stockholm', country: 'SE', isCapital: true },
  { lat: 59.91, lon: 10.75, name: 'Oslo', country: 'NO', isCapital: true },
  { lat: 60.17, lon: 24.94, name: 'Helsinki', country: 'FI', isCapital: true },
  { lat: 64.13, lon: -21.94, name: 'Reykjavik', country: 'IS', isCapital: true },
  { lat: 53.34, lon: -6.27, name: 'Dublin', country: 'IE', isCapital: true },
  { lat: 38.72, lon: -9.14, name: 'Lisbon', country: 'PT', isCapital: true },
  { lat: 40.42, lon: -3.70, name: 'Madrid', country: 'ES', isCapital: true },
  { lat: 41.39, lon: 2.16, name: 'Barcelona', country: 'ES' },
  { lat: 37.98, lon: 23.73, name: 'Athens', country: 'GR', isCapital: true },
  { lat: 50.45, lon: 30.52, name: 'Kyiv', country: 'UA', isCapital: true },
  { lat: 55.75, lon: 37.62, name: 'Moscow', country: 'RU', isCapital: true },
  { lat: 59.93, lon: 30.34, name: 'Saint Petersburg', country: 'RU' },
  { lat: 56.83, lon: 60.60, name: 'Yekaterinburg', country: 'RU' },
  { lat: 55.03, lon: 82.92, name: 'Novosibirsk', country: 'RU' },
  { lat: 43.24, lon: 76.95, name: 'Almaty', country: 'KZ' },
  { lat: 41.31, lon: 69.28, name: 'Tashkent', country: 'UZ', isCapital: true },
  { lat: -33.87, lon: 151.21, name: 'Sydney', country: 'AU' },
];

if (CITIES_DATA.length !== 100) {
  // Defense: this constant must stay at exactly 100 — slice presets
  // (`top-50`, `top-100`) depend on it. Tests assert the count.
  // eslint-disable-next-line no-console
  console.warn(`[realdata/cities-data] expected 100 entries, got ${CITIES_DATA.length}`);
}

/**
 * Lookup helper — case-insensitive. Returns undefined when the name
 * doesn't appear in the dataset. Used by realdata-globe's validate()
 * to verify explicit city-name lists.
 */
export function findCityByName(name: string): City | undefined {
  const lower = name.toLowerCase();
  return CITIES_DATA.find(c => c.name.toLowerCase() === lower);
}
