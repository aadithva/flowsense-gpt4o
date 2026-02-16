import { getEnv } from './env';

// Telemetry is disabled for local development
// In production, configure APPINSIGHTS_CONNECTION_STRING

const isEnabled = () => Boolean(getEnv().APPINSIGHTS_CONNECTION_STRING);

let client: any = null;
let initialized = false;

function getClient() {
  if (initialized) return client;
  initialized = true;

  if (!isEnabled()) return null;

  try {
    // Dynamic import to avoid issues when package isn't configured
    const appInsights = require('applicationinsights');
    appInsights
      .setup(getEnv().APPINSIGHTS_CONNECTION_STRING)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true, false)
      .setAutoCollectRequests(false)
      .setSendLiveMetrics(false)
      .start();
    client = appInsights.defaultClient;
  } catch {
    // Telemetry unavailable
  }

  return client;
}

export function trackEvent(name: string, properties?: Record<string, string>) {
  const c = getClient();
  if (c) c.trackEvent({ name, properties });
}

export function trackMetric(name: string, value: number, properties?: Record<string, string>) {
  const c = getClient();
  if (c) c.trackMetric({ name, value, properties });
}

export function trackException(error: unknown, properties?: Record<string, string>) {
  const c = getClient();
  if (c) c.trackException({
    exception: error instanceof Error ? error : new Error(String(error)),
    properties,
  });
}
