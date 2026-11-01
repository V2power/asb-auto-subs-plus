import { animeSites } from "./animeSites";
import { AnimeMetaData, JimakuEntry, Subs, AnilistObject } from "./types";
import { SavedSubtitle, saveSubtitleFile, trackSubtitleFile, removeSubtitleFiles } from "./subtitleFiles";

const lastDownloadedKeyPrefix = "lastDownloaded:";
const lastProcessedUrls = new Map<number, string>();
const lastEpisodeKeys = new Map<number, string>();
const navigationRevisions = new Map<number, number>();
const downloadsInProgress = new Set<string>();
const textSubtitleExtensions = new Set([
  ".ass",
  ".srt",
  ".ssa",
  ".vtt",
]);
const asbPlayerBaseUrl = "http://127.0.0.1:8766/asbplayer";
const asbPlayerLogKey = "asbPlayerLog";
const maxAsbPlayerLogEntries = 30;
let asbPlayerLoadQueue = Promise.resolve();

function getTrackedDownloadIds(value: unknown): number[] {
  // Older versions stored a single number. Accept it so existing installs can
  // still remove the subtitle that was downloaded before this upgrade.
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((id): id is number =>
    typeof id === "number" && Number.isSafeInteger(id) && id >= 0,
  ))];
}

const trackedDownloadQueues = new Map<number, Promise<void>>();

async function withTrackedDownloadLock<T>(tabId: number, operation: () => Promise<T>) {
  const previous = trackedDownloadQueues.get(tabId) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  trackedDownloadQueues.set(tabId, settled);
  try {
    return await result;
  } finally {
    if (trackedDownloadQueues.get(tabId) === settled) {
      trackedDownloadQueues.delete(tabId);
    }
  }
}

async function trackDownloadedFile(tabId: number, downloadId: number | SavedSubtitle) {
  return withTrackedDownloadLock(tabId, async () => {
    if (typeof downloadId !== "number") {
      await trackSubtitleFile(tabId, downloadId);
      return;
    }
    const storageKey = `${lastDownloadedKeyPrefix}${tabId}`;
    const stored = await chrome.storage.local.get(storageKey);
    const downloadIds = getTrackedDownloadIds(stored[storageKey]);
    if (downloadIds.indexOf(downloadId) === -1) downloadIds.push(downloadId);
    await chrome.storage.local.set({ [storageKey]: downloadIds });
  });
}

function getAnimeSiteKey(url: string) {
  const baseDomainMatcher = /^(?:https?:\/\/)?(?:www\.)?([^\/:?#]+)/;
  const matches = url.match(baseDomainMatcher);
  if (!matches) {
    return null;
  }
  const animeSiteKey = matches[1];
  const animeSite = animeSites.get(animeSiteKey);
  if (!animeSite) {
    return null;
  }
  if (!animeSite.isOnEpSite(url)) {
    return null;
  }
  return animeSiteKey;
}

async function notifyError(tabId: number, error: string) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "notifyError", error });
  } catch (reason) {
    console.warn("Could not notify the tab", reason);
  }
}

async function getApiKey(): Promise<string | null> {
  const localStorageItem = await chrome.storage.local.get("apiKey");
  if (
    typeof localStorageItem.apiKey === "string" &&
    localStorageItem.apiKey.length > 0
  ) {
    return localStorageItem.apiKey;
  }

  const legacyStorageItem = await chrome.storage.sync.get("apiKey");
  if (
    typeof legacyStorageItem.apiKey !== "string" ||
    legacyStorageItem.apiKey.length === 0
  ) {
    return null;
  }
  await chrome.storage.local.set({ apiKey: legacyStorageItem.apiKey });
  await chrome.storage.sync.remove("apiKey");
  return legacyStorageItem.apiKey;
}

async function fetchAnilistId(title: string) {
  const query = `
  query ($title: String) {
    Page (perPage: 10) {
      media (search: $title, type: ANIME) {
        id
        title { romaji english native }
        synonyms
      }
    }
  }
  `;
  const url = "https://graphql.anilist.co";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: query,
      variables: { title: title },
    }),
  };
  try {
    const anilistResponse = await fetch(url, options);
    if (!anilistResponse.ok) {
      return;
    }
    const anilistObject: AnilistObject = await anilistResponse.json();
    const normalizeTitle = (value: string) => value.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const searchTitle = normalizeTitle(title);
    const matches = anilistObject.data.Page.media.filter(media =>
      Number.isSafeInteger(media.id) && media.id > 0 &&
      [media.title.romaji, media.title.english, media.title.native, ...(media.synonyms ?? [])]
        .some(candidate => typeof candidate === "string" && normalizeTitle(candidate) === searchTitle));
    // Search relevance alone is not proof of identity. Don't download another
    // anime when no title matches, or when the matching title is ambiguous.
    return matches.length === 1 ? matches[0].id : undefined;
  } catch (e) {
    if (typeof e === "string") {
      e.toUpperCase();
    } else if (e instanceof Error) {
      console.error(e.message);
    }
    return;
  }
}

