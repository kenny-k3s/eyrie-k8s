const DEFAULT_AGENT_NAME = "researcher-riley";

export function effectiveAgentName(inputName: string, suggestedName: string): string {
  return inputName.trim() || suggestedName;
}

export function suggestAgentName(
  _framework: string,
  existingAgents: ReadonlyArray<{ name: string }>,
): string {
  const base = DEFAULT_AGENT_NAME;
  const existingNames = new Set(existingAgents.map((agent) => agent.name.toLowerCase()));
  if (!existingNames.has(base.toLowerCase())) return base;

  let suffix = 2;
  while (existingNames.has(`${base}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
