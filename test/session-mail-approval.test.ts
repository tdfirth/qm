import { test } from "node:test";
import assert from "node:assert/strict";
import { type OrchestratorInput } from "../src/core/orchestrator.ts";
import { createMemorySessionStore } from "../src/sessions/memory-session-store.ts";
import { createMemoryRunStore } from "../src/runs/memory-run-store.ts";
import { defineHarness } from "../src/harness/harness.ts";
import { createDeliveryStore } from "../src/delivery/delivery-store.ts";
import { scopeId, type Conversation, type Principal } from "../src/types.ts";

import { createAgentTools } from "../src/harness/agent-tools.ts";
import { createMemoryMap } from "../src/persistence/durable-map.ts";
import { createFeatureFlagStore } from "../src/feature-flags.ts";
import { createSessionMailbox, type SessionMessage } from "../src/sessions/session-mailbox.ts";
import { createSessionSyscalls } from "../src/sessions/session-syscalls.ts";
import { createMemoryRunSignalStore } from "../src/runs/run-signal-store.ts";
import { testOrchestrator, unreachableSandbox } from "./support/fakes.ts";

const actor: Principal = { id: "U1", type: "internal" };
const conversation: Conversation = { kind: "dm", threadRef: "web:U1:mail", audience: [actor] };

async function scenario() {
  const sessions = createMemorySessionStore();
  const { runs } = createMemoryRunStore();
  const mailbox = createSessionMailbox(createMemoryMap<SessionMessage>());
  const featureFlags = createFeatureFlagStore(createMemoryMap());
  await featureFlags.setEnabled("persistent_subagents", "personal:U1", true, "test");
  const sessionSyscalls = createSessionSyscalls({
    sessions,
    runs,
    mailbox,
    signals: createMemoryRunSignalStore(),
    maxAttempts: 3,
  });
  const harness = defineHarness(
    {
      id: "pi",
      controlTransport: "in-process",
      toolTransport: "in-process",
      transcriptFormat: "pi",
      capabilities: new Set(),
    },
    {
      async runTurn(turn) {
        await turn.emit({ type: "user", payload: { text: turn.input }, scopeLabel: turn.scopeLabel });
        const ref = {
          current: turn.tools,
          scopeLabel: turn.scopeLabel,
          emit: turn.emit,
          screenToolResult: turn.screenToolResult,
          pendingApprovals: [],
        };
        const tool = createAgentTools(ref).find((tool) => tool.name === "session")!;
        const execute = tool.execute as unknown as (id: string, input: unknown) => Promise<{ content: unknown[] }>;
        const result = await execute("wait-call", { action: "wait", timeoutMs: 0 });
        const reply = JSON.stringify(result.content);
        await turn.emit({ type: "assistant", payload: { text: reply }, scopeLabel: turn.scopeLabel });
        return { reply, modelCalls: 1 };
      },
      async screenSecurity() {
        return { decision: "strict" as const, reason: "test quarantine" };
      },
    },
  );
  const { orchestrator } = testOrchestrator({
    harness,
    sandbox: unreachableSandbox("the retry-replay tests must not provision a sandbox"),
    sessions,
    runs,
    deliveries: createDeliveryStore(),
    featureFlags,
    sessionSyscalls,
  });
  const input: OrchestratorInput = {
    surface: "web",
    actor,
    conversation,
    origin: { kind: "human" },
    text: "Read the file",
  };
  await orchestrator.handleTurn(input);
  const parent = (await sessions.getByThread(conversation.threadRef))!;
  const sender = await sessions.getOrCreateByThread("web:U1:sender", "dm", scopeId("personal", "U1"));
  await sessions.addParticipant(sender.id, actor.id);
  await mailbox.send({
    id: "mail-one",
    senderId: sender.id,
    recipientId: parent.id,
    actor,
    audience: [actor],
    text: "QUARANTINED_FINDING",
    createdAt: Date.now(),
  });
  return { orchestrator, input, mailbox, parent };
}

for (const approved of [true, false]) {
  test(`quarantined agent message ${approved ? "approval delivers" : "denial consumes"} without another prompt`, async () => {
    const r = await scenario();
    const blocked = await r.orchestrator.handleTurn(r.input);
    const approval = blocked.pendingApprovals?.find(
      (item) => item.approvalKey === "security-screen-release:session_message_mail-one",
    );
    assert.ok(approval);
    assert.equal((await r.mailbox.pending(r.parent.id)).length, 1);
    assert.doesNotMatch(blocked.reply ?? "", /QUARANTINED_FINDING/);
    const resolved = await r.orchestrator.handleTurn({
      ...r.input,
      approval: { requestId: approval.requestId, approved },
    });
    if (approved) assert.match(resolved.reply ?? "", /QUARANTINED_FINDING/);
    else assert.equal(resolved.status, "refused");
    assert.equal((await r.mailbox.pending(r.parent.id)).length, 0);
    const next = await r.orchestrator.handleTurn(r.input);
    assert.equal(next.pendingApprovals?.length ?? 0, 0);
  });
}
