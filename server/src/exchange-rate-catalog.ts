import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ExchangeRateRecord {
  currencyAlpha3: string;
  exchangeRateToUSD: number;
  exchangeRateLastUpdate: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogPath = path.resolve(__dirname, "../../catalog/exchangeRates.json");

export class ExchangeRateCatalog {
  private readonly recordMap = new Map<string, ExchangeRateRecord>();

  constructor(private readonly filePath: string = catalogPath, initialRecords?: ExchangeRateRecord[]) {
    const records = initialRecords ?? readCatalogFromDisk(filePath);
    this.ingest(records);
  }

  list(): ExchangeRateRecord[] {
    return Array.from(this.recordMap.values());
  }

  get(currencyAlpha3: string | undefined | null): ExchangeRateRecord | null {
    if (!currencyAlpha3) {
      return null;
    }
    return this.recordMap.get(normalizeCurrencyCode(currencyAlpha3)) ?? null;
  }

  upsert(record: ExchangeRateRecord): void {
    const normalized = normalizeCurrencyCode(record.currencyAlpha3);
    this.recordMap.set(normalized, {
      currencyAlpha3: normalized,
      exchangeRateToUSD: record.exchangeRateToUSD,
      exchangeRateLastUpdate: record.exchangeRateLastUpdate
    });
  }

  save(): void {
    fs.writeJsonSync(this.filePath, this.list(), { spaces: 2 });
  }

  private ingest(records: ExchangeRateRecord[]): void {
    for (const record of records) {
      if (!record.currencyAlpha3) {
        continue;
      }
      this.upsert(record);
    }
  }
}

export function readExchangeRateCatalog(): ExchangeRateCatalog {
  return new ExchangeRateCatalog();
}

export function getExchangeRateCatalogPath(): string {
  return catalogPath;
}

function readCatalogFromDisk(filePath: string): ExchangeRateRecord[] {
  try {
    const data = fs.readJsonSync(filePath) as ExchangeRateRecord[];
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("Failed to read exchange rate catalog", error);
    return [];
  }
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}
