import path from "node:path";
import { LazyFile } from "./lazy-file.js";
import { Paths } from "./data-paths.js";

export interface ExchangeRateRecord {
  currencyAlpha3: string;
  exchangeRateToUSD: number;
  exchangeRateLastUpdate: string;
}

const catalogPath = path.join(Paths.catalog, "exchangeRates.json");

export class ExchangeRateCatalog {
  private readonly recordMap = new Map<string, ExchangeRateRecord>();
  private readonly lazyFile: LazyFile<ExchangeRateRecord[]>;

  constructor(filePath: string = catalogPath) {
    this.lazyFile = new LazyFile<ExchangeRateRecord[]>(
      filePath,
      [],
      (text) => JSON.parse(text) as ExchangeRateRecord[],
      (data) => JSON.stringify(data, null, 2)
    );
  }

  load(): void {
    this.lazyFile.load();
    this.recordMap.clear();
    for (const record of this.lazyFile.data) {
      if (record.currencyAlpha3) {
        this.recordMap.set(normalizeCurrencyCode(record.currencyAlpha3), record);
      }
    }
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
    const normalizedRecord = {
      currencyAlpha3: normalized,
      exchangeRateToUSD: record.exchangeRateToUSD,
      exchangeRateLastUpdate: record.exchangeRateLastUpdate
    };
    this.recordMap.set(normalized, normalizedRecord);
    
    // Update lazyFile.data array and mark dirty
    const idx = this.lazyFile.data.findIndex(r => normalizeCurrencyCode(r.currencyAlpha3) === normalized);
    if (idx >= 0) {
      this.lazyFile.data[idx] = normalizedRecord;
    } else {
      this.lazyFile.data.push(normalizedRecord);
    }
    this.lazyFile.setDirty();
  }

  flush(): void {
    this.lazyFile.flush();
  }
}

export function createExchangeRateCatalog(): ExchangeRateCatalog {
  return new ExchangeRateCatalog();
}

export function getExchangeRateCatalogPath(): string {
  return catalogPath;
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}
