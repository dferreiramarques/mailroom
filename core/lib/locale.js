// País de destino e língua dos e-mails do funil.
// A língua de um contacto resolve-se por esta ordem: escolha manual no contacto →
// língua fixa da frente → língua do país → inglês.

export const COUNTRIES = {
  PT: { name: 'Portugal', lang: 'pt-PT' },
  BR: { name: 'Brasil', lang: 'pt-BR' },
  ES: { name: 'Espanha', lang: 'es-ES' },
  MX: { name: 'México', lang: 'es-MX' },
  AR: { name: 'Argentina', lang: 'es-AR' },
  CL: { name: 'Chile', lang: 'es' },
  CO: { name: 'Colômbia', lang: 'es' },
  FR: { name: 'França', lang: 'fr-FR' },
  BE: { name: 'Bélgica', lang: 'fr-FR' },
  CA: { name: 'Canadá', lang: 'en' },
  DE: { name: 'Alemanha', lang: 'de-DE' },
  AT: { name: 'Áustria', lang: 'de-DE' },
  CH: { name: 'Suíça', lang: 'de-DE' },
  IT: { name: 'Itália', lang: 'it-IT' },
  NL: { name: 'Países Baixos', lang: 'en' },
  PL: { name: 'Polónia', lang: 'en' },
  CZ: { name: 'Chéquia', lang: 'en' },
  HU: { name: 'Hungria', lang: 'en' },
  DK: { name: 'Dinamarca', lang: 'en' },
  SE: { name: 'Suécia', lang: 'en' },
  NO: { name: 'Noruega', lang: 'en' },
  FI: { name: 'Finlândia', lang: 'en' },
  GB: { name: 'Reino Unido', lang: 'en-GB' },
  IE: { name: 'Irlanda', lang: 'en-GB' },
  US: { name: 'Estados Unidos', lang: 'en-US' },
  AU: { name: 'Austrália', lang: 'en' },
  JP: { name: 'Japão', lang: 'en' },
  KR: { name: 'Coreia do Sul', lang: 'en' },
  CN: { name: 'China', lang: 'en' },
};

export const LANGUAGES = {
  'pt-PT': 'Português (PT)', 'pt-BR': 'Português (BR)', 'es-ES': 'Espanhol', 'es-MX': 'Espanhol (MX)', 'es-AR': 'Espanhol (AR)', es: 'Espanhol',
  'fr-FR': 'Francês', 'de-DE': 'Alemão', 'it-IT': 'Italiano', en: 'Inglês', 'en-GB': 'Inglês (UK)', 'en-US': 'Inglês (US)',
  pl: 'Polaco', nl: 'Neerlandês',
};

// Língua escrita por extenso para o prompt (o modelo segue melhor um nome do que um código).
const PROMPT_NAMES = {
  'pt-PT': 'português europeu (de Portugal, nunca do Brasil)', 'pt-BR': 'português do Brasil',
  'es-ES': 'espanhol de Espanha', 'es-MX': 'espanhol do México', 'es-AR': 'espanhol da Argentina', es: 'espanhol',
  'fr-FR': 'francês', 'de-DE': 'alemão (tratamento formal, Sie)', 'it-IT': 'italiano',
  en: 'inglês', 'en-GB': 'inglês britânico', 'en-US': 'inglês americano', pl: 'polaco', nl: 'neerlandês',
};
export const promptLanguage = (code) => PROMPT_NAMES[code] || code || 'inglês';

const TLD = { pt: 'PT', br: 'BR', es: 'ES', cat: 'ES', mx: 'MX', ar: 'AR', cl: 'CL', co: 'CO', fr: 'FR', be: 'BE', ca: 'CA', de: 'DE', at: 'AT', ch: 'CH', it: 'IT', nl: 'NL', pl: 'PL', cz: 'CZ', hu: 'HU', dk: 'DK', se: 'SE', no: 'NO', fi: 'FI', uk: 'GB', ie: 'IE', au: 'AU', jp: 'JP', kr: 'KR', cn: 'CN' };

// Nomes que aparecem nas notas ("Espanha", "Germany", "DE"…).
const ALIASES = Object.fromEntries([
  ...Object.entries(COUNTRIES).map(([k, v]) => [v.name.toLowerCase(), k]),
  ['portugal', 'PT'], ['spain', 'ES'], ['españa', 'ES'], ['france', 'FR'], ['germany', 'DE'], ['deutschland', 'DE'], ['italy', 'IT'], ['italia', 'IT'],
  ['poland', 'PL'], ['polska', 'PL'], ['hungary', 'HU'], ['netherlands', 'NL'], ['holanda', 'NL'], ['uk', 'GB'], ['england', 'GB'], ['inglaterra', 'GB'],
  ['usa', 'US'], ['eua', 'US'], ['brazil', 'BR'], ['austria', 'AT'], ['switzerland', 'CH'], ['belgium', 'BE'], ['czechia', 'CZ'], ['mexico', 'MX'],
]);

export function normalizeCountry(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const up = s.toUpperCase();
  if (up === 'UK') return 'GB';
  if (COUNTRIES[up]) return up;
  return ALIASES[s.toLowerCase()] || '';
}

export function countryFromEmail(email) {
  const tld = String(email || '').toLowerCase().split('.').pop();
  return TLD[tld] || '';
}

// Procura um país nas notas: um código isolado ("ES", "PL/US") ou um nome ("Alemanha").
export function countryFromText(text) {
  const t = String(text || '');
  for (const m of t.matchAll(/(?:^|[\s;,(/|·-])([A-Z]{2})(?=$|[\s;,)/|·.-])/g)) {
    const cc = normalizeCountry(m[1]);
    if (cc) return cc;
  }
  for (const word of t.toLowerCase().split(/[^\p{L}]+/u)) if (ALIASES[word]) return ALIASES[word];
  return '';
}

export function guessCountry({ country, email, notes, org } = {}) {
  return normalizeCountry(country) || countryFromText(notes) || countryFromEmail(email) || countryFromText(org) || '';
}

// Língua final para um contacto numa frente.
export function resolveLanguage(contact = {}, stream = {}) {
  if (contact.lang && contact.lang !== 'auto') return contact.lang;
  if (stream.language && stream.language !== 'auto') return stream.language;
  return COUNTRIES[contact.country]?.lang || 'en';
}
