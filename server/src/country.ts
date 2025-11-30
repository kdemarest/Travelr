import type { AddCountryCommand } from "./command.js";
import { CommandError } from "./errors.js";
import { findIsoCodes } from "./iso-codes.js";
import { ensureExchangeRateForCurrency } from "./exchange.js";
import { generateUid } from "./uid.js";

export async function ensureCountryMetadata(command: AddCountryCommand): Promise<AddCountryCommand> {
  const normalizedCountry = command.countryName.trim();
  const countryAlpha2 = command.countryAlpha2?.trim();
  const currencyAlpha3 = command.currencyAlpha3?.trim();
  const countryId = command.id?.trim();
  const normalizedRate =
    typeof command.exchangeRateToUSD === "number" && Number.isFinite(command.exchangeRateToUSD)
      ? command.exchangeRateToUSD
      : undefined;
  const normalizedRateTimestamp = command.exchangeRateLastUpdate?.trim();

  const needsIsoLookup = !countryAlpha2 || !currencyAlpha3;
  const lookupResult = needsIsoLookup ? findIsoCodes(normalizedCountry) : null;

  if (needsIsoLookup && !lookupResult) {
    throw new CommandError(
      `Unable to resolve ISO codes for "${normalizedCountry}". Try a different spelling or specify a well-known alternate name.`
    );
  }

  const resolvedcountryAlpha2 = (countryAlpha2 ?? lookupResult?.countryAlpha2 ?? "").trim().toUpperCase();
  const resolvedcurrencyAlpha3 = (currencyAlpha3 ?? lookupResult?.currencyAlpha3 ?? "").trim().toUpperCase();
  let resolvedExchangeRate = normalizedRate && normalizedRate > 0 ? normalizedRate : undefined;
  let resolvedRateTimestamp = normalizedRateTimestamp ?? "";

  const catalogRecord = await ensureExchangeRateForCurrency(resolvedcurrencyAlpha3);
  if (catalogRecord && Number.isFinite(catalogRecord.exchangeRateToUSD) && catalogRecord.exchangeRateToUSD > 0) {
    resolvedExchangeRate = catalogRecord.exchangeRateToUSD;
    resolvedRateTimestamp = catalogRecord.exchangeRateLastUpdate ?? resolvedRateTimestamp;
  }

  if (!resolvedExchangeRate || resolvedExchangeRate <= 0) {
    resolvedExchangeRate = 1;
  }

  if (!resolvedcountryAlpha2 || !resolvedcurrencyAlpha3) {
    throw new CommandError(
      `Unable to resolve ISO codes for "${normalizedCountry}". Try a different spelling or specify a well-known alternate name.`
    );
  }

  return {
    ...command,
    countryName: normalizedCountry,
    countryAlpha2: resolvedcountryAlpha2,
    currencyAlpha3: resolvedcurrencyAlpha3,
    id: countryId ?? generateUid(),
    exchangeRateToUSD: resolvedExchangeRate,
    exchangeRateLastUpdate: resolvedRateTimestamp
  };
}
