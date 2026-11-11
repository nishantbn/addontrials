/**
 * Vidy StreamPlay Decryption Engine
 * 1:1 Port of CloudStream StreamPlayExtractor.kt
 * Algorithm: 32-bit FNV-1a Hash + Knuth Multiplicative Invertible Hash + 61-slot XOR Keystream
 */

function vidyL(e) {
  const v = Math.imul((e >>> 16) ^ e, -2048144789) >>> 0;
  const v2 = Math.imul((v >>> 13) ^ v, -1028477387) >>> 0;
  return ((v2 >>> 16) ^ v2) >>> 0;
}

function vidyRot(e, t) {
  const s = t & 31;
  if (s === 0) return e >>> 0;
  return ((e << s) | (e >>> (32 - s))) >>> 0;
}

function vidyFnv1a(str) {
  let t = -2128831035;
  for (let i = 0; i < str.length; i++) {
    t = Math.imul((str.charCodeAt(i) ^ t), 16777619);
  }
  return vidyL(t >>> 0);
}

function vidyInitState(seed, tmdbId) {
  const s = new Uint32Array(61);
  const isSet = new Uint8Array(61);
  let r = vidyL((vidyFnv1a(seed) ^ vidyL((tmdbId ^ -1640531527) >>> 0)) >>> 0);
  for (let e = 0; e < 8; e++) {
    const t = (r >>> 0) % 61;
    const r2 = vidyRot((r - 1640531527) >>> 0, (e & 7) + 7);
    s[t] = (vidyL(r2) ^ r2) >>> 0;
    isSet[t] = 1;
    r = vidyL((t + r2) >>> 0);
  }
  const acc = vidyL((-1515870811 ^ r) >>> 0);
  return { s, isSet, acc };
}

function vidyNextWord(state, t) {
  const i = (state.acc >>> 0) % 61;
  const oVal = state.isSet[i] ? -1 : 0;
  const d = state.isSet[i] ? state.s[i] : 0;
  const c = Math.imul((t + 1) >>> 0, -1640531527) >>> 0;
  const sVal = (d ^ c) >>> 0;
  const h = (((state.acc ^ sVal) | ((state.acc & sVal) & oVal))) >>> 0;
  const term1 = vidyRot((h + state.acc) >>> 0, i & 31);
  const term2 = vidyRot(state.acc, (i * 7) & 31);
  const n2 = vidyL(((term1 ^ term2) - 1640531527) >>> 0);
  state.s[i] = n2;
  state.isSet[i] = 1;
  state.acc = n2;
  return n2;
}

export function vidyKeystream(seed, tmdbId, len) {
  const st = vidyInitState(seed, tmdbId);
  const out = Buffer.alloc(len);
  let w = 0;
  let bi = 0;
  while (bi < len) {
    const wi = w + 1;
    const w2 = vidyNextWord(st, w);
    out[bi] = w2 & 0xff;
    bi++;
    if (bi < len) {
      out[bi] = (w2 >>> 8) & 0xff;
      bi++;
    }
    if (bi < len) {
      out[bi] = (w2 >>> 16) & 0xff;
      bi++;
    }
    if (bi < len) {
      out[bi] = (w2 >>> 24) & 0xff;
      bi++;
    }
    w = wi;
  }
  return out;
}

const VIDY_MAGIC = Buffer.from([109, 118, 109, 49]); // "mvm1"

/**
 * Decrypts Vidy source responses.
 * @param {string} cipherB64 Base64 encoded ciphertext
 * @param {string} seed Seed returned from api.wecollege.net/seed
 * @param {number} tmdbId TMDB identifier
 * @returns {string|null} Decrypted JSON string or null
 */
export function decryptVidy(cipherB64, seed, tmdbId) {
  try {
    let fixed = cipherB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (fixed.length % 4)) % 4;
    if (pad > 0) fixed += '='.repeat(pad);
    const bytes = Buffer.from(fixed, 'base64');
    if (bytes.length <= VIDY_MAGIC.length) return null;
    const ks = vidyKeystream(seed, tmdbId, bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = bytes[i] ^ ks[i];
    }
    for (let k = 0; k < VIDY_MAGIC.length; k++) {
      if (bytes[k] !== VIDY_MAGIC[k]) return null;
    }
    return bytes.subarray(VIDY_MAGIC.length).toString('utf8');
  } catch (err) {
    return null;
  }
}