async function getAnilistIdAndEpisode(tabId: number, animeSiteKey: string) {
  let anilistId, episode;
  const animeMetaData: AnimeMetaData = await chrome.tabs.sendMessage(tabId, {
    action: "getAnimeMetaData",
    animeSiteKey,
  });
  if (
    !animeMetaData?.episode ||
    (!animeMetaData.anilistId && !animeMetaData.title)
  ) {
    return null;
  }
  episode = animeMetaData.episode;
  anilistId = animeMetaData.anilistId;
  if (!anilistId) {
    const id = await fetchAnilistId(animeMetaData.title);
    if (!id) return "Failed fetching AnilistId";
    anilistId = id;
  }
  return { anilistId, episode };
}

async function fetchSubs(anilistId: number, episode: number) {
  const jimakuAPIKey = await getApiKey();
  if (!jimakuAPIKey) {
    return "Please configure your Jimaku API key";
  }
  const BASE_URL = "https://jimaku.cc/api";
  const jimakuErrors = new Map([
    [400, "Something went wrong! This shouldn't happen"],
    [401, "Authentification failed. Check your API Key"],
    [404, "Entry not found"],
    [
      429,
      "You downloaded too many subs in a short amount of time. Try again in a short bit",
    ],
  ]);

  try {
    const searchResponse = await fetch(
      `${BASE_URL}/entries/search?anilist_id=${anilistId}`,
      {
        method: "GET",
        headers: {
          Authorization: `${jimakuAPIKey}`,
        },
      },
    );

    await readJimakuRate(searchResponse);
    if (!searchResponse.ok) {
      const error = jimakuErrors.get(searchResponse.status);
      return error ? error : "Something went wrong";
    }
    const jimakuEntry: JimakuEntry[] = await searchResponse.json();
    if (jimakuEntry.length === 0) {
      return `No subs found for this anime`;
    }
    const results = await Promise.all(
      jimakuEntry.map(async (entry) => {
        const filesResponse = await fetch(
          BASE_URL + `/entries/${entry.id}/files?episode=${episode}`,
          {
            method: "GET",
            headers: { Authorization: `${jimakuAPIKey}` },
          },
        );
        await readJimakuRate(filesResponse);
        if (!filesResponse.ok) return [];
        const subs: Subs[] = await filesResponse.json();
        const entryName = entry.name ?? entry.english_name ??
          entry.japanese_name ?? `Entry ${entry.id}`;
        return subs.map((sub) => ({ ...sub, entryName }));
      }),
    );
    const subs = results.reduce(
      (all, entrySubs) => all.concat(entrySubs),
      [] as Array<Subs & { entryName: string }>,
    );
    if (subs.length === 0) {
      return `No subs for episode ${episode} could be found`;
    }
    return subs;
  } catch (e) {
    if (typeof e === "string") {
      e.toUpperCase();
    } else if (e instanceof Error) {
      console.error(e.message);
    }
    return "There was an error";
  }
}

type DownloadableSub = {
  url: string;
  name: string;
  extension: string;
  entryName?: string;
};

type SubtitleChoice = DownloadableSub & {
  entryName: string;
};

type FormattingOptions = {
  removeSpeakerNames: boolean;
  removeFurigana: boolean;
  removeAssTags: boolean;
  removeDecorativeMarkers: boolean;
  joinSubtitleLines: boolean;
};

const formattingOptionIds: Array<keyof FormattingOptions> = [
  "removeSpeakerNames",
  "removeFurigana",
  "removeAssTags",
  "removeDecorativeMarkers",
  "joinSubtitleLines",
];

type AsbPlayerLogEntry = {
  timestamp: string;
  level: "info" | "error";
  message: string;
};

type AsbPlayerMedia = {
  active?: boolean;
  title?: string;
};

async function appendAsbPlayerLog(
  level: AsbPlayerLogEntry["level"],
  message: string,
) {
  const { [asbPlayerLogKey]: existingLog } = await chrome.storage.local.get(
    asbPlayerLogKey,
  );
  const entries = Array.isArray(existingLog) ? existingLog : [];
  const entry: AsbPlayerLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  await chrome.storage.local.set({
    [asbPlayerLogKey]: [...entries, entry].slice(-maxAsbPlayerLogEntries),
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(index, index + chunkSize)),
    );
  }
  return btoa(binary);
}

function textToBase64(text: string) {
  return arrayBufferToBase64(new TextEncoder().encode(text).buffer);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function withAsbPlayerLoadLock<T>(callback: () => Promise<T>) {
  const previousLoad = asbPlayerLoadQueue;
  let releaseLoad = () => {};
  asbPlayerLoadQueue = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });

  await previousLoad;
  try {
    return await callback();
  } finally {
    releaseLoad();
  }
}

