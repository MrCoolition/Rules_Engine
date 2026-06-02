import type { HealthResponse } from '../models';

export const READY_HEALTH: HealthResponse = {
  ok: true,
  store: 'neon',
  databaseConfigured: true,
  defaultDafWorkbook: false,
  defaultSourceWorkbook: false,
  rulesSeeded: true,
  ruleCount: 53,
  executableVariantCount: 32,
  timestamp: ''
};

export function readyHealth(): HealthResponse {
  return {
    ...READY_HEALTH,
    timestamp: new Date().toISOString()
  };
}
