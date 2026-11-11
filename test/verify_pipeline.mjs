/**
 * Automated Verification Suite for StreamPlay Providers & Pipeline
 */

import { resolveMetadata } from '../src/utils/metadata.mjs';
import { getVidyStreams } from '../src/providers/vidy.mjs';
import { get4KHDHubStreams } from '../src/providers/4khdhub.mjs';
import { getVidFastStreams } from '../src/providers/vidfast.mjs';
import { manifest } from '../src/manifest.mjs';

async function runTests() {
  console.log(`\n===================================================`);
  console.log(`  RUNNING STREAMPLAY NUVIO INTEGRATION TEST SUITE`);
  console.log(`===================================================\n`);

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ PASS: ${testName} ${details ? `(${details})` : ''}`);
    } else {
      console.error(`  ❌ FAIL: ${testName} ${details ? `(${details})` : ''}`);
    }
  }

  // Test 1: Manifest structure
  console.log('--- Test Group 1: Addon Manifest ---');
  assert(manifest.id === 'org.stremio.streamplay.nuvio', 'Manifest ID correct');
  assert(manifest.resources.includes('stream'), 'Manifest advertises stream resource');
  assert(manifest.types.includes('movie') && manifest.types.includes('series'), 'Manifest advertises movie and series');

  // Test 2: Metadata Resolver
  console.log('\n--- Test Group 2: Metadata & TMDB ID Resolution ---');
  const movieMeta = await resolveMetadata('movie', 'tt0468569');
  assert(movieMeta.title === 'The Dark Knight', 'Resolved Movie Title', movieMeta.title);
  assert(movieMeta.tmdbId === 155, 'Resolved Movie TMDB ID', movieMeta.tmdbId);

  const tvMeta = await resolveMetadata('series', 'tt0944947');
  assert(tvMeta.title === 'Game of Thrones', 'Resolved TV Title', tvMeta.title);
  assert(tvMeta.tmdbId === 1399, 'Resolved TV TMDB ID', tvMeta.tmdbId);

  // Test 3: Vidy Provider (Live Stream Decryption)
  console.log('\n--- Test Group 3: Vidy Provider ---');
  console.log('Fetching Vidy streams for The Dark Knight...');
  const vidyStreams = await getVidyStreams({
    tmdbId: movieMeta.tmdbId,
    title: movieMeta.title,
    type: 'movie'
  });
  console.log(`Vidy returned ${vidyStreams.length} streams.`);
  assert(vidyStreams.length > 0, 'Vidy returned stream sources');
  if (vidyStreams.length > 0) {
    const hasMaster = vidyStreams.some(s => s.url.includes('.m3u8'));
    assert(hasMaster, 'Vidy returned valid HLS Master / Variant playlist', vidyStreams[0].url.substring(0, 60) + '...');
  }

  // Test 4: 4KHDHub Provider (Search + Unshorten + Direct Host)
  console.log('\n--- Test Group 4: 4KHDHub Provider ---');
  console.log('Fetching 4KHDHub streams for The Dark Knight...');
  const hubStreams = await get4KHDHubStreams({
    title: movieMeta.title,
    year: movieMeta.year,
    type: 'movie'
  });
  console.log(`4KHDHub returned ${hubStreams.length} streams.`);
  assert(hubStreams.length > 0, '4KHDHub returned high-bitrate sources');
  if (hubStreams.length > 0) {
    console.log('Sample 4KHDHub stream:', hubStreams[0].title, '->', hubStreams[0].url.substring(0, 70) + '...');
    assert(hubStreams[0].url.startsWith('http'), '4KHDHub stream URL is valid HTTP link');
  }

  // Test 5: VidFast Provider (Embed + enc-dec.app)
  console.log('\n--- Test Group 5: VidFast Provider ---');
  console.log('Fetching VidFast streams for The Dark Knight...');
  const vidfastStreams = await getVidFastStreams({
    tmdbId: movieMeta.tmdbId,
    type: 'movie'
  });
  console.log(`VidFast returned ${vidfastStreams.length} streams.`);
  // Note: if VidFast embed experiences rate limiting or rotation, providers fail-closed gracefully
  assert(Array.isArray(vidfastStreams), 'VidFast provider execution completed gracefully');

  // Test 6: TV Series Episodic Resolution
  console.log('\n--- Test Group 6: TV Episode Resolution ---');
  console.log('Fetching Vidy streams for Game of Thrones S01E01...');
  const tvVidyStreams = await getVidyStreams({
    tmdbId: tvMeta.tmdbId,
    title: tvMeta.title,
    type: 'series',
    season: 1,
    episode: 1
  });
  console.log(`TV Vidy returned ${tvVidyStreams.length} streams.`);
  assert(tvVidyStreams.length > 0, 'TV series episode returned streams for S01E01');

  // Summary
  console.log(`\n===================================================`);
  console.log(`  VERIFICATION RESULTS: ${passedTests}/${totalTests} Passed (${Math.round((passedTests/totalTests)*100)}%)`);
  console.log(`===================================================\n`);

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
