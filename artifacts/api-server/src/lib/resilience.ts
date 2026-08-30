import { logger } from "./logger";

// =====================================================================
// Resilience infrastructure for the IT Operations Control Tower API.
//
// Patterns implemented (per prompt_v3 §resilience):
//   1. Exponential backoff + jitter   — retry transient failures
//   2. Circuit breaker                 — stop hammering a dead service
//   3. Dead Letter Queue (DLQ)         — persist unhandled work (DB table)
//   4. Graceful degradation            — cached/frozen fallback data
//   5. Alerting engine                 — multi-channel on CRITICAL breaches
//
// All helpers are safe to use even when DATABASE_URL is unset (they
// degrade to in-memory / no-op behaviour rather than throwing).
// =====================================================================

// ---------------------------------------------------------------------
// 1. Exponential backoff + jitter
//    Delays: 1s -> 2s -> 4s (base * 2^attempt) with random ±30% jitter.
// ---------------------------------------------------------------------
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 32000;

export function backoffDelay(attempt: number, baseMs = BACKOFF_BASE_MS): number {
  const exponential = baseMs * 2 ** attempt;
  const capped = Math.min(exponential, BACKOFF_MAX_MS);
  const jitter = 0.7 + Math.random() * 0.6; // 0.7 .. 1.3
  return Math.round(capped * jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
  shouldRetry?: (error: unknown) => boolean;
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? BACKOFF_BASE_MS;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= maxAttempts - 1) break;
      if (options.onRetry) options.onRetry(attempt + 1, error);
      await sleep(backoffDelay(attempt, baseDelayMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------
// 2. Circuit breaker
//    Trips to OPEN after `failureThreshold` consecutive failures;
//    resets (half-open probe) after `resetMs`.
// ---------------------------------------------------------------------
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;
  readonly name: string;
  readonly failureThreshold: number;
  readonly resetMs: number;

  constructor(name: string, failureThreshold = 5, resetMs = 30_000) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
  }

  get currentState(): CircuitState {
    if (this.state === "OPEN" && Date.now() - this.openedAt >= this.resetMs) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  private isAllowed(): boolean {
    const state = this.currentState;
    if (state === "CLOSED") return true;
    if (state === "HALF_OPEN") return true; // allow single probe
    return false;
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state !== "CLOSED") {
      this.state = "CLOSED";
      logger.info({ circuit: this.name }, "circuit breaker closed");
    }
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold && this.state !== "OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
      logger.error(
        { circuit: this.name, failures: this.consecutiveFailures },
        "circuit breaker tripped OPEN",
      );
      alertEngine.critical({
        code: "CIRCUIT_OPEN",
        message: `Circuit breaker '${this.name}' tripped open after ${this.consecutiveFailures} consecutive failures`,
        detail: { failures: this.consecutiveFailures },
      });
    }
  }

  /**
   * Executes `fn` guarded by the breaker. When OPEN (and not half-open
   * probe) it refuses to call the downstream and throws a CircuitOpenError.
   * On success/failure it records outcome automatically.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAllowed()) {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}

export class CircuitOpenError extends Error {
  readonly circuitName: string;
  constructor(circuitName: string) {
    super(`Circuit '${circuitName}' is open; refusing upstream call`);
    this.name = "CircuitOpenError";
    this.circuitName = circuitName;
  }
}

// ---------------------------------------------------------------------
// 4. Graceful degradation
//    Wrap a live fetch and fall back to stable/frozen data when it fails
//    or the circuit is open.
// ---------------------------------------------------------------------
export async function withGracefulDegradation<T>(
  live: () => Promise<T>,
  fallback: () => T,
  fallbackData?: T,
): Promise<{ data: T; degraded: boolean }> {
  try {
    const data = await live();
    return { data, degraded: false };
  } catch (error) {
    logger.warn({ err: error }, "degrading to fallback data");
    return { data: fallbackData ?? fallback(), degraded: true };
  }
}

// ---------------------------------------------------------------------
// 5. Alerting engine — multi-channel dispatch on CRITICAL breaches.
//    Channels are best-effort and log when not configured, so this never
//    crashes the request path.
// ---------------------------------------------------------------------
type AlertLevel = "CRITICAL" | "WARNING" | "INFO";
type AlertChannel = "slack" | "sms" | "email";

export type AlertPayload = {
  code: string;
  message: string;
  level?: AlertLevel;
  detail?: Record<string, unknown>;
};

const ALERT_LEVEL_BREACH: Record<AlertLevel, number> = {
  INFO: 1,
  WARNING: 2,
  CRITICAL: 3,
};

function alertConfig(channel: AlertChannel): string | undefined {
  switch (channel) {
    case "slack":
      return process.env.ALERT_SLACK_WEBHOOK;
    case "sms":
      return process.env.ALERT_SMS_ENDPOINT;
    case "email":
      return process.env.ALERT_EMAIL_ENDPOINT;
    default:
      return undefined;
  }
}

async function dispatchChannel(
  channel: AlertChannel,
  payload: AlertPayload,
): Promise<void> {
  const endpoint = alertConfig(channel);
  if (!endpoint) {
    if (payload.level === "CRITICAL") {
      logger.warn(
        { alert: payload.code, channel, message: payload.message },
        "alert channel not configured; logged only",
      );
    }
    return;
  }
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    logger.error(
      { channel, alert: payload.code, err: error },
      "alert dispatch failed",
    );
  }
}

const alertEngine = {
  configure() {
    // reserved for runtime re-configuration
  },
  async dispatch(payload: AlertPayload): Promise<void> {
    const level = payload.level ?? "INFO";
    const activeChannels: AlertChannel[] = payload.level === "CRITICAL"
      ? ["slack", "sms", "email"]
      : ["slack"];
    // Fire all channels in parallel; never block caller on a slow alert.
    await Promise.allSettled(
      activeChannels.map((channel) => dispatchChannel(channel, payload)),
    );
  },
  async critical(payload: Omit<AlertPayload, "level">): Promise<void> {
    return this.dispatch({ ...payload, level: "CRITICAL" });
  },
  async warning(payload: Omit<AlertPayload, "level">): Promise<void> {
    return this.dispatch({ ...payload, level: "WARNING" });
  },
  isBreach(configured: AlertLevel, observed: AlertLevel): boolean {
    return ALERT_LEVEL_BREACH[observed] >= ALERT_LEVEL_BREACH[configured];
  },
};

// ---------------------------------------------------------------------
// 3. Dead Letter Queue (DLQ)
//    Persists unhandled work to the `dlq_entries` table. The service layer
//    injects a `capture` function backed by the DB; when unavailable we
//    fall back to an in-memory buffer so failures are never dropped.
// ---------------------------------------------------------------------
export type DlqCaptureFn = (
  payload: Record<string, unknown>,
  error: { code?: string; message?: string },
) => Promise<void> | void;

const memoryDlq: Array<{
  payload: Record<string, unknown>;
  code?: string;
  message?: string;
  capturedAt: string;
}> = [];let dlqCapture: DlqCaptureFn | null = null;

export function registerDlqCapture(fn: DlqCaptureFn): void {
  dlqCapture = fn;
}

export async function captureToDlq(
  payload: Record<string, unknown>,
  error: { code?: string; message?: string },
): Promise<void> {
  try {
    if (dlqCapture) {
      await dlqCapture(payload, error);
      return;
    }
  } catch (captureError) {
    logger.error({ err: captureError }, "DLQ capture failed; falling back to memory");
  }
  memoryDlq.push({
    payload,
    code: error.code,
    message: error.message,
    capturedAt: new Date().toISOString(),
  });
  if (memoryDlq.length > 500) memoryDlq.shift(); // bound the in-memory buffer
}

export function getMemoryDlq() {
  return memoryDlq;
}

// Convenience wrapper: run an operation, and if it errors, capture the
// failure to the DLQ and rethrow so callers can decide whether to degrade.
export async function withDlq<T>(
  payload: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const err = error as { code?: string; message?: string };
    await captureToDlq(payload, {
      code: err?.code ?? "UNKNOWN_ERROR",
      message: err?.message ?? String(error),
    });
    throw error;
  }
}

export const resilience = {
  withRetry,
  sleep,
  backoffDelay,
  CircuitBreaker,
  CircuitOpenError,
  withGracefulDegradation,
  alertEngine,
  captureToDlq,
  registerDlqCapture,
  getMemoryDlq,
  withDlq,
};
