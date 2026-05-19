// Shared hook: fetch frameworks and filter to installed-only.
//
// Used by ProjectsPhase, ProjectListPage (CreateProjectDialog), and
// SetCaptainDialog — all three need the same data to populate framework
// dropdowns for captain/talon provisioning.
//
// Includes a StrictMode cancellation guard so the double-mount doesn't
// let a stale promise's .catch clear frameworks that a later fetch loaded.

import { useEffect, useState } from "react";
import type { Framework } from "./types";
import { fetchFrameworks } from "./api";
import { getFrameworkStatus } from "./frameworkStatus";
import { useData } from "./DataContext";

interface InstalledFrameworksResult {
  /** Frameworks whose binary is on disk. */
  frameworks: Framework[];
  /** True while the initial fetch is in progress. */
  loading: boolean;
  /** The first installed framework's id, or "" if none. */
  defaultId: string;
}

export function useInstalledFrameworks(): InstalledFrameworksResult {
  const { backendDown } = useData();
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (backendDown) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFrameworks()
      .then((list) => {
        if (cancelled) return;
        setFrameworks(list.filter((fw) => getFrameworkStatus(fw).isInstalled));
      })
      .catch(() => {
        // Don't clear frameworks on error — keep whatever we had.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [backendDown]);

  return {
    frameworks,
    loading,
    defaultId: frameworks[0]?.id || "",
  };
}
