/**
 * A bound on how long a promise may take. Chromium eventually gives up on a
 * request routed through a dead proxy, but not on any timescale a person is
 * willing to stare at a spinner for.
 */

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });

  // The losing promise keeps running; nothing downstream is waiting on it.
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
