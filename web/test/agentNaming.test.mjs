import assert from "node:assert/strict";
import test from "node:test";

import { effectiveAgentName, suggestAgentName } from "../src/lib/agentNaming.ts";

test("uses the suggested agent name when the input is blank", () => {
  assert.equal(effectiveAgentName("", "zeroclaw-talon"), "zeroclaw-talon");
  assert.equal(effectiveAgentName("   ", "zeroclaw-talon"), "zeroclaw-talon");
});

test("uses the typed agent name when one is provided", () => {
  assert.equal(effectiveAgentName("  field-agent  ", "zeroclaw-talon"), "field-agent");
});

test("suggests a framework talon name and avoids existing names", () => {
  assert.equal(suggestAgentName("zeroclaw", []), "researcher-riley");
  assert.equal(
    suggestAgentName("zeroclaw", [
      { name: "researcher-riley" },
      { name: "researcher-riley-2" },
    ]),
    "researcher-riley-3",
  );
});
