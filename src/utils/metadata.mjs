/**
 * Metadata & ID Resolver
 * Resolves IMDb ID (tt...) <-> TMDB ID (int), Title, and Year
 * Primary: Cinemeta (fast, global, zero rate limit)
 * Secondary: TMDB API (with fallback key)
 */

const TMDB_API_KEY = "98ae14df2b8d8f8f8136499daf79f0e0";

export async function resolveMetadata(type, id) {
  let tmdbId = null;
  let imdbId = null;
  let title = '';
  let year = '';

  const cleanType = type === 'series' || type === 'tv' ? 'series' : 'movie';

  // 1. If ID is already tmdb:xxxx
  if (id.startsWith('tmdb:')) {
    tmdbId = parseInt(id.replace('tmdb:', ''), 10);
    try {
      const res = await fetch(`https://api.themoviedb.org/3/${cleanType === 'series' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`);
      if (res.ok) {
        const data = await res.json();
        title = data.title || data.name || '';
        year = (data.release_date || data.first_air_date || '').split('-')[0];
        imdbId = data.imdb_id || null;
        return { tmdbId, imdbId, title, year, type: cleanType };
      }
    } catch (_) {}
  }

  // 2. Query Cinemeta (Standard Stremio Metadata Provider)
  imdbId = id.split(':')[0]; // In case id is tt12345:1:1
  try {
    const cinemetaUrl = `https://v3-cinemeta.strem.io/meta/${cleanType}/${imdbId}.json`;
    const res = await fetch(cinemetaUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.meta) {
        title = data.meta.name || '';
        year = (data.meta.year || data.meta.releaseInfo || '').toString().slice(0, 4);
        tmdbId = data.meta.moviedb_id ? parseInt(data.meta.moviedb_id, 10) : null;
        if (tmdbId) {
          return { tmdbId, imdbId, title, year, type: cleanType };
        }
      }
    }
  } catch (err) {
    console.warn(`[Metadata] Cinemeta lookup failed for ${imdbId}:`, err.message);
  }

  // 3. Fallback: TMDB find endpoint
  try {
    const res = await fetch(`https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`);
    if (res.ok) {
      const data = await res.json();
      const resItem = (cleanType === 'series' ? data.tv_results?.[0] : data.movie_results?.[0]) || data.movie_results?.[0] || data.tv_results?.[0];
      if (resItem) {
        tmdbId = resItem.id;
        title = resItem.title || resItem.name || '';
        year = (resItem.release_date || resItem.first_air_date || '').split('-')[0];
      }
    }
  } catch (_) {}

  return { tmdbId, imdbId, title, year, type: cleanType };
}
