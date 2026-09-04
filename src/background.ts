import { animeSites } from "./animeSites";
import { AnimeMetaData, JimakuEntry, Subs, AnilistObject } from "./types";

const lastDownloadedKeyPrefix = "lastDownloaded:";
const downloadedRangeKeyPrefix = "downloadedRange:";
const lastProcessedUrls = new Map<number, string>();
const lastEpisodeKeys = new Map<number, string>();
const downloadsInProgress = new Set<string>();
const pendingDownloadFilenames = new Map<string, string>();
const supportedFileExtensions = new Set([
  ".ass",
  ".srt",
  ".ssa",
  ".vtt",
  ".zip",
  ".rar",
  ".7z",
]);
const compressedFileExtensions = new Set([".zip", ".rar", ".7z"]);
const textSubtitleExtensions = new Set([".ass", ".srt", ".ssa", ".vtt"]);
const asbPlayerBaseUrl = "http://127.0.0.1:8766/asbplayer";
const asbPlayerLogKey = "asbPlayerLog";
const maxAsbPlayerLogEntries = 30;

function getTrackedDownloadIds(value: unknown): number[] {
  // Older versions stored a single number. Accept it so existing installs can
  // still remove the subtitle that was downloaded before this upgrade.
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter((id): id is number => typeof id === "number"))];
}

async function trackDownloadedFile(tabId: number, downloadId: number) {
  const storageKey = `${lastDownloadedKeyPrefix}${tabId}`;
  const stored = await chrome.storage.local.get(storageKey);
  const downloadIds = getTrackedDownloadIds(stored[storageKey]);
  if (downloadIds.indexOf(downloadId) === -1) downloadIds.push(downloadId);
  await chrome.storage.local.set({ [storageKey]: downloadIds });
}

