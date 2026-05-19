# Codex Runtime Direction

Status: active development direction
Updated: 2026-05-19

This note records the May 2026 Codex integration decision for Eyrie. It should
be read alongside `docs/plan-onboarding-flow.md`, which remains the broader
source of truth for Eyrie-as-commander and the captain/talon project model.

## Decision

Eyrie should treat Codex as two related runtime paths:

1. **Interactive Codex agents use App Server mode.** These are Eyrie-visible
   agents with ongoing identity and conversation state. Eyrie owns the agent
   identity, routing, hierarchy role, project context, and approval boundary.
   Codex owns the runtime thread, model execution, tool events, diffs, and
   persisted Codex conversation state.
2. **Short-lived talons may use exec mode.** These are task runners launched by
   Eyrie for bounded work: audits, report generation, queue scans, one-off
   implementation attempts, smoke checks, or scheduled work. They should be
   treated as talons: useful, scoped, and observable, but not necessarily
   long-lived Eyrie identities.

In shorthand: **App Server powers live agents; exec powers talon jobs.**

## Lessons From Paperclip

Paperclip's local Codex adapter primarily wraps the `codex` CLI in
`codex exec --json` mode. It pipes prompts over stdin, parses JSONL events,
captures the Codex session id, and resumes future runs against that session.
Paperclip then adds its own harness around Codex: managed per-company
`CODEX_HOME`, auth/config seeding from the user's shared Codex home, injected
skills, managed instruction files, environment variables, worktree/runtime
metadata, and run bookkeeping.

That is valuable prior art, but it is not the same product shape Eyrie needs.
Paperclip is optimized for issue/run dispatch. Eyrie is becoming a control room:
the user should see live turns, tool events, plans, diffs, approvals, and agent
state inside one operating surface.

The parts worth borrowing:

- Managed per-agent or per-runtime `CODEX_HOME` directories.
- Explicit instruction bundles loaded from Eyrie-owned identity/project files.
- Command/path/auth preflight before dispatch.
- Session metadata capture for resumable work.
- JSONL event ingestion for short-lived talon jobs.

The part not to copy as a default:

- Bypassing approvals and sandboxing for convenience. Eyrie should default to
  conservative sandbox and approval policy, then make escalation explicit.

The deeper distinction is product shape. Paperclip does a strong job as a job
launcher: an agent is configured for a run, launches, reports useful progress,
completes the assigned task, and then exits or returns to an idle job state.
That makes it good prior art for talons, batch jobs, and repeatable execution
lanes.

Eyrie should stand out somewhere else: long-lived agents. A Codex-backed Eyrie
agent should feel like an enduring member of the local command hierarchy, not a
fresh subprocess with a convenient prompt. Its identity, parent/captain
relationship, project context, workspace, memory files, approval boundary, and
runtime history should remain visible across turns. Codex supplies the coding
runtime; Eyrie supplies the agent's place in the operating system.

## Why App Server First

Codex App Server is the better fit for Eyrie's primary agent integration
because it exposes threads, turns, streamed item events, command/file-change
items, plan updates, diffs, token updates, and server-initiated approval
requests. Those are control-room primitives. They let Eyrie render the agent's
work as an operational surface rather than as a single final message.

The cost is protocol ownership. Eyrie must handle JSON-RPC request ids,
notification ordering, turn lifecycle, pending approvals, schema drift, process
supervision, and persistent runtime metadata. That cost is justified for live
captains and durable Codex-backed agents.

Exec mode remains useful because it has a simpler subprocess contract. It is
good for talons that should run, produce a result, and disappear or be archived.
It is also a practical fallback if App Server changes or if a task does not
need live interactivity.

## Talon Runtime Model

For Codex, a talon is a short-lived Eyrie-launched runtime with:

- A bounded task prompt.
- A workspace and sandbox policy.
- An instruction bundle derived from Eyrie project/role context.
- JSONL event capture into Eyrie logs or reports.
- A final artifact or message routed back to the captain/user.
- Optional session resume only when the talon is explicitly continuing the
  same task.

Talons should not silently mutate public/project state. They inherit the same
approval boundary as other Eyrie actions: local read-only work is cheap;
filesystem writes, pushes, public comments, external messages, and destructive
actions need explicit policy.

## Development Direction

1. **Codex App Server event fidelity.** Keep expanding the adapter so Eyrie
   understands Codex-native items: command execution, file changes, plans,
   reasoning summaries, web search, tool calls, diffs, errors, and token usage.
2. **Managed Codex home.** Add Eyrie-managed Codex home support so each Codex
   agent can have isolated runtime state and instructions while reusing
   approved auth material safely. The first slice should give each provisioned
   Codex agent a managed `CODEX_HOME`, seed only the minimum auth material
   needed to run, and place Codex-readable instructions in the agent workspace
   so the runtime sees the Eyrie identity rather than the ambient user profile.
3. **Approval bridge.** Replace the current conservative auto-decline behavior
   with an Eyrie approval UI/path that can render the requested command,
   file-change, permission, or user-input prompt and answer App Server.
4. **Exec-mode talons.** Add a `codex exec --json` talon runner for bounded
   background jobs, with captured JSONL events, final summaries, and clear
   parent/captain attribution.
5. **Command-room visibility.** Surface Codex runtime mode, thread/session ids,
   pending approvals, recent tool events, diffs, and talon job history in the
   mission-control surfaces.

## Current Slice

The first Codex adapter slice established `codex app-server` as a provisionable
framework/runtime and kept approvals conservative. The follow-up event-fidelity
slice taught Eyrie to preserve more of what App Server emits so the UI can
evolve from "chat transcript" toward "live control surface."

The current managed-home slice starts the long-lived-agent path: provisioned
Codex agents get an Eyrie-owned `CODEX_HOME`, a Codex-readable `AGENTS.md`
instruction bundle in their workspace, and a minimal auth seed from the user's
approved Codex home. That keeps the runtime local and usable while preventing
the agent from feeling like the ambient user profile wearing a different name.
