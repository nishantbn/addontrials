/**
 * Remote Dynamic Domain Synchronizer
 * 1:1 Parity with CloudStream StreamPlay domain resolution
 * Synchronizes domain mappings from phisher98/TVVVV GitHub repository with TTL cache.
 */

let cachedDomains = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const FALLBACK_DOMAINS = {
  '4khdhub': 'https://4khdhub.one',
  'hubcloud': 'https://hubcloud.one'
};

export async function getDomain(providerKey) {
  const now = Date.now();
  if (cachedDomains && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedDomains[providerKey] || FALLBACK_DOMAINS[providerKey];
  }

  try {
    const res = await fetch('https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (res.ok) {
      cachedDomains = await res.json();
      lastFetchTime = now;
      return cachedDomains[providerKey] || FALLBACK_DOMAINS[providerKey];
    }
  } catch (err) {
    console.warn(`[Domains] Failed to refresh dynamic domains: ${err.message}. Using fallback.`);
  }

  return FALLBACK_DOMAINS[providerKey];
}
