import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { createMemorySessionStore } from "../src/sessions/memory-session-store.ts";
import { createPostgresSessionStore } from "../src/sessions/postgres-session-store.ts";
import { applyPgMigrations, registeredPgMigrations } from "../src/persistence/pg-pool.ts";
import { tapeTranscriptEntryRecord, type SessionStore } from "../src/sessions/session-store.ts";
import { createTranscriptSource } from "../src/harness/tape-projection.ts";
import { migrateTranscriptPage } from "../scripts/lib/transcript-tape-migration.ts";
import { scopeId, type SessionEntry } from "../src/types.ts";

const scope = scopeId("personal", "sparse");
const entries = (sessionId: string): SessionEntry[] =>
  [2, 5, 9].map((seq) => ({
    sessionId,
    seq,
    parentSeq: seq - 1,
    type: "user",
    payload: { text: `sparse row ${seq}` },
    scopeLabel: scope,
    createdAt: seq,
  }));

async function exercise(store: SessionStore, id: string) {
  await store.addParticipant(id, "owner", undefined, { includeHistory: true });
  assert.deepEqual(await store.getEntries(id), entries(id));
  assert.equal(await store.latestEntrySeq(id), 9);
  assert.equal(await store.countEntries(id), 3);
  const source = createTranscriptSource(store);
  assert.deepEqual(await source.forRender(id, { limit: 1 }), { entries: entries(id).slice(-1), earlier: 2 });
  assert.deepEqual(await source.forViewer(id, "owner", { limit: 1 }), { entries: entries(id).slice(-1), earlier: 2 });
  assert.equal((await source.forRender(id)).earlier, 0);
  assert.deepEqual(
    (await store.getEntries(id, { sinceSeq: 4 })).map((e) => e.seq),
    [5, 9],
  );
  assert.equal((await store.searchEntries("owner", "sparse")).length, 3);
  await store.addParticipant(id, "late");
  assert.deepEqual(await store.visibleEntries(id, "late"), []);
  const lease = (await store.acquireLease(id)).lease!;
  const appended = await store.append(lease, { type: "assistant", payload: { text: "continued" }, scopeLabel: scope });
  assert.equal(appended.seq, 10);
  assert.equal(appended.parentSeq, 9);
  assert.deepEqual(await store.visibleEntries(id, "late"), [appended]);
  await store.removeParticipant(id, "late");
  await store.append(lease, { type: "user", payload: { text: "after departure" }, scopeLabel: scope });
  assert.deepEqual(await store.visibleEntries(id, "late"), [appended]);
  await store.releaseLease(lease);
  const summary = (await store.scopeSessionSummaries(scope, false)).find((item) => item.id === id)!;
  assert.equal(summary.messages, 5);
  assert.equal(summary.turns, 4);
  const group = (await store.scopeCronGroups(scope, false)).find((item) => item.cronId === "sparse")!;
  assert.equal(group.messages, 5);
  assert.equal(group.turns, 4);
}

test("memory preserves sparse transcript identities, counts and tenure", async () => {
  const store = createMemorySessionStore();
  const session = await store.getOrCreateByThread("cron:sparse:memory", "dm", scope);
  const lease = (await store.acquireLease(session.id)).lease!;
  for (const entry of entries(session.id)) await store.appendTape(lease, tapeTranscriptEntryRecord(entry));
  await store.releaseLease(lease);
  await exercise(store, session.id);
});

test(
  "Postgres sparse backfill qualifies exact identities without inventing missing entries",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `sparse_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const pool = new pg.Pool({ connectionString: url.toString() });
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      createPostgresSessionStore(url.toString());
      const migrations = registeredPgMigrations(url.toString());
      const authority = migrations.find((m) => m.id === "sessions/store/0018-transcript-authority")!;
      await applyPgMigrations(
        pool,
        migrations.filter((m) => m !== authority),
      );
      await client.query(
        "INSERT INTO sessions(id,type,scope_id,thread_ref,created_at) VALUES('sparse','dm',$1,'cron:sparse:pg',1)",
        [scope],
      );
      for (const entry of entries("sparse"))
        await client.query(
          "INSERT INTO session_entries(session_id,seq,parent_seq,type,payload,scope_label,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            entry.sessionId,
            entry.seq,
            entry.parentSeq,
            entry.type,
            JSON.stringify(entry.payload),
            entry.scopeLabel,
            entry.createdAt,
          ],
        );
      await client.query(
        "INSERT INTO session_entries(session_id,seq,parent_seq,type,payload,scope_label,created_at) VALUES('sparse',-1,NULL,'user','{}',$1,0)",
        [scope],
      );
      await assert.rejects(
        migrateTranscriptPage(client, "sparse", { afterSeq: -1, limit: 1, apply: true }),
        /invalid sequence/,
      );
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM session_tape WHERE session_id='sparse'")).rows[0].n,
        0,
      );
      await client.query("DELETE FROM session_entries WHERE session_id='sparse' AND seq=-1");
      for (const [afterSeq, expectedSeq] of [
        [-1, 2],
        [2, 5],
        [5, 9],
      ]) {
        const page = await migrateTranscriptPage(client, "sparse", { afterSeq: afterSeq!, limit: 1, apply: true });
        assert.deepEqual(page, { busy: false, scanned: 1, changed: 1, afterSeq: expectedSeq });
      }
      await client.query("DELETE FROM session_tape WHERE session_id='sparse' AND entry_seq=5");
      await assert.rejects(applyPgMigrations(pool, [authority]), /migration is incomplete/);
      await migrateTranscriptPage(client, "sparse", { afterSeq: 2, limit: 1, apply: true });
      await applyPgMigrations(pool, [authority]);
      const store = createPostgresSessionStore(url.toString());
      await store.getEntries("sparse");
      await client.query("UPDATE sessions SET messages=10,turns=10,last_activity=0 WHERE id='sparse'");
      await exercise(store, "sparse");
      assert.deepEqual(
        (
          await client.query(
            "SELECT seq,parent_seq FROM session_entries WHERE session_id='sparse' AND seq<10 ORDER BY seq",
          )
        ).rows,
        [
          { seq: 2, parent_seq: 1 },
          { seq: 5, parent_seq: 4 },
          { seq: 9, parent_seq: 8 },
        ],
      );
    } finally {
      await client.end();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
