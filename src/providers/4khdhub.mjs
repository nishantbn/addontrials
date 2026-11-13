/**
 * 4KHDHub StreamPlay Provider
 * 1:1 Port of CloudStream invoke4khdhub()
 * Resolves high-bitrate 4K UHD and 1080p releases for both Movies and TV Series.
 */

import { getDomain } from '../utils/domains.mjs';
import { unshortenLink } from '../utils/unshorten.mjs';
import { formatStreamCard } from '../utils/formatter.mjs';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

async function resolveHubCloud(hubcloudUrl) {
  try {
    const res = await fetch(hubcloudUrl, { headers: HEADERS });
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
        }
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
    console.warn(`[HubCloud] Failed to resolve ${hubcloudUrl}:`, err.message);
  }
  return null;
}

export async function get4KHDHubStreams({ title, year, type, season, episode }) {
  if (!title) return [];
  const streams = [];

  try {
    const domain = await getDomain('4khdhub');
    const searchUrl = `${domain}/?s=${encodeURIComponent(title)}`;
    const searchRes = await fetch(searchUrl, { headers: HEADERS });
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

    // Match candidate by type / title / year
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

    // Fetch detail page
    const detailRes = await fetch(target.url, { headers: HEADERS });
    if (!detailRes.ok) return [];
    const detailHtml = await detailRes.text();

    const downloadEntries = [];

    // 1. TV Series Episode Matching
    if (isSeries && season !== undefined && episode !== undefined) {
      const sPad = String(season).padStart(2, '0');
      const epRegex = /<div class="episode-header"[^>]*>[\s\S]*?<div class="episode-number">([^<]+)<\/div>[\s\S]*?<div class="episode-downloads">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
      let sMatch;

      while ((sMatch = epRegex.exec(detailHtml)) !== null) {
        const sNum = sMatch[1].trim(); // e.g. S02
        if (sNum.includes(`S${sPad}`) || sNum.includes(`S${season}`)) {
          const dlBlock = sMatch[2];
          const itemRegex = /<span class="badge-psa">Episode-(\d+)<\/span>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="btn[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
          let itm;
          while ((itm = itemRegex.exec(dlBlock)) !== null) {
            const epNum = parseInt(itm[1], 10);
            if (epNum === episode) {
              downloadEntries.push({
                itemTitle: `${title} S${sPad}E${String(episode).padStart(2, '0')} HubCloud`,
                redirectLink: itm[2],
                btnText: itm[3].replace(/<[^>]+>/g, '').trim()
              });
            }
          }
        }
      }
    } else {
      // 2. Movie Matching
      const itemRegex = /<div class="download-item[^"]*"[\s\S]*?class="file-title">([\s\S]*?)<\/div>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="btn[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
      let itemMatch;
      while ((itemMatch = itemRegex.exec(detailHtml)) !== null) {
        const itemTitle = itemMatch[1].replace(/<[^>]+>/g, '').trim();
        const redirectLink = itemMatch[2];
        const btnText = itemMatch[3].replace(/<[^>]+>/g, '').trim();
        downloadEntries.push({ itemTitle, redirectLink, btnText });
      }
    }

    // Process up to 3 links in parallel
    const resolvePromises = downloadEntries.slice(0, 3).map(async (entry) => {
      try {
        let hostUrl = entry.redirectLink;
        if (hostUrl.includes('greenmotors') || hostUrl.includes('id=')) {
          hostUrl = await unshortenLink(hostUrl);
        }

        if (!hostUrl) return null;

        let streamUrl = hostUrl;
        if (hostUrl.includes('hubcloud') || hostUrl.includes('/drive/')) {
          const direct = await resolveHubCloud(hostUrl);
          if (direct) streamUrl = direct;
        }

        let qualityTag = '1080p';
        if (/2160p|4k|uhd/i.test(entry.itemTitle)) qualityTag = '4K';
        else if (/720p/i.test(entry.itemTitle)) qualityTag = '720p';

        const epSuffix = isSeries && season && episode ? ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : '';
        const displayTitle = `${title || 'Video'}${epSuffix}`;

        const formatted = formatStreamCard({
          provider: '4KHDHub',
          server: 'HubCloud',
          mediaTitle: displayTitle,
          year,
          rawReleaseTitle: entry.itemTitle,
          quality: qualityTag,
          isSeries
        });

        return {
          name: formatted.name,
          title: formatted.title,
          url: streamUrl,
          behaviorHints: {
            notWebReady: false
          }
        };
      } catch (e) {
        return null;
      }
    });

    const settled = await Promise.allSettled(resolvePromises);
    for (const res of settled) {
      if (res.status === 'fulfilled' && res.value) {
        streams.push(res.value);
      }
    }
  } catch (err) {
    console.error('[4KHDHub] Provider error:', err.message);
  }

  return streams;
}