async function waitForAsbPlayerMedia(isStillCurrent: () => boolean) {
  const attempts = 15;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!isStillCurrent()) return false;
    try {
      const response = await fetch(`${asbPlayerBaseUrl}/bound-media`);
      if (!response.ok) {
        throw new Error(`asbplayer returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as { media?: AsbPlayerMedia[] };
      const activeMedia = Array.isArray(body.media)
        ? body.media.filter((media) => media.active === true)
        : [];
      await appendAsbPlayerLog(
        "info",
        `Active asbplayer media — attempt ${attempt}/${attempts}: ${activeMedia.length}`,
      );
      if (activeMedia.length > 0) {
        await appendAsbPlayerLog(
          "info",
          `asbplayer media found: ${activeMedia[0].title ?? "untitled"}`,
        );
        return true;
      }
    } catch (reason) {
      const details = reason instanceof Error ? reason.message : String(reason);
      await appendAsbPlayerLog(
        "error",
        `asbplayer check — attempt ${attempt}/${attempts}: ${details}`,
      );
      if (attempt === attempts) throw new Error(details);
    }
    await wait(700);
  }
  throw new Error("asbplayer did not find an active media item in time");
}

async function loadSubtitlesIntoAsbPlayer(
  sub: DownloadableSub,
  formattedContent?: string,
  isStillCurrent: () => boolean = () => true,
) {
  let base64: string;
  if (typeof formattedContent === "string") {
    base64 = textToBase64(formattedContent);
  } else {
    const subtitleResponse = await fetch(sub.url);
    if (!subtitleResponse.ok) {
      throw new Error(`Could not read subtitle file (${subtitleResponse.status})`);
    }
    base64 = arrayBufferToBase64(await subtitleResponse.arrayBuffer());
  }
  return withAsbPlayerLoadLock(async () => {
    if (!isStillCurrent()) return false;
    const mediaReady = await waitForAsbPlayerMedia(isStillCurrent);
    if (!mediaReady || !isStillCurrent()) return false;

    const response = await fetch(`${asbPlayerBaseUrl}/load-subtitles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ name: sub.name, base64 }],
      }),
    });
    const responseText = await response.text();
    await appendAsbPlayerLog(
      "info",
      `asbplayer load-subtitles response HTTP ${response.status}: ${responseText.slice(0, 500) || "(empty response)"}`,
    );
    if (!response.ok) {
      throw new Error(`asbplayer returned HTTP ${response.status}`);
    }
    return true;
  });
}

async function getFormattingOptions(): Promise<FormattingOptions | null> {
  const settings = await chrome.storage.sync.get([
    "formatSubtitles",
    ...formattingOptionIds,
  ]);
  // Users upgrading from the earlier formatter did not have these keys saved.
  // Keep its default: format unless the user explicitly turns an option off.
  if (settings.formatSubtitles === false) return null;
  return formattingOptionIds.reduce((options, option) => {
    options[option] = settings[option] !== false;
    return options;
  }, {} as FormattingOptions);
}

function cleanSubtitleText(
  source: string,
  filename: string,
  options: FormattingOptions,
) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/\.(ass|ssa)$/i.test(filename)) return cleanAss(normalized, options);
  return cleanCaptionBlocks(normalized, options);
}

function cleanCaptionBlocks(source: string, options: FormattingOptions) {
  // A blank line can also occur inside the text of a cue. Only split when the
  // next non-empty lines start a new timed cue; otherwise the text after the
  // blank line would be treated as an orphan block and never cleaned/joined.
  const blocks = source
    .trim()
    .split(
      /\n{2,}(?=\s*(?:\d+\s*\n\s*)?(?:\d{2}:\d{2}:\d{2}[,.]\d{2,3}\s*-->))/,
    );
  const cleaned = blocks.map((block) => {
    const lines = block.split("\n");
    const timingLine = lines.findIndex(
      (line) =>
        line.includes("-->") ||
        /^\d{2}:\d{2}:\d{2}[,.]\d{2}\s*,\s*\d{2}:\d{2}:\d{2}[,.]\d{2}/.test(
          line,
        ),
    );
    if (timingLine === -1 || timingLine === lines.length - 1) return block;
    const prefix = lines.slice(0, timingLine + 1);
    const text = cleanLines(
      lines.slice(timingLine + 1),
      options,
      options.joinSubtitleLines ? "" : "\n",
    );
    return text ? [...prefix, text].join("\n") : prefix.join("\n");
  });
  return `${cleaned.join("\r\n\r\n")}\r\n`;
}

function cleanAss(source: string, options: FormattingOptions) {
  const cleaned: string[] = [];
  let previousDialogue:
    | { prefix: string; start: string; end: string; text: string }
    | undefined;

  const flushPreviousDialogue = () => {
    if (!previousDialogue) return;
    cleaned.push(`${previousDialogue.prefix}${previousDialogue.text}`);
    previousDialogue = undefined;
  };

  for (const line of source.split("\n")) {
    const match = line.match(/^(Dialogue:\s*(?:[^,]*,){9})(.*)$/i);
    if (!match) {
      flushPreviousDialogue();
      cleaned.push(line);
      continue;
    }

    const timing = match[1].match(/^Dialogue:\s*[^,]*,([^,]*),([^,]*),/i);
    const text = cleanLines(
      match[2].split(/\\[Nn]/),
      options,
      options.joinSubtitleLines ? "" : "\\N",
    );

    // Some ASS files represent wrapped caption text as consecutive Dialogue
    // records with identical start/end times. Merge those records into one
    // cue when the formatting option is enabled.
    if (
      options.joinSubtitleLines &&
      timing &&
      previousDialogue &&
      previousDialogue.start === timing[1] &&
      previousDialogue.end === timing[2]
    ) {
      previousDialogue.text += text;
      continue;
    }

    flushPreviousDialogue();
    if (timing) {
      previousDialogue = {
        prefix: match[1],
        start: timing[1],
        end: timing[2],
        text,
      };
    } else {
      cleaned.push(`${match[1]}${text}`);
    }
  }
  flushPreviousDialogue();
  return cleaned.join("\r\n");
}

