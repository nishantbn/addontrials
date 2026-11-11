/**
 * VegaMovies StreamPlay Provider
 * 1:1 Port of CloudStream invokeVegamovies() & HubCloud extractors
 * Queries VegaMovies search API by IMDB ID / Title and extracts direct V-Cloud, R2, and HubCloud streams.
 */

const VEGA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': 'https://vegamovies.lease/'
};

/**
 * Resolves a vcloud.beer / hubcloud link to direct streaming URLs (e.g. Cloudflare R2, PixelDrain).
 * @param {string} vcloudUrl 
 * @returns {Promise<Array<{url: string, label: string}>>}
 */
export async function resolveVcloud(vcloudUrl) {
  try {
    const res = await fetch(vcloudUrl, {
      headers: VEGA_HEADERS,
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Look for atob(atob('...')) token redirect
    const atobMatch = html.match(/atob\(atob\(['"]([A-Za-z0-9+/=]+)['"]\)\)/);
    if (!atobMatch) return [];

    const d1 = Buffer.from(atobMatch[1], 'base64').toString('utf8');
    const tokenUrl = Buffer.from(d1, 'base64').toString('utf8');
    if (!tokenUrl) return [];

    const tokenRes = await fetch(tokenUrl, {
      headers: {
        ...VEGA_HEADERS,
        'Referer': vcloudUrl
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!tokenRes.ok) return [];
    const tokenHtml = await tokenRes.text();

    const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let m;
    const directLinks = [];
    while ((m = regex.exec(tokenHtml)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, '').trim();
      if (href.includes('cloudflarestorage.com') || href.includes('pixeldrain.dev') || href.includes('gpdl') || href.includes('hubcloud')) {
        directLinks.push({ url: href, label: text || 'Direct Stream' });
      }
    }
    return directLinks;
  } catch (e) {
    return [];
  }
}

/**
 * Searches VegaMovies and extracts streaming links.
 * @param {object} params
 * @param {string} [params.imdbId]
 * @param {string} params.title
 * @param {number} [params.year]
 * @param {'movie'|'series'} params.type
 * @param {number} [params.season]
 * @param {number} [params.episode]
 * @returns {Promise<Array>}
 */
export async function getVegaMoviesStreams({ imdbId, title, year, type, season, episode }) {
  const streams = [];

  try {
    const query = imdbId || title;
    if (!query) return [];

    const searchUrl = `https://vegamovies.lease/search.php?q=${encodeURIComponent(query)}`;
    const searchRes = await fetch(searchUrl, {
      headers: VEGA_HEADERS,
      signal: AbortSignal.timeout(5000)
    });
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    if (!searchData?.hits || searchData.hits.length === 0) return [];

    // Prioritize IMDB ID match, then title match
    let match = null;
    if (imdbId) {
      match = searchData.hits.find(h => h.document?.imdb_id?.toLowerCase() === imdbId.toLowerCase());
    }
    if (!match && title) {
      const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
      match = searchData.hits.find(h => {
        const docTitle = (h.document?.post_title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return docTitle.includes(cleanTitle);
      }) || searchData.hits[0];
    }

    if (!match?.document?.permalink) return [];

    const pageUrl = `https://vegamovies.lease${match.document.permalink}`;
    const pageRes = await fetch(pageUrl, {
      headers: VEGA_HEADERS,
      signal: AbortSignal.timeout(5000)
    });
    if (!pageRes.ok) return [];
    let html = await pageRes.text();

    const isTv = type === 'series' || season !== undefined;

    if (isTv && season !== undefined && episode !== undefined) {
      // Find season block: from "Season X" to the next "Season Y"
      const seasonRegex = new RegExp(`Season\\s*0?${season}\\b`, 'i');
      const seasonMatch = seasonRegex.exec(html);
      if (seasonMatch) {
        const startIdx = seasonMatch.index;
        // Search next season or section
        const nextSeasonRegex = new RegExp(`Season\\s*0?${season + 1}\\b`, 'i');
        const nextMatch = nextSeasonRegex.exec(html.substring(startIdx + 50));
        if (nextMatch) {
          html = html.substring(startIdx, startIdx + 50 + nextMatch.index);
        } else {
          html = html.substring(startIdx, startIdx + 15000);
        }
      }

      // Extract candidate links in the season block
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      let m;
      const candidateLinks = [];
      while ((m = linkRegex.exec(html)) !== null) {
        const href = m[1];
        const text = m[2].replace(/<[^>]+>/g, '').trim();
        // Ignore batch/zip links
        if (text.toLowerCase().includes('zip') || text.toLowerCase().includes('batch')) continue;

        if (href.includes('nexdrive') || href.includes('vcloud') || href.includes('hubcloud')) {
          candidateLinks.push({ href, text });
        }
      }

      // Check up to top 3 quality links concurrently (e.g. 1080p, 720p, 480p)
      const selected = candidateLinks.slice(0, 4);

      const checkPromises = selected.map(async (cand) => {
        if (cand.href.includes('nexdrive')) {
          try {
            const nexRes = await fetch(cand.href, {
              headers: { ...VEGA_HEADERS, 'Referer': pageUrl },
              signal: AbortSignal.timeout(4000)
            });
            if (!nexRes.ok) return;
            const nexHtml = await nexRes.text();

            const vcloudRegex = /<a[^>]+href=["'](https:\/\/[^"']*vcloud[^"']*)["'][^>]*>(.*?)<\/a>/gi;
            let vm;
            let epCounter = 1;
            while ((vm = vcloudRegex.exec(nexHtml)) !== null) {
              const vcloudHref = vm[1];
              if (epCounter === episode) {
                const directList = await resolveVcloud(vcloudHref);
                for (const d of directList) {
                  const quality = d.url.includes('1080') ? '1080p' : d.url.includes('720') ? '720p' : d.url.includes('2160') || d.url.includes('4k') ? '4K' : 'HD';
                  streams.push({
                    name: `StreamPlay [VegaMovies]`,
                    title: `V-Cloud (${d.label}) • ${quality}`,
                    url: d.url,
                    behaviorHints: {
                      notWebReady: false
                    }
                  });
                }
                break;
              }
              epCounter++;
            }
          } catch (e) {}
        } else if (cand.href.includes('vcloud')) {
          const directList = await resolveVcloud(cand.href);
          for (const d of directList) {
            streams.push({
              name: `StreamPlay [VegaMovies]`,
              title: `V-Cloud (${d.label})`,
              url: d.url
            });
          }
        }
      });

      await Promise.allSettled(checkPromises);
    } else {
      // Movie handling: direct links on post page
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      let m;
      const movieLinks = [];
      while ((m = linkRegex.exec(html)) !== null) {
        const href = m[1];
        if (href.includes('vcloud') || href.includes('hubcloud')) {
          movieLinks.push(href);
        }
      }

      const moviePromises = movieLinks.slice(0, 3).map(async (href) => {
        const directList = await resolveVcloud(href);
        for (const d of directList) {
          const quality = d.url.includes('1080') ? '1080p' : d.url.includes('720') ? '720p' : d.url.includes('2160') || d.url.includes('4k') ? '4K' : 'HD';
          streams.push({
            name: `StreamPlay [VegaMovies]`,
            title: `V-Cloud (${d.label}) • ${quality}`,
            url: d.url
          });
        }
      });

      await Promise.allSettled(moviePromises);
    }
  } catch (err) {
    console.error('[VegaMovies] Provider error:', err.message);
  }

  return streams;
}
