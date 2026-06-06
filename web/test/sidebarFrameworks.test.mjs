import assert from "node:assert/strict";
import test from "node:test";

import { frameworkDotClass, sidebarFrameworkIds } from "../src/lib/sidebarFrameworks.ts";

test("sidebar framework list uses framework setup health, not agent-only framework state", () => {
  assert.deepEqual(
    sidebarFrameworkIds([
      { id: "zeroclaw", status: { isReady: true, badge: { color: "green" } } },
      { id: "openclaw", status: { isReady: false, badge: { color: "yellow" } } },
      { id: "failedclaw", status: { isReady: false, badge: { color: "red" } } },
      { id: "freshclaw", status: { isReady: false, badge: null } },
    ], ["picoclaw", "zeroclaw"]),
    ["zeroclaw", "openclaw", "failedclaw"],
  );
});

test("framework dot renders setup warnings and errors without using agent status", () => {
  assert.equal(frameworkDotClass({ isReady: true, badge: { color: "green" } }), "bg-green");
  assert.equal(frameworkDotClass({ isReady: false, badge: { color: "yellow" } }), "bg-yellow");
  assert.equal(frameworkDotClass({ isReady: false, badge: { color: "red" } }), "bg-red");
  assert.equal(frameworkDotClass({ isReady: false, badge: null }), "bg-text-muted/30");
});
