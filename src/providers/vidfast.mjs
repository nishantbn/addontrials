/**
 * VidFast StreamPlay Provider
 * 1:1 Port of CloudStream invokeVidFast()
 * Uses NextJS token extraction and enc-dec.app resolver.
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Referer': 'https://vidfast.vc/',
  'X-Requested-With': 'XMLHttpRequest'
};

const API = 'https://enc-dec.app/api';

async function postJson(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': HEADERS['User-Agent'],
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function postEmpty(url, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...HEADERS,
      ...extraHeaders
    }
  });
  return await res.text();
}

export async function getVidFastStreams({ tmdbId, type, season, episode }) {
  if (!tmdbId) return [];
  const streams = [];

  try {
    const embedUrl = type === 'series' && season && episode
      ? `https://vidfast.vc/tv/${tmdbId}/${season}/${episode}`
      : `https://vidfast.vc/movie/${tmdbId}`;

    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': HEADERS['Referer']
      }
    });

    if (!res.ok) return [];
    const html = await res.text();

    // Extract escaped or unescaped token/en
    const regex = /\\?"(?:en|token)\\?"\s*:\s*\\?"([^\\"]+)\\?"/;
    const match = regex.exec(html);
    if (!match) return [];

    const enToken = match[1];

    // Stage 1
    const stage1Res = await fetch(`${API}/enc-vidfast?text=${encodeURIComponent(enToken)}&stage=1`, {
      headers: { 'User-Agent': HEADERS['User-Agent'] }
    });
    if (!stage1Res.ok) return [];
    const stage1Json = await stage1Res.json();
    if (stage1Json.status !== 200 || !stage1Json.result) return [];

    const stage1Data = stage1Json.result;
    const stage1Url = stage1Data.stage1 || stage1Data;
    const stage1Token = stage1Data.token || '';

    // Fetch stage 1 encrypted text
    const stage1Text = await postEmpty(stage1Url, {
      'X-CSRF-Token': stage1Token
    });
    if (!stage1Text) return [];

    // Stage 2
    const stage2Res = await fetch(`${API}/enc-vidfast?text=${encodeURIComponent(stage1Text)}&stage=2`, {
      headers: { 'User-Agent': HEADERS['User-Agent'] }
    });
    if (!stage2Res.ok) return [];
    const stage2Json = await stage2Res.json();
    if (stage2Json.status !== 200 || !stage2Json.result) return [];

    const { servers: serversUrl, stream: streamBaseUrl, token: stage2Token } = stage2Json.result;

    // Get servers
    const serversEncrypted = await postEmpty(serversUrl, {
      'X-CSRF-Token': stage2Token
    });
    if (!serversEncrypted) return [];

    // Decrypt servers
    const decServersRes = await postJson(`${API}/dec-vidfast`, { text: serversEncrypted });
    if (decServersRes.status !== 200 || !Array.isArray(decServersRes.result)) return [];

    const serversList = decServersRes.result;

    // Sample top servers in parallel
    const serverPromises = serversList.slice(0, 3).map(async (server, idx) => {
      try {
        const streamEndpoint = `${streamBaseUrl}/${server.data}`;
        const streamEncrypted = await postEmpty(streamEndpoint, {
          'X-CSRF-Token': stage2Token
        });
        if (!streamEncrypted) return null;

        const decStreamRes = await postJson(`${API}/dec-vidfast`, { text: streamEncrypted });
        if (decStreamRes.status !== 200 || !decStreamRes.result) return null;

        const streamResult = decStreamRes.result;
        const playUrl = streamResult.url || streamResult.stream || streamResult;
        if (typeof playUrl !== 'string' || !playUrl.startsWith('http')) return null;

        const serverName = server.name || `Server ${idx + 1}`;

        return {
          name: 'StreamPlay [VidFast]',
          title: `${serverName} | Direct Stream`,
          url: playUrl,
          behaviorHints: {
            notWebReady: false
          }
        };
      } catch (_) {
        return null;
      }
    });

    const settled = await Promise.allSettled(serverPromises);
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        streams.push(s.value);
      }
    }
  } catch (err) {
    console.error('[VidFast] Provider error:', err.message);
  }

  return streams;
}
