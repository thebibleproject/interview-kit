export type ServiceName = "media" | "transcriber" | `store:${string}`;

export abstract class ExternalServiceError extends Error {
  abstract readonly retryable: boolean;
  readonly service: ServiceName;

  constructor(
    message: string,
    { service, cause }: { service: ServiceName; cause?: unknown },
  ) {
    super(`${service}: ${message}`, { cause });
    this.name = new.target.name;
    this.service = service;
  }
}

/** The call failed, but the same call may succeed if tried again. */
export class TransientError extends ExternalServiceError {
  readonly retryable = true;
}

/** Too many concurrent calls. Wait at least `retryAfterMs` before trying again. */
export class RateLimitError extends TransientError {
  readonly retryAfterMs: number;

  constructor(
    message: string,
    {
      retryAfterMs,
      ...options
    }: { service: ServiceName; retryAfterMs: number },
  ) {
    super(message, options);
    this.retryAfterMs = retryAfterMs;
  }
}

/** The call can never succeed with this input. Retrying will not help. */
export class PermanentError extends ExternalServiceError {
  readonly retryable = false;
}
