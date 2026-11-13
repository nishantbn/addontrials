/**
 * Nuvio StreamPlay Addon Server
 * Lightweight, zero-external-dependency HTTP server adhering to Stremio Addon Protocol.
 * Includes high-performance, non-blocking streaming HLS proxy for header injection.
 */

import http from 'node:http';
import { Readable } from 'node:stream';
import { manifest } from './manifest.mjs';
import { resolveMetadata } from './utils/metadata.mjs';
import { getVidyStreams, VIDY_HEADERS } from './providers/vidy.mjs';
import { getVegaMoviesStreams } from './providers/vegamovies.mjs';
import { get4KHDHubStreams } from './providers/4khdhub.mjs';
import { getHDHub4uStreams } from './providers/hdhub4u.mjs';
import { getVidFastStreams } from './providers/vidfast.mjs';

const PORT = process.env.PORT || 7000;

function sendJson(res, statusCode, data) {
  const jsonStr = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'max-age=3600, stale-while-revalidate=1800'
  });
  res.end(jsonStr);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(html);
}

// In-Memory Segment Cache for zero-stutter instant response on replays/dual audio reads
const segmentCache = new Map();
const MAX_CACHE_ENTRIES = 120;

/**
 * Ultra-Low-Latency Streaming HLS & Media Proxy
 * Pipes chunks directly to the player with zero-copy streaming, correct video/mp2t MIME typing,
 * and high-speed in-memory segment caching to eliminate playback stutter.
 */
