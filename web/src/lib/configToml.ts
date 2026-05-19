export type TomlFieldType = "boolean" | "number" | "string" | "expression";

export interface TomlEditableField {
  id: string;
  section: string;
  key: string;
  rawValue: string;
  value: string;
  type: TomlFieldType;
  sensitive: boolean;
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
const KEY_RE = /^[A-Za-z0-9_-]+$/;
const SENSITIVE_KEY_RE =
  /(^|[_-])(api[_-]?key|api[_-]?token|bot[_-]?token|token|secret|password|credential)($|[_-])/i;
const SENSITIVE_VALUE_RE = /^(?:"|')?(zcsec:|encrypted:)/i;

export function extractTomlEditableFields(
  content: string,
  format?: string,
): TomlEditableField[] {
  if (format !== "toml") return [];

  const fields: TomlEditableField[] = [];
  let section = "";

  for (const line of content.split("\n")) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const assignment = parseAssignment(line);
    if (!assignment) continue;
    if (section.startsWith("channels.") && assignment.key === "enabled") {
      continue;
    }

    const type = classifyTomlValue(assignment.value);
    fields.push({
      id: `${section}\u0000${assignment.key}`,
      section,
      key: assignment.key,
      rawValue: assignment.value,
      value: displayTomlValue(assignment.value, type),
      type,
      sensitive:
        SENSITIVE_KEY_RE.test(assignment.key) ||
        SENSITIVE_VALUE_RE.test(assignment.value.trim()),
    });
  }

  return fields;
}

export function setTomlFieldValue(
  content: string,
  section: string,
  key: string,
  type: TomlFieldType,
  value: string | boolean,
): string {
  const formatted = formatTomlValue(type, value);
  const lines = content.split("\n");
  let inTargetSection = section === "";

  for (let i = 0; i < lines.length; i++) {
    const sectionMatch = lines[i].match(SECTION_RE);
    if (sectionMatch) {
      if (section === "") return insertTopLevelValue(lines, key, formatted).join("\n");
      inTargetSection = sectionMatch[1] === section;
      continue;
    }

    if (!inTargetSection) continue;

    const assignment = parseAssignment(lines[i]);
    if (!assignment || assignment.key !== key) continue;

    lines[i] = replaceAssignmentValue(lines[i], formatted);
    return lines.join("\n");
  }

  if (section === "") {
    return insertTopLevelValue(lines, key, formatted).join("\n");
  }

  return appendSectionValue(lines, section, key, formatted).join("\n");
}

function parseAssignment(line: string): { key: string; value: string } | null {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) return null;
  const eqIdx = line.indexOf("=");
  if (eqIdx < 1) return null;

  const key = line.slice(0, eqIdx).trim();
  if (!KEY_RE.test(key)) return null;

  const value = splitValueAndComment(line.slice(eqIdx + 1)).value.trim();
  if (!value) return null;
  return { key, value };
}

function splitValueAndComment(raw: string): { value: string; comment: string } {
  let quote: string | null = null;
  let escaped = false;
  let bracketDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (quote === "\"" && ch === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (ch === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "{") bracketDepth++;
    if ((ch === "]" || ch === "}") && bracketDepth > 0) bracketDepth--;
    if (ch === "#" && bracketDepth === 0) {
      return {
        value: raw.slice(0, i),
        comment: raw.slice(i),
      };
    }
  }

  return { value: raw, comment: "" };
}

function classifyTomlValue(rawValue: string): TomlFieldType {
  const raw = rawValue.trim();
  if (/^(true|false)$/i.test(raw)) return "boolean";
  if (/^[+-]?(?:\d+|\d[\d_]*\d)(?:\.\d+)?$/.test(raw)) return "number";
  if (
    (raw.startsWith("\"") && raw.endsWith("\"")) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return "string";
  }
  return "expression";
}

function displayTomlValue(rawValue: string, type: TomlFieldType): string {
  const raw = rawValue.trim();
  if (type === "string") {
    if (raw.startsWith("\"")) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw.slice(1, -1);
  }
  return raw;
}

function formatTomlValue(
  type: TomlFieldType,
  value: string | boolean,
): string {
  if (type === "boolean") return value ? "true" : "false";

  const text = String(value);
  if (type === "number") {
    if (!Number.isFinite(Number(text))) throw new Error("number field is invalid");
    return text.trim();
  }
  if (type === "expression") {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("value cannot be empty");
    return trimmed;
  }

  return `"${escapeTomlString(text)}"`;
}

function replaceAssignmentValue(line: string, formatted: string): string {
  const eqIdx = line.indexOf("=");
  const before = line.slice(0, eqIdx + 1);
  const after = splitValueAndComment(line.slice(eqIdx + 1));
  const leadingSpace = line.slice(eqIdx + 1).match(/^\s*/)?.[0] ?? " ";
  const comment = after.comment ? ` ${after.comment.trimStart()}` : "";
  return `${before}${leadingSpace}${formatted}${comment}`;
}

function insertTopLevelValue(lines: string[], key: string, formatted: string): string[] {
  const next = [...lines];
  const firstSection = next.findIndex((line) => SECTION_RE.test(line));
  const insertAt = firstSection === -1 ? next.length : firstSection;
  next.splice(insertAt, 0, `${key} = ${formatted}`);
  return next;
}

function appendSectionValue(
  lines: string[],
  section: string,
  key: string,
  formatted: string,
): string[] {
  return [...lines, "", `[${section}]`, `${key} = ${formatted}`];
}

function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
