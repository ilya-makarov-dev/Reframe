/**
 * After clone + resize, export presets on the root frame retain the original size
 * (e.g. 9:16 -> 16:9, but the Export panel still shows "Export 1080x1920").
 * Adjust constraints to match the actual width/height of the frame.
 */
import type { INode, IExportSettings } from '../../host';

export function syncFrameExportConstraintsToFrameSize(frame: INode): void {
  const w = Math.round(frame.width);
  const h = Math.round(frame.height);
  try {
    const list = frame.exportSettings;
    if (!list || list.length === 0) return;

    const next = list.map((es): IExportSettings => {
      if (es.format !== 'JPG' && es.format !== 'PNG') return es;

      const c = es.constraint as
        | { type: string; value?: number; width?: number; height?: number }
        | undefined;
      if (!c) return es;

      const base: IExportSettings = {
        format: es.format,
        suffix: es.suffix,
      };

      if (c.type === 'WIDTH') {
        if (c.value === w) return es;
        return { ...base, constraint: { type: 'WIDTH', value: w } };
      }
      if (c.type === 'HEIGHT') {
        if (c.value === h) return es;
        return { ...base, constraint: { type: 'HEIGHT', value: h } };
      }
      if (c.type === 'SCALE') {
        return es;
      }
      // Newer hosts: fixed W x H pair (official typings only have SCALE|WIDTH|HEIGHT).
      if (c.type === 'WIDTH_HEIGHT') {
        if (c.width === w && c.height === h) return es;
        return {
          ...base,
          constraint: { type: 'WIDTH_HEIGHT', value: 0 },
          width: w,
          height: h,
        } as IExportSettings;
      }

      return es;
    });

    frame.exportSettings = next;
  } catch (_) {}
}
