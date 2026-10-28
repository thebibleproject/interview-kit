import {
  PermanentError,
  RateLimitError,
  TransientError,
} from "../../external/index.ts";

export type Backoff = { baseMs: number; capMs: number };

export type RetryReason =
  | "permanent"
  | "rate_limit"
  | "transient"
  | "timeout"
  | "unexpected";

type Rule = {
  reason: RetryReason;
  matches: (err: unknown) => boolean;
  retried: boolean;
  countsAttempt: boolean;
};

/** First match wins. RateLimitError extends TransientError, so it comes first. */
const RULES: Rule[] = [
  {
    reason: "permanent",
    matches: (e) => e instanceof PermanentError,
    retried: false,
    countsAttempt: true,
  },
  {
    reason: "rate_limit",
    matches: (e) => e instanceof RateLimitError,
    retried: true,
    countsAttempt: false,
  },
  {
    reason: "transient",
    matches: (e) => e instanceof TransientError,
    retried: true,
    countsAttempt: true,
  },
  {
    reason: "timeout",
    matches: (e) => e instanceof DOMException && e.name === "TimeoutError",
    retried: true,
    countsAttempt: true,
  },
];

const UNEXPECTED: Omit<Rule, "matches"> = {
  reason: "unexpected",
  retried: true,
  countsAttempt: true,
};

export type Decision =
  | { state: "failed"; reason: RetryReason }
  | {
      state: "pending";
      reason: RetryReason;
      attempts: number;
      delayMs: number;
    };

/** `baseMs` doubling per attempt up to `capMs`, with jitter between half and all of it. */
export function backoffMs(attempt: number, { baseMs, capMs }: Backoff): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return ceiling / 2 + (Math.random() * ceiling) / 2;
}

/** What happens to a task whose `attempts`-th attempt threw `err`. */
export function decide(
  err: unknown,
  attempts: number,
  maxAttempts: number,
  backoff: Backoff,
): Decision {
  const rule = RULES.find((r) => r.matches(err)) ?? UNEXPECTED;
  const counted = rule.countsAttempt ? attempts : attempts - 1;
  if (!rule.retried || counted >= maxAttempts)
    return { state: "failed", reason: rule.reason };
  const delayMs = backoffMs(counted, backoff);
  return {
    state: "pending",
    reason: rule.reason,
    attempts: counted,
    delayMs:
      err instanceof RateLimitError
        ? Math.max(err.retryAfterMs, delayMs)
        : delayMs,
  };
}
