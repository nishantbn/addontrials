/**
 * Nuvio & Stremio Addon Manifest
 */

export const manifest = {
  id: 'org.stremio.streamplay.nuvio',
  version: '1.0.0',
  name: 'StreamPlay',
  description: 'Reliable StreamPlay Integration for Nuvio & Stremio (Vidy, 4KHDHub, VidFast)',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb'],
  catalogs: [],
  behaviorHints: {
    configurable: false,
    configurationRequired: false
  }
};
