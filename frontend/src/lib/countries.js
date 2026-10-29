// Countries the platform can operate in. Codes are what the API stores (ISO-3166 alpha-2);
// the names come from the browser's own locale data so they are always spelled correctly.
const CODES = [
  'AE', 'AR', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'CN', 'DE', 'DK', 'EG', 'ES', 'FI', 'FR', 'GB',
  'GR', 'HK', 'HU', 'ID', 'IE', 'IL', 'IN', 'IS', 'IT', 'JP', 'KE', 'KR', 'MA', 'MX', 'MY', 'NG',
  'NL', 'NO', 'NZ', 'PE', 'PH', 'PL', 'PT', 'RO', 'RS', 'SA', 'SE', 'SG', 'TH', 'TR', 'TW', 'UA',
  'US', 'UY', 'VN', 'ZA', 'ZW',
];

let display = null;
try {
  display = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  display = null;
}

export const countryName = (code) => {
  if (!code) return '';
  const upper = String(code).toUpperCase();
  return display?.of(upper) || upper;
};

export const COUNTRIES = CODES.map((code) => ({ code, name: countryName(code) }));

// Only used to suggest a currency when a manager picks a country in the fleet form; a branch
// can always be priced in another currency (dollar-denominated rentals are normal).
export const COUNTRY_CURRENCY = {
  AE: 'AED', AR: 'ARS', AU: 'AUD', BE: 'EUR', BR: 'BRL', CA: 'CAD', CH: 'CHF', CL: 'CLP', CN: 'CNY',
  DE: 'EUR', DK: 'DKK', EG: 'EGP', ES: 'EUR', FI: 'EUR', FR: 'EUR', GB: 'GBP', GR: 'EUR', HK: 'HKD',
  HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS', IN: 'INR', IS: 'ISK', IT: 'EUR', JP: 'JPY', KE: 'KES',
  KR: 'KRW', MA: 'MAD', MX: 'MXN', MY: 'MYR', NG: 'NGN', NL: 'EUR', NO: 'NOK', NZ: 'NZD', PE: 'PEN',
  PH: 'PHP', PL: 'PLN', PT: 'EUR', RO: 'RON', RS: 'RSD', SA: 'SAR', SE: 'SEK', SG: 'SGD', TH: 'THB',
  TR: 'TRY', TW: 'TWD', UA: 'UAH', US: 'USD', UY: 'UYU', VN: 'VND', ZA: 'ZAR', ZW: 'USD',
};

export const CURRENCIES = [...new Set(Object.values(COUNTRY_CURRENCY))].sort();
