/**
 * StreamPlay Metadata & Stream Card Formatter
 * 1:1 match for PenguPlay & CNCVerse high-detail formatting in Nuvio & Stremio.
 * Produces structured emoji rows, media specifications, bitrate estimation, and badge tags.
 */

export function formatStreamCard({
  provider = 'StreamPlay',
  server = '',
  mediaTitle = '',
  year = '',
  rawReleaseTitle = '',
  quality = '1080p',
  container = '',
  codec = '',
  dynamics = '',
  audio = '',
  size = '',
  bitrate = '',
  subtitles = [],
  isSeries = false,
  extra = ''
}) {
  const combinedText = `${rawReleaseTitle} ${extra} ${quality} ${container} ${codec} ${dynamics} ${audio} ${size}`.trim();

  // 1. Detect Resolution
  let res = quality;
  if (/2160p|4k|uhd/i.test(combinedText)) res = '4K';
  else if (/1080p|fhd/i.test(combinedText)) res = '1080p';
  else if (/720p|hd\b/i.test(combinedText)) res = '720p';
  else if (/480p|sd\b/i.test(combinedText)) res = '480p';
  else if (/auto/i.test(combinedText)) res = 'Auto';

  // 2. Detect Container
  let cont = container;
  if (!cont) {
    if (/m3u8|hls/i.test(combinedText)) cont = 'HLS';
    else if (/\.mp4\b|mp4/i.test(combinedText)) cont = 'MP4';
    else cont = 'MKV';
  }

  // 3. Detect Video Codec
  let cdc = codec;
  if (!cdc) {
    if (/hevc|x265|h\.?265/i.test(combinedText)) cdc = 'HEVC';
    else if (/av1/i.test(combinedText)) cdc = 'AV1';
    else if (/vp9/i.test(combinedText)) cdc = 'VP9';
    else if (/x264|h\.?264/i.test(combinedText)) cdc = 'H.264';
    else if (/avc/i.test(combinedText)) cdc = 'AVC';
    else if (cont === 'HLS') cdc = 'AVC'; // HLS streaming profiles predominantly use AVC/H.264
    else cdc = res === '4K' ? 'HEVC' : 'H.264';
  }

  // 4. Source/Rip Type
  let srcType = '';
  if (/bluray|bdrip/i.test(combinedText)) srcType = 'BluRay';
  else if (/web-?dl/i.test(combinedText)) srcType = 'WEB-DL';
  else if (/webrip/i.test(combinedText)) srcType = 'WEBRip';
  else if (/hdtv/i.test(combinedText)) srcType = 'HDTV';

  // 5. Dynamic Range (DV, HDR, HDR10+, 10-bit)
  const dynList = [];
  if (dynamics) dynList.push(dynamics);
  if (/\bdv\b|dolby\s*vision/i.test(combinedText) && !dynList.includes('DV')) dynList.push('DV');
  if (/hdr10\+/i.test(combinedText) && !dynList.includes('HDR10+')) dynList.push('HDR10+');
  else if (/\bhdr\b/i.test(combinedText) && !dynList.includes('HDR')) dynList.push('HDR');
  if (/10bit|10-bit/i.test(combinedText) && !dynList.includes('10-bit')) dynList.push('10-bit');

  // 6. Audio Languages & Codecs
  let aud = audio || 'English';
  if (/hindi.*english|dual\s*audio/i.test(combinedText)) aud = 'Hindi, English';
  else if (/multi/i.test(combinedText)) aud = 'Multi Audio';
  else if (/hindi/i.test(combinedText)) aud = 'Hindi';
  else if (/french/i.test(combinedText)) aud = 'French';
  else if (/german/i.test(combinedText)) aud = 'German';

  const audSpecs = [];
  if (/atmos/i.test(combinedText)) audSpecs.push('Atmos');
  if (/ddp5\.1|dd\+|eac3/i.test(combinedText)) audSpecs.push('DD+');
  else if (/dd5\.1|ac3/i.test(combinedText)) audSpecs.push('5.1');
  else if (/7\.1/i.test(combinedText)) audSpecs.push('7.1');
  else if (/aac/i.test(combinedText)) audSpecs.push('AAC');
  else if (cont === 'HLS' && audSpecs.length === 0) audSpecs.push('AAC');

  const fullAudio = audSpecs.length > 0 ? `${aud} (${audSpecs.join(', ')})` : aud;

  // 7. Accurate File Size & Bitrate Estimation
  let finalSize = size;
  let finalBitrate = bitrate;

  const sizeMatch = combinedText.match(/\[?\b(\d+(?:\.\d+)?)\s*(GB|MB)\b\]?/i);
  if (sizeMatch) {
    finalSize = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;
  }

  // Duration in minutes (standard TV episode: 45 min, movie: 110 min)
  const durationMins = isSeries ? 45 : 110;
  const durationSecs = durationMins * 60;

  if (finalSize && !finalBitrate) {
    // Derive bitrate from known file size
    const num = parseFloat(finalSize);
    const isGb = finalSize.includes('GB');
    const totalMb = isGb ? num * 1024 : num;
    const calculatedMbps = ((totalMb * 8) / durationSecs).toFixed(1);
    if (parseFloat(calculatedMbps) > 0.1) {
      finalBitrate = `~${calculatedMbps} Mbps`;
    }
  } else if (!finalSize) {
    // Realistic production bitrates & sizes calibrated to real upstream HLS & MP4 streams
    if (res === '4K') {
      finalBitrate = '~16.0 Mbps';
      finalSize = isSeries ? '5.4 GB' : '13.2 GB';
    } else if (res === '1080p') {
      finalBitrate = '~6.0 Mbps';
      finalSize = isSeries ? '2.0 GB' : '5.0 GB';
    } else if (res === '720p') {
      finalBitrate = '~3.1 Mbps';
      finalSize = isSeries ? '1.0 GB' : '2.6 GB';
    } else if (res === '480p') {
      finalBitrate = '~1.3 Mbps';
      finalSize = isSeries ? '440 MB' : '1.1 GB';
    } else {
      // Auto / Adaptive HLS master
      finalBitrate = '~6.0 Mbps';
      finalSize = isSeries ? '2.0 GB' : '5.0 GB';
    }
  }

  // 8. Subtitles Row
  let subsRow = '';
  if (Array.isArray(subtitles) && subtitles.length > 0) {
    const subNames = subtitles.map(s => s.lang || s.language || s.id || 'English').slice(0, 4);
    const moreCount = subtitles.length - subNames.length;
    subsRow = `💬 Subs: ${subNames.join(', ')}${moreCount > 0 ? ` +${moreCount} more` : ''}`;
  } else {
    subsRow = '🙈 No included subtitles';
  }

  // Build the Header Name
  const serverTag = server ? ` • ${server}` : '';
  const cardName = `StreamPlay ❄️ ${res} • ${provider}${serverTag}`;

  // Build the Spec Line (Resolution • Container • Codec • Source • Dynamics)
  const specTokens = [res, cont, cdc, srcType, ...dynList, ...audSpecs].filter(Boolean);
  const specLine = Array.from(new Set(specTokens)).join(' • ');

  // Assemble the multi-line card description
  const titleParts = [];

  // Line 1: Movie/Show title & Year
  const yearStr = year ? ` (${year})` : '';
  titleParts.push(`🍿 ${mediaTitle || 'Video'}${yearStr}`);

  // Line 2: Raw Release String (if present from torrent/direct rip)
  if (rawReleaseTitle && rawReleaseTitle !== mediaTitle) {
    titleParts.push(`🏷️ ${rawReleaseTitle}`);
  }

  // Line 3: Media Specs
  if (specLine) {
    titleParts.push(`🎞️ ${specLine}${finalBitrate ? ` • ${finalBitrate}` : ''}`);
  }

  // Line 4: Source
  titleParts.push(`📡 Source: ${provider}${serverTag ? ` [${server}]` : ''}`);

  // Line 5: Size & Bitrate
  if (finalSize) {
    titleParts.push(`💾 ${finalSize}${finalBitrate ? ` • ${finalBitrate}` : ''}`);
  }

  // Line 6: Audio
  if (fullAudio) {
    titleParts.push(`🎧 Audio: ${fullAudio}`);
  }

  // Line 7: Subtitles
  titleParts.push(subsRow);

  return {
    name: cardName,
    title: titleParts.join('\n')
  };
}