function cleanLines(
  lines: string[],
  options: FormattingOptions,
  separator: string,
) {
  return lines
    .map((line) => cleanCaptionLine(line, options))
    .filter(Boolean)
    .join(separator);
}

function cleanCaptionLine(line: string, options: FormattingOptions) {
  let cleaned = line;
  if (options.removeAssTags) cleaned = cleaned.replace(/\{[^}]*\}/g, "");
  if (options.removeSpeakerNames) cleaned = cleaned.replace(/^（[^）]*）\s*/, "");
  if (options.removeFurigana) {
    cleaned = cleaned.replace(
      /([一-龯々〆ヵヶ]+)[(（][ぁ-ゖゝゞァ-ヺー]+[)）]/g,
      "$1",
    );
  }
  if (options.removeDecorativeMarkers) cleaned = cleaned.replace(/[＜＞➨➡]/g, "");
  return cleaned.trim();
}

function subtitleMimeType(filename: string) {
  if (/\.srt$/i.test(filename)) return "application/x-subrip;charset=utf-8";
  if (/\.(ass|ssa)$/i.test(filename)) return "text/x-ssa;charset=utf-8";
  if (/\.vtt$/i.test(filename)) return "text/vtt;charset=utf-8";
  return "text/plain;charset=utf-8";
}

