import { createChartVisuals } from '../views/chart-visuals.js';
declare const __MAIMAI_CHART_THEME__: unknown;
const facade = globalThis as unknown as Record<string, unknown>;
Object.assign(globalThis, {
  maimaiChartVisuals: createChartVisuals({ configuration: { theme: __MAIMAI_CHART_THEME__ } }),
});
