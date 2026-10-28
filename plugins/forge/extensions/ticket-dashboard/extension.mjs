import { createCanvas, CanvasError, joinSession } from '@github/copilot-sdk/extension';
import { dashboardOptions } from './dashboard.mjs';

const session = await joinSession({
  canvases: [createCanvas(dashboardOptions(CanvasError, (error) => {
    session.log(`Forge dashboard: ${error.message}`, { level: 'error' });
  }))],
});
