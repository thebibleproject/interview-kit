export type Log = (event: string, fields?: Record<string, unknown>) => void;

/** One JSON line per event. */
export const stdoutLog: Log = (event, fields = {}) => {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`,
  );
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
