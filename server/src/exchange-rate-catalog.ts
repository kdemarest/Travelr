import { LazyFile } from "./lazy-file.js";
import { getStorageFor } from "./storage.js";

export interface ExchangeRateRecord {
  currencyAlpha3: string;
  exchangeRateToUSD: number;
  exchangeRateLastUpdate: string;
}

const CATALOG_KEY = "dataCountries/exchangeRates.json";

export class ExchangeRateCatalog {
  private readonly recordMap = new Map<string, ExchangeRateRecord>();
  private lazyFile: LazyFile<ExchangeRateRecord[]> | null = null;

  constructor(private readonly key: string = CATALOG_KEY) {}

  async load(): Promise<void> {
    const storage = getStorageFor(this.key);
    this.lazyFile = new LazyFile<ExchangeRateRecord[]>(
      this.key,
      storage,
      [],
      (text) => JSON.parse(text) as ExchangeRateRecord[],
      (data) => JSON.stringify(data, null, 2)
    );
    await this.lazyFile.load();
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
    if (!this.lazyFile) {
      throw new Error("ExchangeRateCatalog not loaded. Call load() first.");
    }
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

  async flush(): Promise<void> {
    if (this.lazyFile) {
      await this.lazyFile.flush();
    }
  }
}

export function createExchangeRateCatalog(): ExchangeRateCatalog {
  return new ExchangeRateCatalog();
}

export function getExchangeRateCatalogKey(): string {
  return CATALOG_KEY;
}

function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}