async function prepareFormattedSubtitle(
  sub: DownloadableSub,
  options: FormattingOptions | null,
) {
  if (!options || !textSubtitleExtensions.has(sub.extension)) return null;
  const response = await fetch(sub.url);
  if (!response.ok) {
    throw new Error(`Could not read subtitle file (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Never corrupt legacy-encoded files; download the original instead.
    return null;
  }
  return cleanSubtitleText(source, sub.name, options);
}

async function downloadFormattedSubtitle(
  filename: string,
  content: string,
): Promise<number | SavedSubtitle> {
  if (!usesBrowserDownloads()) {
    return saveSubtitleFile(filename, new TextEncoder().encode(content).buffer);
  }
  const mimeType = subtitleMimeType(filename);
  const url = `data:${mimeType};base64,${textToBase64(content)}`;
  return startBrowserDownload(url, filename);
}

async function createAsbPlayerDiagnostic() {
  const { [asbPlayerLogKey]: existingLog } = await chrome.storage.local.get(
    asbPlayerLogKey,
  );
  const entries: AsbPlayerLogEntry[] = Array.isArray(existingLog)
    ? existingLog
    : [];
  const lines = [
    `asb auto subs ${chrome.runtime.getManifest().version}`,
    `Generated: ${new Date().toISOString()}`,
  ];
  try {
    const response = await fetch(`${asbPlayerBaseUrl}/bound-media`);
    const responseBody = (await response.text()).slice(0, 6000);
    lines.push(`asbplayer endpoint: HTTP ${response.status}`);
    lines.push(`Bound media: ${responseBody || "(empty response)"}`);
  } catch (reason) {
    const details = reason instanceof Error ? reason.message : String(reason);
    lines.push(`asbplayer endpoint: unavailable (${details})`);
  }
  lines.push("Recent auto-load events:");
  if (entries.length === 0) {
    lines.push("(none)");
  } else {
    entries.forEach((entry) => {
      lines.push(`[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`);
    });
  }
  return lines.join("\n");
}

function validateSub(sub: Subs): DownloadableSub | null {
  let url: URL;
  try {
    url = new URL(sub.url);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "jimaku.cc" && !url.hostname.endsWith(".jimaku.cc"))
  ) {
    return null;
  }

  const name = sub.name.replace(/\\/g, "/").split("/").pop()?.trim();
  if (!name || name === "." || name === "..") return null;
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!textSubtitleExtensions.has(extension)) return null;
  const entryName = typeof (sub as Subs & { entryName?: string }).entryName === "string"
    ? (sub as Subs & { entryName?: string }).entryName : undefined;
  return { url: url.toString(), name, extension, entryName };
}

function usesBrowserDownloads() {
  return !!(globalThis as typeof globalThis & {
    browser?: { runtime?: { getBrowserInfo?: unknown } };
  }).browser?.runtime?.getBrowserInfo;
}
function startBrowserDownload(url: string, filename: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else if (typeof downloadId !== "number" ||
          !Number.isSafeInteger(downloadId) || downloadId < 0) {
          reject(new Error("The browser did not return a download ID"));
        } else {
          resolve(downloadId);
        }
      },
    );
  });
}

async function downloadOriginalTextSubtitle(sub: DownloadableSub): Promise<number | SavedSubtitle> {
  const response = await fetch(sub.url);
  if (!response.ok) {
    throw new Error(`Could not read subtitle file (${response.status})`);
  }

  const bytes = await response.arrayBuffer();
  if (!usesBrowserDownloads()) return saveSubtitleFile(sub.name, bytes);
  const base64 = arrayBufferToBase64(bytes);
  const mimeType = subtitleMimeType(sub.name);
  const url = `data:${mimeType};base64,${base64}`;
  return startBrowserDownload(url, sub.name);
}

async function downloadSub(
  tabId: number,
  selectedSub: DownloadableSub,
  isStillCurrent: () => boolean = () => true,
) {

  try {
    if (!textSubtitleExtensions.has(selectedSub.extension)) throw new Error("Unsupported subtitle");
    const formattingOptions = await getFormattingOptions();
    const formattedContent = await prepareFormattedSubtitle(
      selectedSub,
      formattingOptions,
    );
    if (!isStillCurrent()) return null;
    const filename = selectedSub.entryName
      ? `${safeAnimeFolder(selectedSub.entryName)}/${selectedSub.name}` : selectedSub.name;
    const downloadId = typeof formattedContent === "string"
      ? await downloadFormattedSubtitle(filename, formattedContent)
      : await downloadOriginalTextSubtitle({ ...selectedSub, name: filename });
    await trackDownloadedFile(tabId, downloadId);

    const { asbplayerAutoLoad } = await chrome.storage.sync.get(
      "asbplayerAutoLoad",
    );
    if (asbplayerAutoLoad !== true) {
      return { asbPlayerLoaded: false, name: selectedSub.name };
    }
    try {
      const loaded = await loadSubtitlesIntoAsbPlayer(
        selectedSub,
        formattedContent ?? undefined,
        isStillCurrent,
      );
      if (!loaded) {
        await appendAsbPlayerLog(
          "info",
          `Skipped stale asbplayer load: ${selectedSub.name}`,
        );
        return { asbPlayerLoaded: false, name: selectedSub.name };
      }
      await appendAsbPlayerLog(
        "info",
        `Loaded ${selectedSub.name} into asbplayer`,
      );
      return { asbPlayerLoaded: true, name: selectedSub.name };
    } catch (reason) {
      const details = reason instanceof Error ? reason.message : String(reason);
      const message = `Downloaded ${selectedSub.name}, but asbplayer auto-load failed: ${details}`;
      await appendAsbPlayerLog("error", message);
      return message;
    }
  } catch (reason) {
    console.error("Subtitle download failed", reason);
    return reason instanceof Error ? reason.message : "The subtitle download failed";
  }
}

async function chooseAndDownloadSubs(
  tabId: number,
  anilistId: number,
  episode: number,
  isStillCurrent: () => boolean,
) {
  const subs = await fetchSubs(anilistId, episode);
  if (!isStillCurrent()) return null;
  if (typeof subs === "string") return subs;

  const choices = subs
    .map((sub) => {
      const validSub = validateSub(sub);
      return validSub ? { ...validSub, entryName: sub.entryName } : null;
    })
    .filter((sub): sub is SubtitleChoice => sub !== null);
  if (choices.length === 0) return "The API returned no supported subtitle file";

  if (choices.length === 1) {
    return downloadSub(tabId, choices[0], isStillCurrent);
  }

  await chrome.tabs.sendMessage(tabId, {
    action: "showSubtitlePicker",
    choices,
    anilistId,
    episode,
  });
  return null;
}

function promiseDownloadApi() {
  // Firefox exposes Promise APIs through browser.*, while Chrome's callback
  // APIs require reading runtime.lastError inside the callback itself.
  return (globalThis as typeof globalThis & {
    browser?: {
      downloads: {
        search(query: chrome.downloads.DownloadQuery): Promise<chrome.downloads.DownloadItem[]>;
        removeFile(downloadId: number): Promise<void>;
      };
    };
  }).browser?.downloads;
}

function callDownloadApi<T>(
  invoke: (callback: (result: T) => void) => void | Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const result = invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? "Download operation failed"));
      else resolve(value);
    });
    // Some browser wrappers return a Promise even when given a callback.
    // Handle its rejection too, so neither API style can leave an error unchecked.
    if (result && typeof result.then === "function") result.then(resolve, reject);
  });
}

async function findTrackedDownload(downloadId: number) {
  const promiseApi = promiseDownloadApi();
  const downloads = promiseApi
    ? await promiseApi.search({ id: downloadId })
    : await callDownloadApi<chrome.downloads.DownloadItem[]>((callback) =>
      chrome.downloads.search({ id: downloadId }, callback),
    );
  return downloads.find((download) => download.id === downloadId);
}

function isOwnExistingDownload(
  download: chrome.downloads.DownloadItem | undefined,
): download is chrome.downloads.DownloadItem {
  return download !== undefined && download.exists !== false &&
    (!download.byExtensionId || download.byExtensionId === chrome.runtime.id);
}

async function removeTrackedDownloadFile(downloadId: number) {
  const promiseApi = promiseDownloadApi();
  if (promiseApi) return promiseApi.removeFile(downloadId);
  return callDownloadApi<void>((callback) =>
    chrome.downloads.removeFile(downloadId, () => callback(undefined)),
  );
}

async function removeLastDownloaded(tabId: number) {
  return withTrackedDownloadLock(tabId, async () => {
    const autoDelete = (await chrome.storage.sync.get("autoDelete")).autoDelete;
    if (!autoDelete) return;
    // Old browser downloads and new directly saved files have separate ownership.
    if (!usesBrowserDownloads()) await removeSubtitleFiles(tabId);
    const storageKey = `${lastDownloadedKeyPrefix}${tabId}`;
    const stored = await chrome.storage.local.get(storageKey);
    if (!Object.prototype.hasOwnProperty.call(stored, storageKey)) return;
    const downloadIds = getTrackedDownloadIds(stored[storageKey]);

    const failedDownloadIds: number[] = [];
    for (const downloadId of downloadIds) {
      try {
        const download = await findTrackedDownload(downloadId);
        // Old IDs may no longer be in browser history, or may refer to a file
        // already removed. Never remove a download initiated by another extension.
        if (!isOwnExistingDownload(download)) continue;
        if (download.state !== "complete") {
          failedDownloadIds.push(downloadId);
          continue;
        }
        await removeTrackedDownloadFile(downloadId);
      } catch (reason) {
        // A file/history entry can disappear after the first search. Recheck
        // state rather than matching browser error messages, which can change.
        try {
          if (!isOwnExistingDownload(await findTrackedDownload(downloadId))) continue;
        } catch {
          // An unavailable search cannot prove that deletion is unnecessary.
        }
        // Real deletion failures remain tracked for the next cleanup attempt.
        failedDownloadIds.push(downloadId);
        console.warn("Could not remove a previous subtitle", reason);
      }
    }

    if (failedDownloadIds.length > 0) {
      await chrome.storage.local.set({ [storageKey]: failedDownloadIds });
    } else {
      await chrome.storage.local.remove(storageKey);
    }
  });
}

type NavigationDetails = {
  tabId: number;
  frameId: number;
  url: string;
};

function isMissingTabError(reason: unknown) {
  return (
    reason instanceof Error &&
    /\bNo tab with id\b/i.test(reason.message)
  );
}

async function processNavigation(details: NavigationDetails) {
  if (details.frameId !== 0) return;
  try {
    const tab = await chrome.tabs.get(details.tabId);
    const url = tab.url ?? details.url;
    if (lastProcessedUrls.get(details.tabId) === url) return;
    lastProcessedUrls.set(details.tabId, url);
    const navigationRevision = (navigationRevisions.get(details.tabId) ?? 0) + 1;
    navigationRevisions.set(details.tabId, navigationRevision);
    const isStillCurrent = () =>
      navigationRevisions.get(details.tabId) === navigationRevision;
    const animeSiteKey = getAnimeSiteKey(url);
    if (!animeSiteKey) return;
    await chrome.scripting.insertCSS({
      target: { tabId: details.tabId },
      files: ["css/index.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ["dist/injectScript.js"],
    });

    const apiKey = await getApiKey();
    if (!apiKey) {
      await notifyError(
        details.tabId,
        "Please get your jimaku API Key from https://jimaku.cc/ and set it by clicking the extension icon",
      );
      return;
    }

    const idAndEp = await getAnilistIdAndEpisode(details.tabId, animeSiteKey);
    if (!isStillCurrent()) return;
    if (!idAndEp) return;
    if (typeof idAndEp === "string") {
      notifyError(details.tabId, idAndEp);
      return;
    }
    const { anilistId, episode } = idAndEp;
    const episodeKey = `${anilistId}_${episode}`;
    const previousEpisodeKey = lastEpisodeKeys.get(details.tabId);
    lastEpisodeKeys.set(details.tabId, episodeKey);
    if (previousEpisodeKey && previousEpisodeKey !== episodeKey) {
      await removeLastDownloaded(details.tabId);
    }
    if (!isStillCurrent()) return;
    const downloadKey = `${details.tabId}:${navigationRevision}:${episodeKey}`;
    if (downloadsInProgress.has(downloadKey)) return;
    downloadsInProgress.add(downloadKey);
    try {
      const result = await chooseAndDownloadSubs(
        details.tabId,
        anilistId,
        episode,
        isStillCurrent,
      );
      if (!isStillCurrent()) return;
      if (result === null) return;
      if (typeof result === "string") {
        await notifyError(details.tabId, result);
      } else {
        const message = result.asbPlayerLoaded
          ? `Downloaded and loaded ${result.name} into asbplayer`
          : `Successfully downloaded ${result.name}`;
        await chrome.tabs.sendMessage(details.tabId, {
          action: "notifySuccess",
          message,
        });
      }
    } finally {
      downloadsInProgress.delete(downloadKey);
    }
  } catch (reason) {
    // Navigation events can remain queued after their tab has been closed.
    // This is an expected cancellation, not a navigation failure.
    if (isMissingTabError(reason)) {
      lastProcessedUrls.delete(details.tabId);
      lastEpisodeKeys.delete(details.tabId);
      navigationRevisions.delete(details.tabId);
      return;
    }
    console.error("Could not process navigation", reason);
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void processNavigation(details);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    lastProcessedUrls.delete(tabId);
    navigationRevisions.set(tabId, (navigationRevisions.get(tabId) ?? 0) + 1);
    return;
  }
  if (changeInfo.status !== "complete" || !tab.url) return;
  void processNavigation({ tabId, frameId: 0, url: tab.url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastProcessedUrls.delete(tabId);
  lastEpisodeKeys.delete(tabId);
  navigationRevisions.delete(tabId);
  void removeLastDownloaded(tabId).catch(reason => console.warn("Could not clean subtitles for closed tab", reason));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getAsbPlayerDiagnostic") {
    void createAsbPlayerDiagnostic()
      .then((diagnostic) => sendResponse({ diagnostic }))
      .catch((reason) => {
        const details = reason instanceof Error ? reason.message : String(reason);
        sendResponse({ error: details });
      });
    return true;
  }
  if (message.action !== "downloadSubtitleChoice") return;

  const tabId = sender.tab?.id;
  const choice = validateSub(message.choice as Subs);
  if (tabId === undefined || !choice ||
    !Number.isSafeInteger(message.anilistId) ||
    !Number.isSafeInteger(message.episode)) {
    sendResponse({ error: "Invalid subtitle choice" });
    return;
  }
  const episodeKey = `${message.anilistId}_${message.episode}`;
  const isStillCurrent = () => lastEpisodeKeys.get(tabId) === episodeKey;
  void downloadSub(tabId, choice, isStillCurrent)
    .then((result) => {
      if (typeof result === "string") {
        return notifyError(tabId, result).then(() => sendResponse({ error: result }));
      }
      if (result === null) { sendResponse({ skipped: true }); return; }
      const message = result.asbPlayerLoaded
        ? `Downloaded and loaded ${result.name} into asbplayer`
        : `Successfully downloaded ${result.name}`;
      return chrome.tabs.sendMessage(tabId, { action: "notifySuccess", message })
        .then(() => sendResponse({ ok: true }));
    })
    .catch((reason) => {
      console.error("Could not download selected subtitle", reason);
      void notifyError(tabId, "The subtitle download failed");
      sendResponse({ error: "The subtitle download failed" });
    });
  return true;
});

// Manual operations never participate in per-tab episode tracking or auto-delete.
// Header meanings: https://jimaku.cc/api/docs#description/rate-limits
let jimakuRate: { remaining?: number; resetAt?: number; blockedUntil?: number } = {};
let manualRequestQueue: Promise<unknown> = Promise.resolve();
let lastManualRequestAt = 0;
const manualCachePending = new Map<string, Promise<unknown>>();
const manualCache = new Map<string, { expires: number; value: unknown }>();

function rateLimitError(retryAt: number) {
  return Object.assign(new Error(`Jimaku: limite de requisições / rate limit. Aguarde até / wait until ${new Date(retryAt).toLocaleTimeString()}.`), { retryAt });
}

async function readJimakuRate(response: Response) {
  const header = (name: string) => {
    const raw = response.headers?.get(name);
    return raw != null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  };
  const remaining = header("x-ratelimit-remaining");
  const resetAfter = header("x-ratelimit-reset-after");
  const reset = header("x-ratelimit-reset");
  const retry = response.headers?.get("retry-after");
  const retryAt = retry ? (Number.isFinite(Number(retry)) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : undefined;
  const resetAt = resetAfter !== undefined ? Date.now() + resetAfter * 1000 : reset !== undefined ? reset * 1000 : undefined;
  if (remaining !== undefined) jimakuRate = { ...jimakuRate, remaining, resetAt };
  if (response.status === 429 || remaining === 0) {
    jimakuRate.blockedUntil = Math.max(jimakuRate.blockedUntil ?? 0, resetAt ?? 0, retryAt && Number.isFinite(retryAt) ? retryAt : 0, Date.now() + 1000);
    if (resetAt === undefined && !retryAt) jimakuRate.blockedUntil = Date.now() + 60000;
  }
  if (remaining !== undefined || response.status === 429) {
    await chrome.storage.local.set({ manualJimakuRate: jimakuRate });
  }
}

function manualRateStatus() {
  if (jimakuRate.resetAt && jimakuRate.resetAt <= Date.now()) {
    return { ...jimakuRate, remaining: undefined };
  }
  return jimakuRate;
}

async function manualJimakuFetch(url: string, init?: RequestInit): Promise<Response> {
  const operation = manualRequestQueue.then(async () => {
    const stored = await chrome.storage.local.get("manualJimakuRate");
    if (stored.manualJimakuRate) jimakuRate = stored.manualJimakuRate;
    if ((jimakuRate.blockedUntil ?? 0) > Date.now()) throw rateLimitError(jimakuRate.blockedUntil!);
    const delay = Math.max(0, lastManualRequestAt + 1200 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastManualRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      await readJimakuRate(response);
      if (response.status === 429) throw rateLimitError(jimakuRate.blockedUntil!);
      if (!response.ok) throw new Error(`Jimaku HTTP ${response.status}`);
      // Consume inside the timeout; callers still use the standard Response API.
      const bytes = await response.arrayBuffer();
      return new Response(bytes, { status: response.status, headers: response.headers });
    } finally { clearTimeout(timeout); }
  });
  manualRequestQueue = operation.catch(() => undefined);
  return operation;
}

async function manualJimakuRequest(path: string) {
  const key = await getApiKey();
  if (!key) throw new Error("Configure a chave Jimaku / Configure your Jimaku API key");
  const cacheKey = `${key}:${path}`;
  const cached = manualCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = manualCachePending.get(cacheKey);
  if (pending) return pending;
  const request = (async () => {
    const response = await manualJimakuFetch(`https://jimaku.cc/api${path}`, { headers: { Authorization: key } });
    const value = await response.json();
    if (manualCache.size >= 30) manualCache.delete(manualCache.keys().next().value!);
    manualCache.set(cacheKey, { expires: Date.now() + 5 * 60000, value });
    return value;
  })();
  manualCachePending.set(cacheKey, request);
  try { return await request; }
  finally { manualCachePending.delete(cacheKey); }
}

async function manualFormattingOptions(): Promise<FormattingOptions> {
  const settings = await chrome.storage.sync.get(formattingOptionIds);
  return formattingOptionIds.reduce((options, key) => {
    options[key] = settings[key] !== false;
    return options;
  }, {} as FormattingOptions);
}

function decodeManualSubtitle(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Codificação incompatível: converta para UTF-8 / Unsupported encoding: convert to UTF-8");
  }
}

