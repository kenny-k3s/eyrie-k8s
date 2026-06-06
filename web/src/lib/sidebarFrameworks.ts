import type { FrameworkStatus } from "./frameworkStatus";

type SidebarFrameworkStatus = Pick<FrameworkStatus, "isReady" | "badge">;

interface SidebarFrameworkCandidate {
  id: string;
  status: SidebarFrameworkStatus;
}

export function sidebarFrameworkIds(
  registryFrameworks: SidebarFrameworkCandidate[],
  _agentFrameworkIds: string[] = [],
): string[] {
  return [...new Set(registryFrameworks
    .filter((fw) => frameworkDotClass(fw.status) !== "bg-text-muted/30")
    .map((fw) => fw.id))];
}

export function frameworkDotClass(status: SidebarFrameworkStatus | null | undefined): string {
  if (status?.badge?.color === "red") return "bg-red";
  if (status?.badge?.color === "yellow") return "bg-yellow";
  if (status?.isReady) return "bg-green";
  return "bg-text-muted/30";
}
