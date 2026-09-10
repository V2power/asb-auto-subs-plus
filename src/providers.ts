// Jimaku supplies filenames, not a normalized provider field. Be conservative.
export function subtitleProvider(name: string): string {
  // Hi10 repacks carry the subtitle group after the quality tag.
  if (/^\(Hi10\)/i.test(name)) {
    const tags = name.match(/\([^()]+\)/g) ?? [];
    const provider = tags.slice(1).map(tag => tag.slice(1, -1)).filter(tag =>
      !/^(?:[a-f0-9]{8}|.*\b(?:\d{3,4}p|BD|DVD|WEB|x26[45]|HEVC)\b.*)$/i.test(tag));
    return provider.length ? provider[provider.length - 1] : "Hi10";
  }
  const prefix = name.match(/^\[([^\]]+)\]/) ?? name.match(/^\(([^)]+)\)/);
  if (prefix) return prefix[1].trim();
  // Streaming sources commonly occur after WEBRip/WEB-DL rather than at the start.
  const streaming = name.match(/(?:^|[. _-])(Amazon|Netflix)(?=[. _-]|$)/i);
  if (streaming) return streaming[1].toLowerCase() === "amazon" ? "Amazon" : "Netflix";
  return "";
}
export function subtitleFormat(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toUpperCase();
}
