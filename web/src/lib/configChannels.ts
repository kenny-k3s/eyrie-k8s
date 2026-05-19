export interface ChannelToggle {
  name: string;
  enabled: boolean;
}

const CHANNEL_SECTION_RE = /^\s*\[channels\.([^\]]+)\]\s*$/;

export function extractChannelToggles(
  content: string,
  format?: string,
): ChannelToggle[] {
  if (format !== "toml") return [];

  const channels: ChannelToggle[] = [];
  let current: ChannelToggle | null = null;

  for (const line of content.split("\n")) {
    const section = line.match(CHANNEL_SECTION_RE);
    if (section) {
      current = {
        name: section[1],
        enabled: false,
      };
      channels.push(current);
      continue;
    }

    if (!current) continue;
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }

    const enabled = line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/i);
    if (enabled) {
      current.enabled = enabled[1].toLowerCase() === "true";
    }
  }

  return channels;
}

export function setChannelEnabled(
  content: string,
  channelName: string,
  enabled: boolean,
): string {
  const lines = content.split("\n");
  const sectionHeader = `[channels.${channelName}]`;
  let inTargetSection = false;
  let inserted = false;
  const nextLines: string[] = [];

  for (const line of lines) {
    const section = line.match(CHANNEL_SECTION_RE);
    if (section) {
      if (inTargetSection && !inserted) {
        nextLines.push(`enabled = ${enabled}`);
        inserted = true;
      }
      inTargetSection = line.trim() === sectionHeader;
      nextLines.push(line);
      continue;
    }

    if (inTargetSection && /^\s*enabled\s*=/.test(line)) {
      const indent = line.match(/^\s*/)?.[0] ?? "";
      nextLines.push(`${indent}enabled = ${enabled}`);
      inserted = true;
      continue;
    }

    nextLines.push(line);
  }

  if (inTargetSection && !inserted) {
    nextLines.push(`enabled = ${enabled}`);
  }

  return nextLines.join("\n");
}
