export interface AnimeSite {
  isOnEpSite(url: string): boolean;
  getEpisode(): number | null;
  getAnilistId(): number | null;
  getTitle(): string | null;
}

class hianime implements AnimeSite {
  getTitle(): string | null {
    const titleQuery = "h2.film-name > a";
    let title = document.querySelector(titleQuery)?.textContent;
    if (!title) return null;
    return title;
  }
  isOnEpSite(url: string): boolean {
    const epSiteRegEx = new RegExp(/https:\/\/hianimez?\.to\/watch\/.+\?ep=.+/);
    return epSiteRegEx.test(url);
  }
  getEpisode(): number | null {
    const epQuery = ".ssl-item.ep-item.active";
    let episodeString = document.querySelector(epQuery)?.textContent;
    if (!episodeString) return null;
    return parseInt(episodeString);
  }
  getAnilistId(): number | null {
    const syncDataQuery = "#syncData";
    const syncData = document.querySelector(syncDataQuery)?.textContent;
    if (!syncData) return null;
    return parseInt(JSON.parse(syncData).anilist_id);
  }
}

class Miruro implements AnimeSite {
  getTitle(): string | null {
    // Current Miruro routes contain an opaque site ID followed by the anime slug.
    // Use that route rather than a recommendation card or a stale SPA heading.
    const route = window.location.pathname.match(/^\/watch\/[^/]+\/([^/]+)\/?$/);
    if (route && !/^episode-\d+$/.test(route[1])) {
      try { return decodeURIComponent(route[1]).replace(/-/g, " ").trim() || null; }
      catch { return null; }
    }
    const titleQuery = ".anime-title > a";
    let title = document.querySelector(titleQuery)?.textContent;
    if (!title) return null;
    return title;
  }
  isOnEpSite(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && /^(?:www\.)?miruro\.(tv|online|to|cx)$/.test(parsed.hostname) &&
        /^\/watch\/[^/]+(?:\/[^/]+)?\/?$/.test(parsed.pathname) && this.episodeFromUrl(parsed) !== null;
    } catch { return false; }
  }
  getEpisode(): number | null {
    return this.episodeFromUrl(new URL(window.location.href));
  }
  private episodeFromUrl(url: URL): number | null {
    const episode = url.searchParams.get("ep") ?? url.pathname.match(/\/episode-(\d+)\/?$/)?.[1];
    if (!episode || !/^\d+$/.test(episode)) return null;
    const number = Number(episode);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  getAnilistId(): number | null {
    // Only the legacy, entirely numeric route is an AniList ID. Never parse the
    // numeric prefix of a new opaque ID (5xsd... used to become ID 5).
    const match = window.location.pathname.match(/^\/watch\/([1-9]\d*)(?:\/episode-\d+)?\/?$/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) ? id : null;
  }
}

export const animeSites = new Map<string, AnimeSite>([
  ["hianime.to", new hianime()],
  ["hianimez.to", new hianime()],
  ["miruro.tv", new Miruro()],
  ["miruro.online", new Miruro()],
  ["miruro.to", new Miruro()],
  ["miruro.cx", new Miruro()],
]);