async function handleHlsProxy(req, res, targetUrl, host, requestPath = '') {
  if (!targetUrl) {
    res.writeHead(400);
    return res.end('Missing target URL');
  }

  // 1. Instant Cache Hit for video segments
  if (segmentCache.has(targetUrl)) {
    const cached = segmentCache.get(targetUrl);
    res.writeHead(200, {
      'Content-Type': cached.contentType,
      'Content-Length': cached.buffer.length,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    return res.end(cached.buffer);
  }

  try {
    const upstreamHeaders = {
      ...VIDY_HEADERS,
      ...(req.headers.range ? { 'Range': req.headers.range } : {})
    };

    const upstreamRes = await fetch(targetUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(15000)
    });

    if (!upstreamRes.ok) {
      res.writeHead(upstreamRes.status, { 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }

    const rawContentType = upstreamRes.headers.get('content-type') || '';
    
    // Explicit determination: Is this a playlist or a binary media segment?
    const isSegment = requestPath.endsWith('.ts') || 
                      targetUrl.includes('.ts') || 
                      (!targetUrl.includes('.m3u8') && !rawContentType.includes('mpegurl') && !requestPath.endsWith('.m3u8'));
    const isPlaylist = !isSegment;

    if (isPlaylist) {
      const responseHeaders = {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Accept-Ranges': 'bytes'
      };

      res.writeHead(upstreamRes.status, responseHeaders);

      const text = await upstreamRes.text();
      const baseUrl = new URL(targetUrl);
      const lines = text.split('\n');

      const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          if (trimmed.startsWith('#EXT-X-KEY:') && trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
              const resUri = new URL(uri, baseUrl).href;
              return `URI="${proto}://${host}/proxy/hls/segment.ts?url=${encodeURIComponent(resUri)}"`;
            });
          }
          return line;
        }
        const resolved = new URL(trimmed, baseUrl).href;
        // If line contains another playlist (e.g. variant stream), route to playlist.m3u8
        // If line is media segment, route to segment.ts
        const childIsPlaylist = trimmed.includes('.m3u8') || trimmed.includes('/playlist') || text.includes('#EXT-X-STREAM-INF');
        const proxySubpath = childIsPlaylist ? 'playlist.m3u8' : 'segment.ts';
        return `${proto}://${host}/proxy/hls/${proxySubpath}?url=${encodeURIComponent(resolved)}`;
      }).join('\n');

      return res.end(rewritten);
    } else {
      // Binary Video Segment (MPEG-TS or MP4)
      // CRITICAL: Upstream vividstone servers send bogus "text/html; charset=UTF-8" which
      // destroys ExoPlayer / mpv hardware pipelines. Force proper video/mp2t MIME type!
      const finalContentType = targetUrl.includes('.mp4') || targetUrl.includes('.m4s') 
        ? 'video/mp4' 
        : 'video/mp2t';

      const responseHeaders = {
        'Content-Type': finalContentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      };

      if (upstreamRes.headers.get('content-range')) {
        responseHeaders['Content-Range'] = upstreamRes.headers.get('content-range');
      }
      if (upstreamRes.headers.get('content-length')) {
        responseHeaders['Content-Length'] = upstreamRes.headers.get('content-length');
      }

      res.writeHead(upstreamRes.status, responseHeaders);

      // Stream directly to player while collecting into in-memory LRU cache
      const chunks = [];
      const bodyStream = Readable.fromWeb(upstreamRes.body);

      bodyStream.on('data', (chunk) => {
        chunks.push(chunk);
        res.write(chunk);
      });

      bodyStream.on('end', () => {
        res.end();
        const fullBuf = Buffer.concat(chunks);
        if (segmentCache.size >= MAX_CACHE_ENTRIES) {
          const firstKey = segmentCache.keys().next().value;
          segmentCache.delete(firstKey);
        }
        segmentCache.set(targetUrl, {
          buffer: fullBuf,
          contentType: finalContentType
        });
      });

      bodyStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });

      req.on('close', () => {
        bodyStream.destroy();
      });
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      res.end('Proxy Gateway Timeout/Error');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = new URL(req.url, `http://${host}`);
  const pathname = url.pathname;

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    });
    return res.end();
  }

  // 1. Root landing page
  if (pathname === '/' || pathname === '/configure') {
    const manifestUrl = `http://${host}/manifest.json`;
    const stremioInstallUrl = `stremio://${host}/manifest.json`;

    return sendHtml(res, `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>StreamPlay Nuvio Addon</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 540px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    h1 { color: #38bdf8; margin: 0 0 10px 0; }
    p { color: #94a3b8; line-height: 1.6; margin: 0 0 24px 0; }
    .btn { display: block; text-align: center; background: #0284c7; color: white; padding: 14px 20px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-bottom: 16px; }
    .input-box { width: 100%; background: #0f172a; border: 1px solid #334155; color: #cbd5e1; padding: 12px; border-radius: 8px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎬 StreamPlay for Nuvio</h1>
    <p>High-reliability streaming provider replicating CloudStream's StreamPlay gold standard.</p>
    <a href="${stremioInstallUrl}" class="btn">🚀 Install in Nuvio / Stremio</a>
    <input type="text" class="input-box" value="${manifestUrl}" readonly onclick="this.select();">
  </div>
</body>
</html>
    `);
  }

  // 2. Addon Manifest
  if (pathname === '/manifest.json') {
    return sendJson(res, 200, manifest);
  }

  // 3. Streaming Proxy Route (/proxy/hls, /proxy/hls/manifest.m3u8, /proxy/hls/playlist.m3u8, /proxy/hls/segment.ts)
  if (pathname.startsWith('/proxy/hls')) {
    const targetUrl = url.searchParams.get('url');
    return handleHlsProxy(req, res, targetUrl, host, pathname);
  }

  // 3.5 Diagnostic Route for Vidy
  if (pathname === '/debug/vidy') {
    const tmdbId = url.searchParams.get('tmdbId') || '550';
    const diag = { tmdbId, timestamp: new Date().toISOString() };
    try {
      const sRes = await fetch(`https://api.wecollege.net/seed?mediaId=${tmdbId}`, {
        headers: VIDY_HEADERS,
        signal: AbortSignal.timeout(6000)
      });
      diag.seedHttpStatus = sRes.status;
      diag.seedHttpStatusText = sRes.statusText;
      diag.seedHeaders = Object.fromEntries(sRes.headers.entries());
      const sBody = await sRes.text();
      diag.seedBody = sBody.slice(0, 500);
      try {
        const seedJson = JSON.parse(sBody);
        diag.seed = seedJson.seed;
        // Also test calling miami server
        const mRes = await fetch(`https://api.wecollege.net/miami/sources?title=Fight%20Club&mediaType=movie&year=1999&tmdbId=${tmdbId}&enc=2&seed=${diag.seed}`, {
          headers: VIDY_HEADERS,
          signal: AbortSignal.timeout(6000)
        });
        diag.miamiHttpStatus = mRes.status;
        diag.miamiBody = (await mRes.text()).slice(0, 500);
      } catch (err) {
        diag.miamiError = err.message;
      }
    } catch (e) {
      diag.seedError = e.message;
    }
    return sendJson(res, 200, diag);
  }

  // 4. Stream resolution: /stream/:type/:id.json
  const streamMatch = pathname.match(/^\/stream\/(movie|series)\/([^/]+)\.json$/);
  if (streamMatch) {
    const rawType = streamMatch[1];
    const fullId = decodeURIComponent(streamMatch[2]);

    let id = fullId;
    let season = undefined;
    let episode = undefined;

    if (rawType === 'series' && fullId.includes(':')) {
      const parts = fullId.split(':');
      id = parts[0];
      season = parseInt(parts[1], 10);
      episode = parseInt(parts[2], 10);
    }

    try {
      const meta = await resolveMetadata(rawType, id);
      console.log(`[StreamPlay] Request: ${rawType} "${meta.title || id}" (TMDB: ${meta.tmdbId}, IMDb: ${meta.imdbId}) S:${season || '-'} E:${episode || '-'}`);

      const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      const proxyPrefix = `${proto}://${host}/proxy/hls/manifest.m3u8?url=`;

      const providerPromises = [
        getVidyStreams({
          tmdbId: meta.tmdbId,
          imdbId: meta.imdbId,
          title: meta.title,
          year: meta.year,
          type: rawType,
          season,
          episode,
          proxyPrefix
        }),
        getVegaMoviesStreams({
          imdbId: meta.imdbId,
          title: meta.title,
          year: meta.year,
          type: rawType,
          season,
          episode
        }),
        get4KHDHubStreams({
          title: meta.title,
          year: meta.year,
          type: rawType,
          season,
          episode
        }),
        getHDHub4uStreams({
          title: meta.title,
          year: meta.year,
          type: rawType,
          season,
          episode
        }),
        getVidFastStreams({
          tmdbId: meta.tmdbId,
          type: rawType,
          season,
          episode
        })
      ];

      const settled = await Promise.allSettled(providerPromises);
      const allStreams = [];

      for (const result of settled) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allStreams.push(...result.value);
        }
      }

      // Quality Rank: 4K (4000) > 1080p (3000) > Auto Adaptive (2500) > 720p (2000) > 480p (1000)
      function getQualityScore(s) {
        const text = `${s.name} ${s.title}`.toLowerCase();
        if (text.includes('4k') || text.includes('2160p') || text.includes('uhd')) return 4000;
        if (text.includes('1080p') || text.includes('fhd')) return 3000;
        if (text.includes('auto')) return 2500;
        if (text.includes('720p') || text.includes('hd')) return 2000;
        if (text.includes('480p') || text.includes('sd')) return 1000;
        return 500;
      }

      function getSizeScore(s) {
        const text = `${s.name} ${s.title}`;
        const m = text.match(/💾\s*(\d+(?:\.\d+)?)\s*(GB|MB)/i) || text.match(/\[?\b(\d+(?:\.\d+)?)\s*(GB|MB)\b\]?/i);
        if (m) {
          const val = parseFloat(m[1]);
          return m[2].toUpperCase() === 'GB' ? val * 1024 : val;
        }
        return 0;
      }

      // Sort streams descending by quality, then by file size / bitrate
      allStreams.sort((a, b) => {
        const qDiff = getQualityScore(b) - getQualityScore(a);
        if (qDiff !== 0) return qDiff;
        return getSizeScore(b) - getSizeScore(a);
      });

      console.log(`[StreamPlay] Resolved ${allStreams.length} stream sources for "${meta.title || id}" (Sorted descending)`);
      return sendJson(res, 200, { streams: allStreams });
    } catch (err) {
      console.error('[StreamPlay] Pipeline error:', err);
      return sendJson(res, 200, { streams: [] });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🚀 StreamPlay Nuvio Addon Server running on :${PORT}`);
  console.log(`  👉 Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`======================================================\n`);
});
