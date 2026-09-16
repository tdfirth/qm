import { createPostgresSessionStore } from "../src/sessions/postgres-session-store.ts";
import { migrateRegisteredPgSchemas } from "../src/persistence/pg-pool.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
createPostgresSessionStore(url);
console.log(JSON.stringify({ event: "transcript-cutover-start" }));
await migrateRegisteredPgSchemas(url);
console.log(JSON.stringify({ event: "transcript-cutover-qualified" }));
