import { formatCount, formatExactCount } from './analytics.mjs';

export function xml(value) {
  return String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}
function width(text, size, font) {
  return [...text].reduce((n, c) => n + (font.glyphs[c]?.advance ?? font.glyphs['?'].advance), 0) * size / font.unitsPerEm;
}
function lettering(text, x, baseline, size, fill, font, maxWidth = Infinity) {
  const measured = width(text, size, font);
  const scaleX = measured > maxWidth ? maxWidth / measured : 1;
  const scale = size / font.unitsPerEm;
  let cursor = 0, paths = '';
  for (const char of text) {
    const glyph = font.glyphs[char] ?? font.glyphs['?'];
    if (glyph.path) paths += '<path transform="translate(' + cursor + ' 0)" d="' + glyph.path + '"/>';
    cursor += glyph.advance;
  }
  return '<g aria-label="' + xml(text) + '" fill="' + fill + '" transform="translate(' + x + ' ' + baseline + ') scale(' + (scale * scaleX) + ' ' + (-scale) + ')">' + paths + '</g>';
}
const colors = ['#ef498a', '#008ee9', '#d69b00', '#913bd0', '#09a47c'];
const countries = new Intl.DisplayNames(['en'], { type: 'region' });

export function renderBadge(snapshot, state, assets) {
  const available = snapshot !== null;

  const amount = available ? formatCount(snapshot.visits) : '';
  const title = available
    ? 'maimai.party: ' + formatExactCount(snapshot.visits) + ' visits, past 30 days (Cloudflare visits, not unique people)'
    : 'maimai.party: past-30-day visit statistics temporarily unavailable';
  const descriptions = available
    ? snapshot.regions.map(r => countries.of(r.country) + ': ' + formatExactCount(r.visits) + ' visits').join('; ')
    : 'Regional counts are unavailable.';
  const date = available ? snapshot.updatedAt.slice(0, 16).replace('T', ' ') + ' UTC' : '';
  const details = (available ? 'Rolling past 30 days (UTC): ' + snapshot.start + ' to ' + snapshot.updatedAt + '. ' : '') +
    'Cloudflare HTTP traffic analytics visits, not unique people or players. ' +
    'Direct or external-referrer visits; maimai.party only. Known Cloudflare and Tidbyt monitors excluded. May include other automated traffic. ' +
    (available && snapshot.estimated ? 'Cloudflare sampled estimates. ' : '') +
    (state === 'stale' ? 'Cached result; live refresh unavailable. ' : '') +
    (available && snapshot.regions.length < 5 ? 'There are fewer than five measured regions. ' : '') +
    (available ? 'Measured through ' + date + '. ' : '') + descriptions;
  const a = assets.font;
  let main;
  if (available) {
    const lead = '';
    const tail = ' visits, past 30 days';
    const leadW = width(lead, 62, a), countW = width(amount, 92, a), tailW = width(tail, 62, a);
    const totalW = leadW + countW + tailW;
    const fit = Math.min(1, 1045 / totalW);
    main = '<g transform="translate(950 0) scale(' + fit + ' 1)">' +
      lettering(lead, 0, 338, 62, '#293f5c', a) +
      lettering(amount, leadW, 344, 92, '#09aa7d', a) +
      lettering(tail, leadW + countW, 338, 62, '#293f5c', a) + '</g>';
  } else main = lettering('visit stats unavailable', 962, 338, 67, '#526b86', a, 1030);
  let rows = '';
  // Bounds of the five pills in the approved artwork; their widths differ.
  const slots = [[756, 965], [978, 1174], [1189, 1384], [1398, 1610], [1623, 1834]];
  const flagWidth = 54, gap = 12, inset = 20;
  // Fit the whole flag/count pair with padding, keeping every digit proportional.
  const regionSize = available && snapshot.regions.length
    ? Math.min(53, ...snapshot.regions.map((r, i) =>
      53 * (slots[i][1] - slots[i][0] - 2 * inset - flagWidth - gap) / width(formatCount(r.visits), 53, a)))
    : 53;
  const regionBaseline = 507 + 20 * regionSize / 53;
  for (let i = 0; i < 5; i++) {
    const row = available ? snapshot.regions[i] : null;
    const [left, right] = slots[i];
    if (!row) {
      rows += lettering('--', (left + right - width('--', 52, a)) / 2, 526, 52, '#8292a5', a);
      continue;
    }
    const name = countries.of(row.country) || row.country;
    const flag = assets.flags[row.country.toLowerCase()];
    const amount = formatCount(row.visits);
    const x = (left + right - flagWidth - gap - width(amount, regionSize, a)) / 2;
    rows += '<g><title>' + xml(name + ': ' + formatExactCount(row.visits) + ' visits') + '</title>';
    if (flag) rows += '<image x="' + x + '" y="489" width="54" height="36" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,' + flag + '"/>';
    else rows += lettering(row.country, x, 523, 33, '#526b86', a, flagWidth);
    rows += lettering(amount, x + flagWidth + gap, regionBaseline, regionSize, colors[i], a) + '</g>';
  }
  const footer = 'Cloudflare analytics - Updated: ' + (available ? date : 'unavailable');
  const footerWidth = width(footer, 24, a);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="854" height="188" viewBox="20 155 2135 470" role="img" aria-labelledby="title description">' +
    '<title id="title">' + xml(title) + '</title><desc id="description">' + xml(details) + '</desc>' +
    '<rect x="20" y="155" width="2135" height="470" rx="28" fill="#fff"/>' +
    '<image x="0" y="0" width="2172" height="724" href="data:image/png;base64,' + assets.artwork + '"/>' +
    main + rows + lettering(footer, Math.max(100, (2172 - footerWidth) / 2), 610, 24, '#64748b', a, 1980) + '</svg>';
}

