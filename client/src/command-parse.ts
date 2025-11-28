export type ParsedCommandLine = {
  keyword: string;
  args: Record<string, string>;
};

const ARG_PATTERN = /([A-Za-z0-9_-]+)=("(?:\\.|[^"])*"|[^\s]+)/g;

export function parseCanonicalCommand(line: string): ParsedCommandLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const spaceIndex = trimmed.indexOf(" ");
  const keyword = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  if (spaceIndex === -1) {
    return { keyword, args: {} };
  }
  const argsText = trimmed.slice(spaceIndex + 1);
  const args: Record<string, string> = {};
  for (const match of argsText.matchAll(ARG_PATTERN)) {
    const [, rawKey, rawValue] = match;
    if (!rawKey) {
      continue;
    }
    args[rawKey] = decodeValue(rawValue ?? "");
  }
  return { keyword, args };
}

function decodeValue(raw: string): string {
  if (raw.startsWith("\"")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}
