/**
 * Vidy StreamPlay Provider
 * 1:1 Port of CloudStream invokeVidy() & getVidyServers() in StreamPlayExtractor.kt
 * Dynamically resolves all active server endpoints from vidy.st and queries concurrently with timeout isolation.
 */

import { decryptVidy } from '../utils/crypto.mjs';

// Complete fallback server list matching CloudStream StreamPlay v695
const FALLBACK_SERVERS = [
  'miami', 'boise', 'seattle', 'atlanta', 'phoenix', 'portland',
  'austin', 'dallas', 'chicago', 'nashville', 'vegas', 'reno',
  'oakland', 'munich', 'berlin', 'paris', 'delhi', 'cancun'
];

export const VIDY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Origin': 'https://www.vidy.st',
  'Referer': 'https://www.vidy.st/'
};

let cachedServers = null;
let lastServerFetch = 0;

/**
 * Dynamically discovers active Vidy servers from vidy.st next.js bundle
 * 1:1 Port of CloudStream getVidyServers()
 */
export async function getVidyServers() {
  const now = Date.now();
  if (cachedServers && now - lastServerFetch < 3600000) {
    return cachedServers;
  }

  try {
    const homeRes = await fetch('https://www.vidy.st/', {
      headers: VIDY_HEADERS,
      signal: AbortSignal.timeout(4000)
    });
    if (!homeRes.ok) throw new Error('Failed to load vidy.st');
    const homeHtml = await homeRes.text();

    const manifestMatch = homeHtml.match(/\/_next\/static\/([^/]+)\/_buildManifest\.js/);
    if (!manifestMatch) throw new Error('Manifest not found');

    const manifestRes = await fetch(`https://www.vidy.st${manifestMatch[0]}`, {
      headers: VIDY_HEADERS,
      signal: AbortSignal.timeout(4000)
    });
    if (!manifestRes.ok) throw new Error('Failed to load buildManifest');
    const manifestJs = await manifestRes.text();

    const chunkMatch = manifestJs.match(/static\/chunks\/122-[0-9a-f]+\.js/);
    if (!chunkMatch) throw new Error('Chunk 122 not found');

    const chunkRes = await fetch(`https://www.vidy.st/_next/${chunkMatch[0]}`, {
      headers: VIDY_HEADERS,
      signal: AbortSignal.timeout(4000)
    });
    if (!chunkRes.ok) throw new Error('Failed to load chunk 122');
    const chunkJs = await chunkRes.text();

    const endpointMatches = chunkJs.matchAll(/\/([a-z]+)\/sources/g);
    const discovered = new Set();
    for (const m of endpointMatches) {
      discovered.add(m[1]);
    }

    if (discovered.size > 0) {
      cachedServers = Array.from(discovered);
      lastServerFetch = now;
      console.log(`[Vidy] Dynamically discovered ${cachedServers.length} servers from vidy.st:`, cachedServers.join(', '));
      return cachedServers;
    }
  } catch (err) {
    console.warn('[Vidy] Dynamic server discovery failed, using fallback list:', err.message);
  }

  cachedServers = FALLBACK_SERVERS;
  lastServerFetch = now;
  return cachedServers;
}

/**
 * Retrieves streams from Vidy.
 * @param {object} params
 * @param {number} params.tmdbId
 * @param {string} [params.imdbId]
 * @param {string} params.title
 * @param {number} [params.year]
 * @param {'movie'|'series'} params.type
 * @param {number} [params.season]
 * @param {number} [params.episode]
 * @param {string} [params.proxyPrefix]
 * @returns {Promise<Array>} Array of Stremio/Nuvio stream objects
 */
export async function getVidyStreams({ tmdbId, imdbId, title, year, type, season, episode, proxyPrefix }) {
  if (!tmdbId) return [];

  const streams = [];

  try {
    // 1. Fetch seed from api.wecollege.net
    const seedRes = await fetch(`https://api.wecollege.net/seed?mediaId=${tmdbId}`, {
      headers: VIDY_HEADERS,
      signal: AbortSignal.timeout(4000)
    });
    if (!seedRes.ok) return [];
    const seedData = await seedRes.json();
    const seed = seedData?.seed;
    if (!seed) return [];

    const isTv = type === 'series' || season !== undefined;
    const mediaType = isTv ? 'tv' : 'movie';
    const encTitle = encodeURIComponent(title || '').replace(/\+/g, '%20');

    let query = `title=${encTitle}&mediaType=${mediaType}`;
    if (year) query += `&year=${year}`;
    if (isTv) {
      if (season !== undefined && season !== null) query += `&seasonId=${season}`;
      if (episode !== undefined && episode !== null) query += `&episodeId=${episode}`;
    }
    query += `&tmdbId=${tmdbId}`;
    if (imdbId) query += `&imdbId=${imdbId}`;
    query += `&enc=2&seed=${seed}`;

    const servers = await getVidyServers();

    // 2. Query all servers concurrently with a 4s timeout per server
    const serverPromises = servers.map(async (server) => {
      try {
        let url = `https://api.wecollege.net/${server}/sources?${query}`;
        if (server === 'munich') {
          url += '&language=german';
        }

        const res = await fetch(url, {
          headers: VIDY_HEADERS,
          signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const cipherText = (await res.text()).trim();
        if (!cipherText) return null;

        const decrypted = decryptVidy(cipherText, seed, tmdbId);
        if (!decrypted) return null;

        const parsed = JSON.parse(decrypted);
        return { server, data: parsed };
      } catch (e) {
        return null;
      }
    });

    const results = await Promise.allSettled(serverPromises);

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value && res.value.data) {
        const { server, data } = res.value;

        // Parse subtitles if available
        const subtitles = [];
        if (Array.isArray(data.subtitles)) {
          for (const sub of data.subtitles) {
            if (sub.url) {
              subtitles.push({
                id: sub.lang || sub.language || 'sub',
                lang: sub.language || sub.lang || 'English',
                url: sub.url
              });
            }
          }
        }

        const wrapUrl = (rawUrl) => {
          if (proxyPrefix && rawUrl) {
            return `${proxyPrefix}${encodeURIComponent(rawUrl)}`;
          }
          return rawUrl;
        };

        const serverName = server.charAt(0).toUpperCase() + server.slice(1);

        if (Array.isArray(data.sources)) {
          for (const src of data.sources) {
            if (!src.url) continue;

            const quality = src.quality || (src.url.includes('1080') ? '1080p' : src.url.includes('720') ? '720p' : 'Auto');
            const isHls = src.url.includes('.m3u8') || src.format === 'hls' || src.isM3U8;

            streams.push({
              name: `StreamPlay [Vidy]`,
              title: `${serverName} • ${quality} • HLS`,
              url: wrapUrl(src.url),
              behaviorHints: {
                notWebReady: false,
                isHLS: isHls,
                proxyHeaders: {
                  request: VIDY_HEADERS
                }
              },
              subtitles: subtitles.length > 0 ? subtitles : undefined
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Vidy] Provider error:', err.message);
  }

  return streams;
}
