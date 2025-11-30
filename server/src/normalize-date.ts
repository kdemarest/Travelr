import { format, isValid, parse } from "date-fns";

const DATE_FORMATS = [
  "yyyy-MM-dd",
  "yyyy-M-d",
  "yyyy/MM/dd",
  "M/d/yyyy",
  "M/d/yy",
  "M/d",
  "MMM d, yyyy",
  "MMM d yyyy",
  "MMM d",
  "MMMM d, yyyy",
  "MMMM d yyyy",
  "MMMM d"
];

export function normalizeUserDate(input: string, referenceDate = new Date()): string | null {
  if (!input) {
    return null;
  }

  const prepared = normalizeMonthTokens(input.trim());
  if (!prepared) {
    return null;
  }

  for (const formatToken of DATE_FORMATS) {
    const parsed = tryParse(prepared, formatToken, referenceDate);
    if (parsed) {
      return format(parsed, "yyyy-MM-dd");
    }
  }

  const fallback = new Date(prepared);
  if (isValid(fallback)) {
    return format(fallback, "yyyy-MM-dd");
  }

  return null;
}

function tryParse(value: string, formatToken: string, referenceDate: Date): Date | null {
  try {
    const parsed = parse(value, formatToken, referenceDate);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeMonthTokens(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .split(" ")
    .map((token) => {
      if (/^[a-zA-Z]+$/.test(token)) {
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      }
      return token;
    })
    .join(" ");
}
