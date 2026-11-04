/**
 * What the vault stores per server for the Services monitor, encrypted in `servers.monitor`.
 * A server is in the Services tab when it has a config.
 */
import type { DiscoveryResult } from './types.js';
import type { DeployScenario } from './deploy.js';

export interface MonitorConfig {
  version: 1;
  /** Last scan, shared with everyone who can open the vault. */
  discovery: DiscoveryResult | null;
  /** Deploy scenario per service id, as the user saved it. */
  scenarios: Record<string, DeployScenario>;
}

export function emptyMonitorConfig(): MonitorConfig {
  return { version: 1, discovery: null, scenarios: {} };
}

/** Lenient: an unreadable or newer value gives an empty config instead of an error. */
export function parseMonitorConfig(text: string): MonitorConfig {
  try {
    const raw = JSON.parse(text) as Partial<MonitorConfig> | null;
    if (!raw || typeof raw !== 'object') return emptyMonitorConfig();
    const discovery = raw.discovery && typeof raw.discovery === 'object' && raw.discovery.version === 1
      && Array.isArray(raw.discovery.services) && Array.isArray(raw.discovery.sites)
      ? raw.discovery
      : null;
    const scenarios: Record<string, DeployScenario> = {};
    if (raw.scenarios && typeof raw.scenarios === 'object') {
      for (const [id, scenario] of Object.entries(raw.scenarios)) {
        if (scenario && typeof scenario.cwd === 'string' && Array.isArray(scenario.steps)) {
          scenarios[id] = {
            cwd: scenario.cwd,
            steps: scenario.steps.filter((step): step is string => typeof step === 'string'),
            updatedAt: typeof scenario.updatedAt === 'string' ? scenario.updatedAt : '',
          };
        }
      }
    }
    return { version: 1, discovery, scenarios };
  } catch {
    return emptyMonitorConfig();
  }
}

export function serializeMonitorConfig(config: MonitorConfig): string {
  return JSON.stringify(config);
}
