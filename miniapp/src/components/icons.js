/**
 * Inline SVG icon set (stroke-based, 1.7px) used across the Mini App cards.
 * Kept as strings so cards can be rendered with a single innerHTML write.
 */
const svg = (paths, { size = 18, extra = '' } = {}) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${paths}</svg>`;

export const ICONS = {
  bolt: svg('<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"/>'),
  copy: svg(
    '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14"/>',
  ),
  check: svg('<path d="m4.5 12.5 5 5 10-11"/>'),
  download: svg(
    '<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5L16.5 10"/><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/>',
  ),
  key: svg(
    '<circle cx="8" cy="8" r="4"/><path d="m11 11 9 9"/><path d="m16.5 16.5 2.5-2.5"/><path d="m19 19 2-2"/>',
  ),
  pencil: svg(
    '<path d="M4 20h4l10.5-10.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z"/><path d="m13.5 7 3.5 3.5"/>',
  ),
  trash: svg(
    '<path d="M4 7h16"/><path d="M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/><path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.5 7"/>',
  ),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', { size: 16 }),
  eye: svg(
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  ),
  eyeOff: svg(
    '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9"/><path d="M6.3 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
  book: svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="M11 4h7.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H11"/>'),
  shield: svg('<path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6l7-3Z"/><path d="m9 12 2 2 4-4"/>'),
  spark: svg('<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6 6 2.5 2.5"/><path d="m15.5 15.5 2.5 2.5"/><path d="m18 6-2.5 2.5"/><path d="m8.5 15.5-2.5 2.5"/>', { size: 15 }),
  code: svg('<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', { size: 16 }),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.6 6.3"/><path d="M20 4.5V11h-6"/>', { size: 16 }),
};

export function icon(name, size) {
  const raw = ICONS[name] || '';
  if (!size) return raw;
  return raw.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
}
