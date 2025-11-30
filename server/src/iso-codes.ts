import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface IsoCodeRecord {
  countryName: string;
  countryAlpha2: string;
  currencyAlpha3: string;
  aliases?: string[];
}

export interface IsoCodeResult {
  countryName: string;
  countryAlpha2: string;
  currencyAlpha3: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogPath = path.resolve(__dirname, "../../catalog/iso-country-currency.json");

let isoCodeSource: IsoCodeRecord[] = readCatalogFromDisk();
let lookup = buildLookup(isoCodeSource);

function readCatalogFromDisk(): IsoCodeRecord[] {
  try {
    const records = fs.readJsonSync(catalogPath) as IsoCodeRecord[];
    return Array.isArray(records) ? records : [];
  } catch (error) {
    console.warn("Failed to read ISO country catalog", error);
    return [];
  }
}

function buildLookup(records: IsoCodeRecord[]): Map<string, IsoCodeResult> {
  const map = new Map<string, IsoCodeResult>();
  for (const record of records) {
    register(map, record.countryName, record);
    if (record.aliases) {
      for (const alias of record.aliases) {
        register(map, alias, record);
      }
    }
  }
  return map;
}

function register(map: Map<string, IsoCodeResult>, label: string | undefined, record: IsoCodeRecord) {
  if (!label) {
    return;
  }
  map.set(label.trim().toLowerCase(), {
    countryName: record.countryName,
    countryAlpha2: record.countryAlpha2,
    currencyAlpha3: record.currencyAlpha3
  });
}

export function findIsoCodes(country: string | undefined | null): IsoCodeResult | null {
  if (!country) {
    return null;
  }
  const normalized = country.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return lookup.get(normalized) ?? null;
}

export function listIsoCodeEntries(): IsoCodeResult[] {
  return isoCodeSource.map((record) => ({
    countryName: record.countryName,
    countryAlpha2: record.countryAlpha2,
    currencyAlpha3: record.currencyAlpha3
  }));
}

export function reloadIsoCountryCatalog(replacement?: IsoCodeRecord[]): void {
  isoCodeSource = replacement ?? readCatalogFromDisk();
  lookup = buildLookup(isoCodeSource);
}

export function getIsoCountryCatalogPath(): string {
  return catalogPath;
}