function safeAnimeFolder(title: string): string {
  const cleaned = title.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
    .trim().slice(0, 100).replace(/[. ]+$/g, "");
  if (!cleaned) return "Anime";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}

async function handleManualRequest(message: any) {
  if (message.action === "manualSearch") {
    if (typeof message.query !== "string" || !message.query.trim() || message.query.length > 200) throw new Error("Invalid search");
    return { entries: await manualJimakuRequest(`/entries/search?query=${encodeURIComponent(message.query.trim())}&anime=true`) };
  }
  if (message.action === "manualFiles") {
    if (!Number.isSafeInteger(message.entryId) || message.entryId <= 0) throw new Error("Invalid entry");
    const files: Subs[] = await manualJimakuRequest(`/entries/${message.entryId}/files`);
    return { files: files.filter((file) => {
      const sub = validateSub(file);
      return sub && textSubtitleExtensions.has(sub.extension);
    }) };
  }
  if (message.action === "manualLocal" && (typeof message.animeName !== "string" || !message.animeName.trim())) {
    throw new Error("Informe o nome do anime / Enter the anime name");
  }
  let name: string;
  let bytes: Uint8Array;
  const maxBytes = 20 * 1024 * 1024;
  if (message.action === "manualDownload") {
    if (!message.file || typeof message.file.name !== "string") throw new Error("Invalid file");
    const sub = validateSub(message.file);
    if (!sub || !textSubtitleExtensions.has(sub.extension)) throw new Error("Unsupported subtitle");
    const response = await manualJimakuFetch(sub.url);
    bytes = new Uint8Array(await response.arrayBuffer());
    name = sub.name;
  } else {
    if (typeof message.name !== "string" || typeof message.base64 !== "string" || message.base64.length > Math.ceil(maxBytes / 3) * 4) throw new Error("Invalid file / Maximum 20 MB");
    name = message.name.replace(/\\/g, "/").split("/").pop()!;
    if (!/\.(srt|ass|ssa|vtt)$/i.test(name)) throw new Error("Unsupported subtitle");
    bytes = Uint8Array.from(atob(message.base64), (char) => char.charCodeAt(0));
  }
  if (bytes.byteLength > maxBytes) throw new Error("Maximum 20 MB");
  const content = cleanSubtitleText(decodeManualSubtitle(bytes), name, await manualFormattingOptions());
  const folder = message.action === "manualLocal" ? safeAnimeFolder(message.animeName)
    : typeof message.batchFolder === "string" ? safeAnimeFolder(message.batchFolder) : undefined;
  const filename = folder ? `${folder}/${name}` : name;
  const downloadId = await downloadFormattedSubtitle(filename, content);
  return typeof downloadId === "number" ? { downloadId, filename }
    : { saved: true, filename: downloadId.filename };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (["manualSearch", "manualFiles", "manualDownload", "manualLocal"].indexOf(message?.action) === -1) return;
  // Only extension pages may invoke manual file operations.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL("html/popup.html"))) return;
  void handleManualRequest(message).then(result => sendResponse({ ...result, rate: manualRateStatus() })).catch((reason) => {
    sendResponse({ error: reason instanceof Error ? reason.message : String(reason), retryAt: reason?.retryAt, rate: manualRateStatus() });
  });
  return true;
});
