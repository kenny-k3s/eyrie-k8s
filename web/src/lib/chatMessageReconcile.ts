import type { ChatMessage } from "./types";

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  return a.role === b.role && a.content === b.content;
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function reconcilePendingMessages(
  pending: ChatMessage[],
  fetched: ChatMessage[],
): ChatMessage[] {
  return pending.filter((pendingMsg) => {
    const pendingTime = parseTimestamp(pendingMsg.timestamp);
    return !fetched.some(
      (msg) => sameMessage(msg, pendingMsg) && parseTimestamp(msg.timestamp) >= pendingTime,
    );
  });
}
