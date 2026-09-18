import type { OrchestratorInput } from "../../src/core/orchestrator.ts";
import type { ActorAssertion, Conversation, Principal, TurnRequest } from "../../src/types.ts";

export function turnRequest(
  text: string,
  actor: ActorAssertion,
  conversation: TurnRequest["conversation"],
  extra: Partial<TurnRequest> = {},
): TurnRequest {
  return { surface: "test", actor, conversation, text, ...extra };
}

export function dmTurn(
  text: string,
  actor: ActorAssertion,
  threadRef: string,
  extra: Partial<TurnRequest> = {},
): TurnRequest {
  return turnRequest(text, actor, { kind: "dm", threadRef }, extra);
}

export function channelTurn(
  text: string,
  actor: ActorAssertion,
  channel: string,
  root: string,
  extra: Partial<TurnRequest> = {},
): TurnRequest {
  return turnRequest(
    text,
    actor,
    { kind: "channel", threadRef: `ch:${channel}:${root}`, channelRef: channel, audience: [actor] },
    { surface: "slack", ...extra },
  );
}

export function orchestratorTurn(
  text: string,
  actor: Principal,
  conversation: Conversation,
  extra: Partial<OrchestratorInput> = {},
): OrchestratorInput {
  return { surface: "test", actor, conversation, origin: { kind: "direct" }, text, ...extra };
}
