/**
 * 4KHDHub / WP-HTTP ROT13 & Multi-Base64 Unshortener
 * 1:1 Port of CloudStream StreamPlayUtilsKt.getRedirectLinks()
 */

function rot13(str) {
  return str.replace(/[a-zA-Z]/g, function (c) {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      return String.fromCharCode(((code - 65 + 13) % 26) + 65);
    } else {
      return String.fromCharCode(((code - 97 + 13) % 26) + 97);
    }
  });
}

function b64decode(str) {
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Resolves intermediate redirect pages using ROT13 + 3-stage Base64 decoding.
 * @param {string} intermediateUrl URL of the greenmotors / redirect page
 * @returns {Promise<string|null>} Target direct host URL (e.g. HubCloud)
 */
export async function unshortenLink(intermediateUrl) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };

    const res = await fetch(intermediateUrl, { headers });
    if (!res.ok) return null;
    const html = await res.text();

    const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    let rMatch;
    let sb = '';
    while ((rMatch = regex.exec(html)) !== null) {
      sb += (rMatch[1] || rMatch[2]);
    }

    if (!sb) return null;

    // CloudStream sequence: base64Decode(hdhubpen(base64Decode(base64Decode(sb))))
    const decoded1 = b64decode(sb);
    const decoded2 = b64decode(decoded1);
    const rotated = rot13(decoded2);
    const jsonStr = b64decode(rotated);
    const json = JSON.parse(jsonStr);

    const fallbackUrl = json.o ? b64decode(json.o) : null;
    const reVal = json.data ? b64decode(json.data) : null;
    const blogUrl = json.blog_url;

    if (blogUrl && reVal) {
      try {
        const blogRes = await fetch(`${blogUrl}?re=${reVal}`, { headers });
        if (blogRes.ok) {
          const blogHtml = await blogRes.text();
          // Extract body text or direct link
          const match = blogHtml.match(/https?:\/\/[^\s"'<>]+/);
          if (match) return match[0];
        }
      } catch (err) {
        // Fall back to json.o
      }
    }

    return fallbackUrl;
  } catch (err) {
    console.error(`[Unshorten] Failed to unshorten ${intermediateUrl}:`, err.message);
    return null;
  }
}
