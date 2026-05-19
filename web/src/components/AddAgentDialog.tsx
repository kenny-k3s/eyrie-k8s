import { useState, useEffect } from "react";
import type { AgentInstance, Persona, Project } from "../lib/types";
import { fetchInstances, fetchPersonas, fetchProjects, createInstance } from "../lib/api";
import { effectiveAgentName, suggestAgentName } from "../lib/agentNaming";

export interface AddAgentDialogProps {
  projectId?: string;
  defaultFramework?: string;
  lockFramework?: boolean;
  onCreated: (instance: AgentInstance) => void;
  onClose: () => void;
}

export function AddAgentDialog({
  projectId,
  defaultFramework = "embedded",
  lockFramework = false,
  onCreated,
  onClose,
}: AddAgentDialogProps) {
  const [name, setName] = useState("");
  const [framework, setFramework] = useState(defaultFramework);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || "");
  const [personaId, setPersonaId] = useState("");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const suggestedName = suggestAgentName(framework, instances);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (creating) return;
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, creating]);

  useEffect(() => {
    fetchPersonas().then(setPersonas).catch((err) => {
      console.error("Failed to load personas:", err);
      setPersonas([]);
    });
  }, []);

  useEffect(() => {
    fetchInstances().then(setInstances).catch((err) => {
      console.error("Failed to load instances:", err);
      setInstances([]);
    });
  }, []);

  useEffect(() => {
    setFramework(defaultFramework);
  }, [defaultFramework]);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }
    fetchProjects().then(setProjects).catch((err) => {
      console.error("Failed to load projects:", err);
      setProjects([]);
    });
  }, [projectId]);

  const handleCreate = async () => {
    const resolvedName = effectiveAgentName(name, suggestedName);
    if (!resolvedName) {
      setError("Name cannot be blank");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const created = await createInstance({
        name: resolvedName,
        framework,
        persona_id: personaId || undefined,
        hierarchy_role: "talon",
        project_id: selectedProjectId || undefined,
        auto_start: true,
      });
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => { if (!creating) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-agent-dialog-title"
    >
      <div className="w-full max-w-md rounded border border-border bg-bg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 id="add-agent-dialog-title" className="text-sm font-bold text-text">
          {projectId ? "add agent to project" : "create agent"}
        </h2>

        <div>
          <label htmlFor="agent-name" className="block text-xs font-medium text-text-secondary mb-1">name</label>
          <input
            id="agent-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-border bg-surface px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
            placeholder={suggestedName}
            autoFocus
          />
        </div>

        {lockFramework ? (
          <div>
            <div className="block text-xs font-medium text-text-secondary mb-1">framework</div>
            <div className="rounded border border-border bg-surface px-3 py-2 text-xs text-text">
              {frameworkLabel(framework)}
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="agent-framework" className="block text-xs font-medium text-text-secondary mb-1">framework</label>
            <select
              id="agent-framework"
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              className="w-full rounded border border-border bg-surface px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
            >
              {FRAMEWORK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        {!projectId && (
          <div>
            <label htmlFor="agent-project" className="block text-xs font-medium text-text-secondary mb-1">project (optional)</label>
            <select
              id="agent-project"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full rounded border border-border bg-surface px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
            >
              <option value="">none</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="agent-persona" className="block text-xs font-medium text-text-secondary mb-1">persona (optional)</label>
          <select
            id="agent-persona"
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="w-full rounded border border-border bg-surface px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
          >
            <option value="">none</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.icon} {p.name} — {p.role}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="rounded border border-red/30 bg-red/5 px-3 py-2 text-xs text-red">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover">
            cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !suggestedName}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/80 disabled:opacity-50"
          >
            {creating ? "creating..." : "create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

const FRAMEWORK_OPTIONS = [
  { value: "embedded", label: "Embedded (EyrieClaw)" },
  { value: "zeroclaw", label: "ZeroClaw" },
  { value: "openclaw", label: "OpenClaw" },
  { value: "hermes", label: "Hermes" },
  { value: "picoclaw", label: "PicoClaw" },
  { value: "codex", label: "Codex App Server" },
];

function frameworkLabel(framework: string): string {
  return FRAMEWORK_OPTIONS.find((option) => option.value === framework)?.label ?? framework;
}
