# Eyrie Live Thread Inventory

Last updated: 2026-05-25

Purpose: keep the current Eyrie, ZeroClaw, and agent-runtime dogfood threads visible in one place. This is not a commitment to integrate every test runtime. It is a map of what exists, what should be wired into Eyrie now, and what should remain track-only until it earns a permanent slot.

## Current Shape

Eyrie currently has two different views of agent state:

- Eyrie-provisioned instances in `~/.eyrie/instances`.
- External runtimes discovered through `~/.eyrie/config.toml` `discovery.config_paths`.

Fred belongs to the second category right now: an external ZeroClaw v0.8 runtime in its own project tree at `/Users/natalie/Development/finance/fred`, with live config at `/Users/natalie/Development/finance/fred/zeroclaw-config/config.toml`.

The local Agent Mesh also exists outside the public Eyrie repo at `/Users/natalie/Development/EyrieOps/docs/agent-mesh`. The current Eyrie UI reports that no mesh is configured because `~/.eyrie/config.toml` does not point to that mesh directory yet.

Applied local config update: `~/.eyrie/config.toml` now points `[mesh].agent_mesh_dir` at the EyrieOps mesh and includes Fred's ZeroClaw config path in discovery. A timestamped backup was created before the edit.

## Integrate Now

### EyrieOps Agent Mesh

Status: should be wired into Eyrie now.

Root:

```text
/Users/natalie/Development/EyrieOps/docs/agent-mesh
```

Reason: this is the private operating-state mesh for Magnus, Danya, Hermes, and Clio. Eyrie already supports this through `EYRIE_AGENT_MESH_DIR` or `[mesh].agent_mesh_dir`.

Config target:

```toml
[mesh]
  agent_mesh_dir = "/Users/natalie/Development/EyrieOps/docs/agent-mesh"
```

Expected result: the `mesh_status` page should stop showing "No local agent mesh is configured" and should render the manifest/inbox state from the private EyrieOps mesh.

### Fred Finance Runtime

Status: should be added to Eyrie discovery now.

Root:

```text
/Users/natalie/Development/finance/fred
```

ZeroClaw config:

```text
/Users/natalie/Development/finance/fred/zeroclaw-config/config.toml
```

Current known agents:

- `fred`, supervised local finance agent.
- `finance_clerk`, read-only local finance clerk.

Reason: Fred is the first clean v0.8 dogfood runtime we intentionally stood up as a project-specific agent system. It should be visible in Eyrie, even if Eyrie does not yet fully manage its lifecycle.

Config target:

```toml
[discovery]
  config_paths = [
    "~/.openclaw/openclaw.json",
    "~/.zeroclaw/config.toml",
    "~/.picoclaw/config.json",
    "~/.hermes/config.yaml",
    "~/.codex-eyrie/config.json",
    "/Users/natalie/Development/finance/fred/zeroclaw-config/config.toml",
  ]
```

Observed result: Eyrie discovers the config, but currently shows it as another generic `zeroclaw` row on `127.0.0.1:42619` and reports it as non-responding.

Identity note: Eyrie discovery currently reads a ZeroClaw display name from `workspace/IDENTITY.md` beside the config directory. Fred's identity lives at `/Users/natalie/Development/finance/fred/IDENTITY.md`, so Eyrie does not pick it up. The durable fix is for Eyrie to understand ZeroClaw v3 workspace paths and agent identities instead of assuming `config_dir/workspace/IDENTITY.md`.

## Track Only

### Default ZeroClaw Daemon

Observed command:

```text
/Users/dan/.cargo/bin/zeroclaw daemon
```

Likely config:

```text
~/.zeroclaw/config.toml
```

Status: keep visible, do not merge with Fred.

Reason: this is the default user ZeroClaw runtime. It may be useful as a baseline, but project-specific runtimes should not silently collapse into it.

### Danya Runtime

Observed command:

```text
/Users/dan/.cargo/bin/zeroclaw --config-dir /Users/dan/.zeroclaw-danya daemon
```

Status: track and preserve separately.

Reason: this is the Danya-agent runtime lineage, not Danya as the assistant identity. It should eventually become "Danya's agent" in Eyrie, under Magnus, but it should not be confused with Fred or the default ZeroClaw daemon.

### Bounty Scout ZeroClaw v0.8 Runtime

Observed command:

```text
/Users/natalie/Development/bounty-work/zeroclaw-bounty-scout/bin/zeroclaw-080 --config-dir /Users/natalie/Development/bounty-work/zeroclaw-bounty-scout/zeroclaw-config daemon
```

Status: track only.

Reason: useful as a v0.8 validation/runtime thread, but it belongs to bounty-scout dogfooding unless promoted.

### Eyrie-Provisioned Test Instances

Source:

```text
~/.eyrie/instances
```

Observed examples:

- `Captain` on PicoClaw, stopped.
- `Captain A` on ZeroClaw, error.
- `Aa` on ZeroClaw, stopped.
- `Researcher Riley` on ZeroClaw, stopped.
- `Finance Tracker Captain` on Hermes, running.

Status: keep visible for now, cleanup later.

Reason: these look like prior Eyrie provisioning and lifecycle tests. They explain the sidebar clutter. Do not delete them until we have a cleanup rule, because they are useful evidence for what Eyrie has been exercising.

Follow-up: add an Eyrie cleanup/archive flow for stale provisioned instances and orphaned projects.

## Open Threads

### Discovery Identity

Risk: external ZeroClaw configs may be discovered under a generic `zeroclaw` name instead of their project identity.

Desired behavior: Eyrie should show Fred as Fred, or as `Fred / ZeroClaw`, not as another indistinct ZeroClaw row.

### Runtime Registry

Risk: Eyrie has discovery paths, provisioned instances, and a private runtime registry, but no single visible inventory tying them together.

Desired behavior: Eyrie should have a runtime registry view that can show:

- managed Eyrie instances;
- discovered external runtimes;
- private mesh agents;
- project ownership;
- integration status: managed, discovered, track-only, archived.

### Instance Cleanup

Risk: old test instances remain in the sidebar after projects are stopped or removed.

Desired behavior: Eyrie should support explicit archive/delete for stale instance records, with logs preserved or intentionally discarded.

## Immediate Next Step

Restart the Eyrie backend so the browser UI reloads the updated local config. After that:

1. Confirm `mesh_status` reads `/Users/natalie/Development/EyrieOps/docs/agent-mesh`.
2. Confirm Fred's config appears somewhere in the discovered agent/runtime surfaces.
3. Implement the identity-preservation follow-up so Fred is not displayed as generic `zeroclaw`.
4. Leave old test instances alone until we add an archive/cleanup flow.
