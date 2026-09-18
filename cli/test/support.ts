import type { TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type EnvVars = Record<string, string | undefined>;

function assignEnv(vars: EnvVars): () => void {
  const prior = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return () => assignEnv(prior);
}

export function setEnv(t: TestContext, vars: EnvVars): void {
  t.after(assignEnv(vars));
}

export function withEnv<T>(vars: EnvVars, fn: () => T): T {
  const restore = assignEnv(vars);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}
