import { useEffect, useState } from "react";
import type { DevBackendStartMode } from "./api";

const KEY = "eyrie-dev-backend-start-mode";
const DEFAULT_MODE: DevBackendStartMode = "binary";

function isMode(value: string | null): value is DevBackendStartMode {
  return value === "binary" || value === "make-dev";
}

function readMode(): DevBackendStartMode {
  try {
    const value = window.localStorage.getItem(KEY);
    return isMode(value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function useBackendStartMode() {
  const [mode, setModeState] = useState<DevBackendStartMode>(readMode);

  const setMode = (next: DevBackendStartMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // localStorage may be unavailable in private or restricted contexts.
    }
  };

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== KEY) return;
      setModeState(isMode(event.newValue) ? event.newValue : DEFAULT_MODE);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return { mode, setMode };
}
