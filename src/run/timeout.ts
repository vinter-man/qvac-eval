import { CaseTimeoutError, InfraError } from '../errors.js';

export const CANCEL_GRACE_MS = 15_000;

export async function withTimeout<T>(
  timeoutMs: number,
  parent: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
  graceMs: number = CANCEL_GRACE_MS,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => {
    controller.abort(parent.reason);
  };
  if (parent.aborted) abortFromParent();
  parent.addEventListener('abort', abortFromParent, { once: true });
  const deadline = setTimeout(() => {
    controller.abort(new CaseTimeoutError(timeoutMs));
  }, timeoutMs);

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
