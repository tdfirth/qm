# Durable workflows

QM uses Absurd 0.5.0 inside its existing PostgreSQL database. The schema is vendored, checksummed, and installed by the normal migration runner. Workers run in the QM process; no additional service is required. Production requires PostgreSQL. The memory adapter is for tests and disposable local instances.

The vendored Absurd SQL retains its third-party license in `src/durable/vendor/ABSURD-LICENSE`. The adjacent JSON records the pinned upstream source and the modifications made when importing it. Seed skills remain subject to the existing MIT-only check; the license check explicitly recognizes this Absurd component.

## Ownership

Absurd owns attempts, leases, retry timing, checkpoints, sleeps, and event waits. QM retains runs, session history and tape, deliveries, cron history, loops, approvals, credentials, and other product records. Those records remain the authorization and user-facing state.

| Queue           | Work                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `qm_runs`       | Run execution, per-session ordering, worker replacement                                |
| `qm_handoffs`   | Final-result delivery admission, child returns, orphaned signals, swarm reconciliation |
| `qm_deliveries` | Slack messages, files, approvals, and web transcript delivery                          |
| `qm_ingress`    | Accepted Slack event and interaction envelopes                                         |
| `qm_triggers`   | Cron occurrences, webhook work, process monitors, credential continuations             |
| `qm_loops`      | Loop fires, shipping, follow-up, item actions, and returns                             |
| `qm_memory`     | Delayed, batched automatic memory capture                                              |

Run and delivery admission commit their Absurd task in the same transaction as the domain row. Terminal run updates, pending signals, and swarm transitions create their continuations transactionally. Other workflows use durable domain receipts and deterministic admission keys so interrupted admission can be reconstructed.

The run tape remains the model's recovery record. Workflow checkpoints do not serialize a JavaScript stack. A replacement worker reconstructs the turn from committed history, goals, inbound file paths, and staged attachments. Session writes are fenced by the specific run attempt's lease. An expired worker cannot keep writing or release its successor's session lease.

## Effects and retries

Each workflow separates durable admission, execution, and delivery. Named checkpoints reuse completed work. Database mutations that can commit before their checkpoint have stable operation receipts. Current authorization is checked again when work resumes; a recorded grant is not a permanent permission.

External APIs cannot generally promise exactly-once effects. Slack delivery uses stable message metadata and staged file IDs to discover accepted effects before retrying. Source sends that cannot safely reconcile an uncertain response stop for operator reconciliation rather than blindly sending again. Progress messages are disposable; a per-run lock and terminal-state check prevent late progress from replacing a final answer.

A browser is not required to complete web delivery. The delivery worker writes the durable transcript, and reconnecting clients refresh it. Slack receivers persist the incoming envelope before acknowledging it. Missing adapters defer their work without exhausting a failure budget.

Native retry policies use exponential backoff. Accepted follow-on obligations use unbounded retry where abandoning them would lose work. Run retry and age limits remain bounded product policy. Failed and waiting tasks, their attempts, checkpoints, and error history remain in the `absurd` schema for inspection. Do not delete that history while a replay or idempotency key may still be needed.

## Deployment from the previous runtime

This migration requires a coordinated cutover. It is not compatible with rolling old and new producers together.

1. Back up PostgreSQL and record the deployed revision.
2. Stop admitting requests and drain or stop all old web, Slack, scheduler, and worker processes. No old binary may insert runs after migration begins.
3. Run the new migration runner, then start the new deployment. Existing queued and running runs are adopted into native tasks; old turn leases are invalidated. Pending delivery, signal, child-return, monitor, and swarm obligations are recovered from their domain records.
4. Verify a real turn and final delivery, then cron and monitor work, before reopening admission.

Old workers cannot safely execute the new ownership protocol. Returning to an old binary requires a coordinated database restore or a separately reviewed reverse migration; changing the deployed image alone is not a rollback. Preserve the `absurd` schema and task history across normal updates. Existing legacy queue tables can remain during the cutover; the new runtime does not consume them.

Later deployments use the ordinary admission gate and drain protocol. Shutdown stops new claims, waits for admitted work within the configured drain period, then cancels workflow contexts and stops renewing remaining leases. Replacement workers wait for native lease expiry before recovering unfinished attempts.

## Validation

The durable runtime tests exercise transactional rollback, deduplicated admission, cross-worker checkpoints and events, startup recovery, claim races, lease expiry, and bounded shutdown. Run tests cover FIFO, stale-owner fencing, retries, cancellation, and migration adoption. Workflow tests inject failures between domain writes and checkpoints and verify later authorization changes. Delivery tests cover uncertain Slack posts and uploads, approval cards, missing adapters, account routing, and browser-independent transcript writes.

Use `npm run test:pg` with a disposable PostgreSQL database and a role allowed to create test databases. The new workflow tests isolate schemas in separate databases because Absurd queue tables live in the shared `absurd` schema. Use the dev-instance skill for real-model Slack and web verification.
