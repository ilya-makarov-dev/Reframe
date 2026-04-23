// Adapter system — the unified operation contract. See types.ts.

export * from './types.js';
export {
  registerAdapter,
  getAdapter,
  listAdapters,
  clearAdapters,
  invokeAdapter,
  validateInputs,
  formatAdapter,
} from './registry.js';
