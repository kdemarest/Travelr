import type { TripModel, CountryInfo } from "./types.js";

const DEFAULT_US_COUNTRY: CountryInfo = {
  country: "United States",
  countryAlpha2: "US",
  currencyAlpha3: "USD",
  exchangeRateToUSD: 1,
  id: "country_us_default"
};

export function ensureDefaultCountry(model: TripModel): TripModel {
  const countries = model.countries ?? [];
  const hasUnitedStates = countries.some((entry) =>
    entry.countryAlpha2?.trim().toUpperCase() === DEFAULT_US_COUNTRY.countryAlpha2 &&
    entry.currencyAlpha3?.trim().toUpperCase() === DEFAULT_US_COUNTRY.currencyAlpha3
  );

  if (hasUnitedStates) {
    return { ...model, countries };
  }

  return {
    ...model,
    countries: [...countries, { ...DEFAULT_US_COUNTRY }]
  };
}
