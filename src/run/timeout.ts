import { CaseTimeoutError, InfraError } from '../errors.js';

const CANCEL_GRACE_MS = 15_000;

export async function withTimeout<T>(
  timeoutMs: number,
  parent: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
  graceMs: number = CANCEL_GRACE_MS,
): Promise<T> {
  const controller = new AbortController();

  let graceTimer: NodeJS.Timeout | undefined;
  const unresponsive = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        graceTimer = setTimeout(() => {
          reject(
            new InfraError(`The SDK did not stop ${graceMs} ms after the request was cancelled`),
          );
        }, graceMs);
      },
      { once: true },
    );
  });
  unresponsive.catch(() => undefined);

  const abortFromParent = () => {
    controller.abort(parent.reason);
  };
  parent.addEventListener('abort', abortFromParent, { once: true });
  if (parent.aborted) abortFromParent();
  const deadline = setTimeout(() => {
    controller.abort(new CaseTimeoutError(timeoutMs));
  }, timeoutMs);

  const pending = work(controller.signal);
  pending.catch(() => undefined);

  try {
    return await Promise.race([pending, unresponsive]);
  } catch (error) {
    if (controller.signal.reason instanceof CaseTimeoutError && !(error instanceof InfraError)) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    parent.removeEventListener('abort', abortFromParent);
  }
}

export async function withDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new InfraError(`${what} did not finish within ${deadlineMs} ms`));
    }, deadlineMs);
  });
  expired.catch(() => undefined);
  work.catch(() => undefined);
  try {
    return await Promise.race([work, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