async function alreadyDownloaded(id: number, episode: number) {
  const key = `${downloadedRangeKeyPrefix}${id}_${episode}`;
  const result = await chrome.storage.local.get([key]);
  return Object.prototype.hasOwnProperty.call(result, key);
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
    Media (search: $title, type: ANIME) {
      id
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
    return anilistObject.data.Media.id;
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
  console.table(animeMetaData);
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

    if (!searchResponse.ok) {
      const error = jimakuErrors.get(searchResponse.status);
      return error ? error : "Something went wrong";
    }
    const jimakuEntry: JimakuEntry[] = await searchResponse.json();
    if (jimakuEntry.length === 0) {
      return `No subs found for this anime`;
    }
    const id = jimakuEntry[0].id;
    const filesResponse = await fetch(
      BASE_URL + `/entries/${id}/files?episode=${episode}`,
      {
        method: "GET",
        headers: {
          Authorization: `${jimakuAPIKey}`,
        },
      },
    );
    if (!filesResponse.ok) {
      const error = jimakuErrors.get(filesResponse.status);
      return error ? error : "Something went wrong";
    }
    const subs: Subs[] = await filesResponse.json();
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

async function markMultipleAsDownloaded(filename: string, anilistId: number) {
  const rangePattern = /\d+[-~]\d+/;
  const match = filename.match(rangePattern);
  if (!match) return;
  const episodeRange = match[0];
  let episodes;
  if (episodeRange.includes("-")) {
    episodes = episodeRange.split("-").map((episode) => parseInt(episode));
  } else {
    episodes = episodeRange.split("~").map((episode) => parseInt(episode));
  }
  if (!Number.isSafeInteger(episodes[0]) || !Number.isSafeInteger(episodes[1])) {
    return;
  }
  for (let i = episodes[0]; i <= episodes[1]; i++) {
    const key = `${downloadedRangeKeyPrefix}${anilistId}_${i}`;
    await chrome.storage.local.set({ [key]: true });
  }
}

type DownloadableSub = {
  url: string;
  name: string;
  extension: string;
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

type DownloadResult = {
  asbPlayerLoaded: boolean;
  name: string;
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

async function waitForAsbPlayerMedia() {
  const attempts = 12;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
        return;
      }
    } catch (reason) {
      const details = reason instanceof Error ? reason.message : String(reason);
      await appendAsbPlayerLog(
        "error",
        `asbplayer check — attempt ${attempt}/${attempts}: ${details}`,
      );
      if (attempt === attempts) throw new Error(details);
    }
    await wait(1500);
  }
  throw new Error("asbplayer did not find an active media item in time");
}

async function loadSubtitlesIntoAsbPlayer(
  sub: DownloadableSub,
  formattedContent?: string,
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
  await waitForAsbPlayerMedia();
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
): Promise<number> {
  const mimeType = subtitleMimeType(filename);
  const url = `data:${mimeType};base64,${textToBase64(content)}`;
  return startDownload(url, filename);
}

async function createAsbPlayerDiagnostic() {
  const { [asbPlayerLogKey]: existingLog } = await chrome.storage.local.get(
    asbPlayerLogKey,
  );
  const entries: AsbPlayerLogEntry[] = Array.isArray(existingLog)
    ? existingLog
    : [];
  const lines = [
    `ASB Auto Subs ${chrome.runtime.getManifest().version}`,
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
  if (!supportedFileExtensions.has(extension)) return null;
  return { url: url.toString(), name, extension };
}

function startDownload(url: string, filename: string): Promise<number> {
  return new Promise((resolve, reject) => {
    pendingDownloadFilenames.set(url, filename);
    chrome.downloads.download(
      { url, filename, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          pendingDownloadFilenames.delete(url);
          reject(new Error(error.message));
        } else if (typeof downloadId !== "number") {
          pendingDownloadFilenames.delete(url);
          reject(new Error("The browser did not return a download ID"));
        } else {
          resolve(downloadId);
        }
      },
    );
  });
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const filename = pendingDownloadFilenames.get(downloadItem.url) ??
    pendingDownloadFilenames.get(downloadItem.finalUrl);
  if (!filename) {
    suggest();
    return;
  }

  pendingDownloadFilenames.delete(downloadItem.url);
  pendingDownloadFilenames.delete(downloadItem.finalUrl);
  suggest({ filename, conflictAction: "uniquify" });
});

async function downloadOriginalTextSubtitle(sub: DownloadableSub): Promise<number> {
  const response = await fetch(sub.url);
  if (!response.ok) {
    throw new Error(`Could not read subtitle file (${response.status})`);
  }

  // Fetching the bytes ourselves prevents Jimaku's Content-Disposition header
  // ("download") from replacing the filename supplied by its API.
  const base64 = arrayBufferToBase64(await response.arrayBuffer());
  const mimeType = subtitleMimeType(sub.name);
  const url = `data:${mimeType};base64,${base64}`;
  return startDownload(url, sub.name);
}

