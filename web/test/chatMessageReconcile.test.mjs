import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePendingMessages } from "../src/lib/chatMessageReconcile.ts";

test("keeps a repeated optimistic message until the fetched copy is at least as new", () => {
  const pending = [
    {
      role: "user",
      content: "ok",
      timestamp: "2026-05-20T00:00:10.000Z",
    },
  ];
  const fetched = [
    {
      role: "user",
      content: "ok",
      timestamp: "2026-05-20T00:00:05.000Z",
    },
  ];

  assert.deepEqual(reconcilePendingMessages(pending, fetched), pending);
});

test("drops a pending message once the fetched session includes the persisted copy", () => {
  const pending = [
    {
      role: "user",
      content: "ok",
      timestamp: "2026-05-20T00:00:10.000Z",
    },
  ];
  const fetched = [
    {
      role: "user",
      content: "ok",
      timestamp: "2026-05-20T00:00:10.000Z",
    },
  ];

  assert.deepEqual(reconcilePendingMessages(pending, fetched), []);
});
