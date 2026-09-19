import { definePgMigration } from "../persistence/pg-pool.ts";
import schema from "./vendor/absurd-0.5.0.json" with { type: "json" };

export const DURABLE_RETRY_STRATEGY = { kind: "exponential", base_seconds: 1, factor: 2, max_seconds: 300 };
export const DURABLE_RETRY_OPTIONS_SQL = `'${JSON.stringify({ retry_strategy: DURABLE_RETRY_STRATEGY })}'::jsonb`;

export const ABSURD_MIGRATION = definePgMigration("absurd/0001-schema-0.5.0", schema.statements);

export function absurdQueueMigration(queue: string) {
  if (!/^[a-z][a-z0-9_]{0,56}$/.test(queue)) throw new Error(`Invalid workflow queue: ${queue}`);
  return definePgMigration(`absurd/0002-queue-${queue}`, [`SELECT absurd.create_queue('${queue}')`]);
}