async function downloadSubs(tabId: number, anilistId: number, episode: number) {
  const subs = await fetchSubs(anilistId, episode);
  if (typeof subs === "string") {
    return subs;
  }

  const validSubs = subs
    .map(validateSub)
    .filter((sub): sub is DownloadableSub => sub !== null);
  const selectedSub =
    validSubs.find((sub) => !compressedFileExtensions.has(sub.extension)) ??
    validSubs[0];
  if (!selectedSub) return "The API returned no supported subtitle file";

  try {
    const formattingOptions = await getFormattingOptions();
    const formattedContent = await prepareFormattedSubtitle(
      selectedSub,
      formattingOptions,
    );
    const downloadId = typeof formattedContent === "string"
      ? await downloadFormattedSubtitle(selectedSub.name, formattedContent)
      : textSubtitleExtensions.has(selectedSub.extension)
        ? await downloadOriginalTextSubtitle(selectedSub)
        : await startDownload(selectedSub.url, selectedSub.name);
    if (compressedFileExtensions.has(selectedSub.extension)) {
      await markMultipleAsDownloaded(selectedSub.name, anilistId);
    }
    await trackDownloadedFile(tabId, downloadId);

    const { asbplayerAutoLoad } = await chrome.storage.sync.get(
      "asbplayerAutoLoad",
    );
    if (asbplayerAutoLoad !== true) {
      return { asbPlayerLoaded: false, name: selectedSub.name };
    }
    if (compressedFileExtensions.has(selectedSub.extension)) {
      const message = `Downloaded ${selectedSub.name}, but asbplayer cannot load compressed subtitle archives automatically`;
      await appendAsbPlayerLog("error", message);
      return message;
    }
    try {
      await loadSubtitlesIntoAsbPlayer(selectedSub, formattedContent ?? undefined);
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
    return "The subtitle download failed";
  }
}

async function removeLastDownloaded(tabId: number) {
  const autoDelete = (await chrome.storage.sync.get("autoDelete")).autoDelete;
  if (autoDelete)  {
    const storageKey = `${lastDownloadedKeyPrefix}${tabId}`;
    const stored = await chrome.storage.local.get(storageKey);
    const downloadIds = getTrackedDownloadIds(stored[storageKey]);
    if (downloadIds.length === 0) return;

    const failedDownloadIds: number[] = [];
    for (const downloadId of downloadIds) {
      try {
        await chrome.downloads.removeFile(downloadId);
      } catch (reason) {
        // Keep failed IDs so they are not lost and can be retried the next
        // time the extension cleans files for this tab.
        failedDownloadIds.push(downloadId);
        console.warn("Could not remove a previous subtitle", reason);
      }
    }

    if (failedDownloadIds.length > 0) {
      await chrome.storage.local.set({ [storageKey]: failedDownloadIds });
    } else {
      await chrome.storage.local.remove(storageKey);
    }
  }
}

type NavigationDetails = {
  tabId: number;
  frameId: number;
  url: string;
};

async function processNavigation(details: NavigationDetails) {
  if (details.frameId !== 0) return;
  try {
    const tab = await chrome.tabs.get(details.tabId);
    const url = tab.url ?? details.url;
    if (lastProcessedUrls.get(details.tabId) === url) return;
    lastProcessedUrls.set(details.tabId, url);
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
    if (!idAndEp) return;
    if (typeof idAndEp === "string") {
      notifyError(details.tabId, idAndEp);
      return;
    }
    const { anilistId, episode } = idAndEp;
    console.log(`anilistId: ${anilistId}, episode: ${episode}`);
    const episodeKey = `${anilistId}_${episode}`;
    const previousEpisodeKey = lastEpisodeKeys.get(details.tabId);
    if (previousEpisodeKey && previousEpisodeKey !== episodeKey) {
      await removeLastDownloaded(details.tabId);
    }
    lastEpisodeKeys.set(details.tabId, episodeKey);
    const hasAlreadyBeenDownloaded = await alreadyDownloaded(
      anilistId,
      episode,
    );
    if (hasAlreadyBeenDownloaded) {
      await chrome.tabs.sendMessage(details.tabId, {
        action: "alreadyDownloadedInfo",
      });
      return;
    }

    const downloadKey = episodeKey;
    if (downloadsInProgress.has(downloadKey)) return;
    downloadsInProgress.add(downloadKey);
    try {
      const result = await downloadSubs(details.tabId, anilistId, episode);
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
    console.error("Could not process navigation", reason);
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  void processNavigation(details);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  void processNavigation({ tabId, frameId: 0, url: tab.url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastProcessedUrls.delete(tabId);
  lastEpisodeKeys.delete(tabId);
  void removeLastDownloaded(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== "getAsbPlayerDiagnostic") return;
  void createAsbPlayerDiagnostic()
    .then((diagnostic) => sendResponse({ diagnostic }))
    .catch((reason) => {
      const details = reason instanceof Error ? reason.message : String(reason);
      sendResponse({ error: details });
    });
  return true;
});
