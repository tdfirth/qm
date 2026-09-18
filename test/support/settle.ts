import type { Scheduler } from "../../src/cron/scheduler.ts";
import { sleep } from "../../src/util/async.ts";

export async function runNowSettled(scheduler: Scheduler, cronId: string): Promise<void> {
  const r = await scheduler.runNow(cronId);
  if (r.started) await r.settled;
}

export const settle = async (check: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }
    await sleep(100);
  }
  if (lastError !== undefined) console.error("[settle] condition never held; last error:", lastError);
};

export async function waitFor<T>(
  probe: () => T | Promise<T>,
  pred: (value: T) => boolean = Boolean,
  timeoutMs = 3_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (pred(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for condition`);
    await sleep(20);
  }
}
