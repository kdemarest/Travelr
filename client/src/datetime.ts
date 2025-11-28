const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateInput = Date | string | null | undefined;
export type MonthDayFormat = "numeric" | "2-digit";
export type MonthFormat = "numeric" | "2-digit" | "long" | "short" | "narrow";

type MonthDayFormatOptions = {
  locale?: string;
  month?: MonthFormat;
  day?: MonthDayFormat;
};

export function parseIsoDateOnly(value: string | null | undefined): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(ISO_DATE_ONLY);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (
    Number.isNaN(year) ||
    Number.isNaN(monthIndex) ||
    Number.isNaN(day) ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return new Date(year, monthIndex, day);
}

export function parseFlexibleDate(value: DateInput): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== "string") {
    return null;
  }
  const iso = parseIsoDateOnly(value);
  if (iso) {
    return iso;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatCanonicalDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatMonthDayLabel(value: DateInput, options?: MonthDayFormatOptions): string | null {
  const date = parseFlexibleDate(value);
  if (!date) {
    return null;
  }
  const locale = options?.locale ?? "en-US";
  const formatter = new Intl.DateTimeFormat(locale, {
    month: options?.month ?? "short",
    day: options?.day ?? "numeric"
  });
  return formatter.format(date);
}
