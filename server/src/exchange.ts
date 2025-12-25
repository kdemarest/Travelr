import type { TripModel, CountryInfo } from "./types.js";
import { createExchangeRateCatalog } from "./exchange-rate-catalog.js";
import type { ExchangeRateRecord } from "./exchange-rate-catalog.js";

interface ExchangeRateResult {
  rate: number;
  lastUpdated: string;
}

interface ExchangeRateApiResponse {
  result?: string;
  rates?: Record<string, number>;
  time_last_update_utc?: string;
}

const EXCHANGE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXCHANGE_API_BASE = "https://open.er-api.com/v6/latest";
const exchangeCatalog = createExchangeRateCatalog();

/**
 * Load exchange rate catalog from disk. Call once at startup.
 */
export async function loadExchangeRateCatalog(): Promise<void> {
  await exchangeCatalog.load();
}

/**
 * Flush pending writes to disk. Call on shutdown.
 */
export async function flushExchangeRateCatalog(): Promise<void> {
  await exchangeCatalog.flush();
}

/**
 * Sync version - applies cached exchange rates from the catalog without network calls.
 * Use this when finalizing models for client consumption.
 */
export function applyExchangeRatesFromCatalog(model: TripModel): TripModel {
  if (!model.countries || model.countries.length === 0) {
    return model;
  }

  const refreshedCountries: CountryInfo[] = model.countries.map((country) => {
    const record = exchangeCatalog.get(country.currencyAlpha3);
    if (record && isValidExchangeRate(record.exchangeRateToUSD)) {
      return { ...country, exchangeRateToUSD: record.exchangeRateToUSD };
    }
    return country;
  });

  return { ...model, countries: refreshedCountries };
}

export async function refreshExchangeRateCatalogOnStartup(): Promise<void> {
  const records = exchangeCatalog.list();
  if (records.length === 0) {
    return;
  }

  for (const record of records) {
    await ensureCatalogRate(record.currencyAlpha3);
  }
  // Writes are scheduled by upsert via setDirty; flush at shutdown
}

/**
 * Sync lookup of exchange rate from the in-memory catalog.
 * Returns whatever is cached; does not fetch from network.
 */
export function getExchangeRateFromCatalog(
  currencyAlpha3: string | undefined | null
): ExchangeRateRecord | null {
  return exchangeCatalog.get(currencyAlpha3);
}

interface RateResolutionResult {
  record: ExchangeRateRecord | null;
  updatedCatalog: boolean;
}

async function ensureCatalogRate(currencyAlpha3: string | undefined | null): Promise<RateResolutionResult> {
  const normalized = normalizeCurrency(currencyAlpha3);
  if (!normalized) {
    return { record: null, updatedCatalog: false };
  }

  if (normalized === "USD") {
    const existing = exchangeCatalog.get(normalized);
    if (!existing || !isValidUsdRate(existing.exchangeRateToUSD) || isRecordStale(existing)) {
      const refreshed: ExchangeRateRecord = {
        currencyAlpha3: "USD",
        exchangeRateToUSD: 1,
        exchangeRateLastUpdate: new Date().toISOString()
      };
      exchangeCatalog.upsert(refreshed);
      return { record: refreshed, updatedCatalog: true };
    }
    return { record: existing, updatedCatalog: false };
  }

  const record = exchangeCatalog.get(normalized);
  if (!record || isRecordStale(record)) {
    try {
      const { rate, lastUpdated } = await fetchExchangeRateToUSD(normalized);
      const refreshed: ExchangeRateRecord = {
        currencyAlpha3: normalized,
        exchangeRateToUSD: rate,
        exchangeRateLastUpdate: lastUpdated
      };
      exchangeCatalog.upsert(refreshed);
      return { record: refreshed, updatedCatalog: true };
    } catch (error) {
      console.warn(`Failed to refresh exchange rate for ${normalized}`, error);
      return { record: record ?? null, updatedCatalog: false };
    }
  }

  return { record, updatedCatalog: false };
}

function isValidExchangeRate(value?: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecordStale(record: ExchangeRateRecord): boolean {
  if (!Number.isFinite(record.exchangeRateToUSD) || record.exchangeRateToUSD <= 0) {
    return true;
  }
  return !isTimestampRecent(record.exchangeRateLastUpdate);
}

function isValidUsdRate(rate?: number): boolean {
  return typeof rate === "number" && Number.isFinite(rate) && Math.abs(rate - 1) < 1e-6;
}

function isTimestampRecent(timestamp?: string): boolean {
  if (!timestamp) {
    return false;
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Date.now() - parsed < EXCHANGE_REFRESH_INTERVAL_MS;
}

function normalizeCurrency(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toUpperCase();
}

export async function fetchExchangeRateToUSD(currencyAlpha3: string): Promise<ExchangeRateResult> {
  const normalized = currencyAlpha3.trim().toUpperCase();
  if (normalized === "USD") {
    return { rate: 1, lastUpdated: new Date().toISOString() };
  }

  const response = await fetch(`${EXCHANGE_API_BASE}/${normalized}`, {
    headers: {
      "User-Agent": "TravelrExchangeRefresh/1.0",
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download exchange rate for ${normalized} (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as ExchangeRateApiResponse;
  const usdRate = payload?.rates?.USD;
  if (typeof usdRate !== "number" || usdRate <= 0) {
    throw new Error(`Exchange rate response missing USD quote for ${normalized}.`);
  }

  const lastUpdatedSource = payload.time_last_update_utc ?? new Date().toUTCString();
  const lastUpdated = new Date(lastUpdatedSource).toISOString();

  return {
    rate: usdRate,
    lastUpdated
  };
}
