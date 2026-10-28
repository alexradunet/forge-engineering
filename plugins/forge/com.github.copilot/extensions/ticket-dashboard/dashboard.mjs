import { readTickets, validateInput } from './tickets.mjs';
import { startDashboard } from './server.mjs';

export function dashboardOptions(CanvasError, reportError) {
  const instances = new Map();
  const pending = new Map();
  const expectedError = (error) => new CanvasError('forge_dashboard_error', error.message);
  return {
    id: 'forge-ticket-dashboard',
    displayName: 'Forge tickets',
    description: 'Read-only dashboard of Forge tickets, next actions, and review gates in a repository wiki.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['wikiPath'],
      properties: { wikiPath: { type: 'string', description: 'Absolute repository wiki path from forge.mjs where --json.' } },
    },
    actions: [{
      name: 'refresh',
      description: 'Read the current tickets and errors for this dashboard without changing any files or approvals.',
      async handler(ctx) {
        try {
          if (ctx.input != null && (typeof ctx.input !== 'object' || Array.isArray(ctx.input) || Object.keys(ctx.input).length)) {
            throw new Error('Refresh takes no input; it uses the open dashboard wiki.');
          }
          await pending.get(ctx.instanceId);
          const entry = instances.get(ctx.instanceId);
          if (!entry) throw new Error('Open the dashboard before refreshing it.');
          return await readTickets(entry.wikiPath);
        } catch (error) { throw expectedError(error); }
      },
    }],
    async open(ctx) {
      const previous = pending.get(ctx.instanceId) ?? Promise.resolve();
      const operation = previous.catch(reportError).then(async () => {
        try {
          const wikiPath = validateInput(ctx.input);
          const snapshot = await readTickets(wikiPath);
          let entry = instances.get(ctx.instanceId);
          if (entry && entry.wikiPath !== snapshot.wikiPath) {
            await entry.close();
            instances.delete(ctx.instanceId);
            entry = null;
          }
          if (!entry) {
            entry = await startDashboard(snapshot.wikiPath, reportError);
            instances.set(ctx.instanceId, entry);
          }
          return { title: 'Forge tickets', url: entry.url };
        } catch (error) { throw expectedError(error); }
      });
      pending.set(ctx.instanceId, operation);
      try { return await operation; }
      finally {
        if (pending.get(ctx.instanceId) === operation) pending.delete(ctx.instanceId);
      }
    },
    async onClose(ctx) {
      try {
        await pending.get(ctx.instanceId);
        const entry = instances.get(ctx.instanceId);
        if (entry) {
          await entry.close();
          instances.delete(ctx.instanceId);
        }
      } catch (error) { reportError(error); }
    },
  };
}
