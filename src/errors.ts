export class UsageError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'UsageError';
    this.details = details;
  }
}

export class NoReportsError extends UsageError {
  constructor(message: string, details: readonly string[] = []) {
    super(message, details);
    this.name = 'NoReportsError';
  }
}

export class InfraError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InfraError';
  }
}

export class CaseTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs} ms`);
    this.name = 'CaseTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
