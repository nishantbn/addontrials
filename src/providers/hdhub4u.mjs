/**
 * HDHub4u StreamPlay Provider
 * 1:1 Port of CloudStream invokehdhub4u()
 * Resolves Multi-quality releases from HDHub4u for Movies and TV Series.
 */

import { getDomain } from '../utils/domains.mjs';
import { unshortenLink } from '../utils/unshorten.mjs';
import { formatStreamCard } from '../utils/formatter.mjs';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

async function resolveHubCloud(hubcloudUrl) {
  try {
    const res = await fetch(hubcloudUrl, { headers: HEADERS, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const html = await res.text();

    const m = html.match(/href="([^"]*gamerxyt\.com\/hubcloud\.php[^"]*)"/i) ||
              html.match(/href="([^"]*hubcloud\.php[^"]*)"/i);

    if (m) {
      const generatorUrl = m[1];
      const genRes = await fetch(generatorUrl, {
        headers: {
          ...HEADERS,
          'Referer': hubcloudUrl
        },
        signal: AbortSignal.timeout(4000)
      });
      if (!genRes.ok) return null;
      const genHtml = await genRes.text();

      const directMatch = genHtml.match(/href="([^"]*(?:workers\.dev|pixel\.hubcloud)[^"]*)"/i) ||
                          genHtml.match(/href="([^"]*\.(?:mkv|mp4)[^"]*)"/i);

      if (directMatch) {
        return directMatch[1];
      }
    }
  } catch (err) {
    // silently catch timeout/aborts
  }
  return null;
}

export async function getHDHub4uStreams({ title, year, type, season, episode }) {
  if (!title) return [];
  const streams = [];

  try {
    const domain = await getDomain('HDHUB4u') || 'https://new13.hdhub4u.cl';
    const searchUrl = `${domain}/?s=${encodeURIComponent(title)}`;
    const searchRes = await fetch(searchUrl, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!searchRes.ok) return [];
    const searchHtml = await searchRes.text();

    // Extract cards: <a href="([^"]+)" class="movie-card" aria-label="([^"]+)"
    const cardRegex = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*movie-card[^"]*"[^>]*aria-label="([^"]+)"/gi;
    let m;
    const candidates = [];
    while ((m = cardRegex.exec(searchHtml)) !== null) {
      candidates.push({
        url: new URL(m[1], domain).href,
        label: m[2].trim()
      });
    }

    if (candidates.length === 0) return [];

    let target = candidates[0];
    const isSeries = type === 'series' || season !== undefined;

    for (const cand of candidates) {
      if (isSeries && cand.url.includes('-series-')) {
        target = cand;
        break;
      }
      if (!isSeries && cand.url.includes('-movie-')) {
        target = cand;
        break;
      }
    }

    const detailRes = await fetch(target.url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!detailRes.ok) return [];
    const detailHtml = await detailRes.text();

    const downloadEntries = [];

    if (isSeries && season !== undefined && episode !== undefined) {
      const sPad = String(season).padStart(2, '0');
      const epRegex = /<div class="episode-header"[^>]*>[\s\S]*?<div class="episode-number">([^<]+)<\/div>[\s\S]*?<div class="episode-downloads">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
      let sMatch;

      while ((sMatch = epRegex.exec(detailHtml)) !== null) {
        const sNum = sMatch[1].trim();
        if (sNum.includes(`S${sPad}`) || sNum.includes(`S${season}`) || sNum.includes(`Season ${season}`)) {
          const epBlock = sMatch[2];
          const epItemRegex = /<div class="episode-download-item"[^>]*>[\s\S]*?<span class="badge-psa">([^<]+)<\/span>[\s\S]*?<div class="episode-links">([\s\S]*?)<\/div>\s*<\/div>/gi;
          let epItemMatch;

          while ((epItemMatch = epItemRegex.exec(epBlock)) !== null) {
            const epBadge = epItemMatch[1].trim();
            const epNumMatch = epBadge.match(/\d+/);
            if (epNumMatch && parseInt(epNumMatch[0], 10) === episode) {
              const linkBlock = epItemMatch[2];
              const aRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
              let aMatch;
              while ((aMatch = aRegex.exec(linkBlock)) !== null) {
                downloadEntries.push({
                  url: aMatch[1],
                  title: `${target.label} • S${sPad}E${String(episode).padStart(2, '0')} [${aMatch[2].trim()}]`
                });
              }
            }
          }
        }
      }
    } else {
      const movieRegex = /<div class="download-item"[^>]*>[\s\S]*?<div class="file-title">([^<]+)<\/div>[\s\S]*?<div class="download-buttons">([\s\S]*?)<\/div>\s*<\/div>/gi;
      let mMatch;
      while ((mMatch = movieRegex.exec(detailHtml)) !== null) {
        const fileTitle = mMatch[1].trim();
        const btnBlock = mMatch[2];
        const aRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
        let aMatch;
        while ((aMatch = aRegex.exec(btnBlock)) !== null) {
          downloadEntries.push({
            url: aMatch[1],
            title: `${fileTitle} [${aMatch[2].trim()}]`
          });
        }
      }
    }

    const unshortenTasks = downloadEntries.slice(0, 3).map(async (entry) => {
      try {
        const intermediate = await unshortenLink(entry.url);
        if (intermediate) {
          const directStream = await resolveHubCloud(intermediate);
          if (directStream) {
            const quality = entry.title.includes('2160p') || entry.title.includes('4K') ? '4K' :
                            entry.title.includes('1080p') ? '1080p' :
                            entry.title.includes('720p') ? '720p' : 'HD';

            const epSuffix = isSeries && season && episode ? ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : '';
            const displayTitle = `${title || 'Video'}${epSuffix}`;

            const formatted = formatStreamCard({
              provider: 'HDHub4u',
              server: 'HubCloud',
              mediaTitle: displayTitle,
              year,
              rawReleaseTitle: entry.title,
              quality,
              isSeries
            });

            streams.push({
              name: formatted.name,
              title: formatted.title,
              url: directStream,
              behaviorHints: {
                notWebReady: false
              }
            });
          }
        }
      } catch (err) {}
    });

    await Promise.allSettled(unshortenTasks);
  } catch (err) {
    console.error('[HDHub4u] Provider error:', err.message);
  }

  return streams;
}
