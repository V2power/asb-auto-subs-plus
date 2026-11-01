# asb auto subs

A small chrome extension using the jimaku.cc API to automatically download japanese subtitles of the anime episode you are currently watching. Works on hianime.to and miruro (tv, online, to, cx) (can be extended on request)
Intended to be used in combination with [asbplayer](https://github.com/killergerbah/asbplayer), another extension, to insert the subtitles into the video.
This fork is higly AI coded, I focused in the security and permissions but be aware!

https://github.com/user-attachments/assets/b4f83acc-35f7-41b3-b687-2baa42a84b26

# Instructions

To use the extension you have to do the following steps once:
1. Add the extension to your browser
  - Firefox: get it from the [addon store](https://addons.mozilla.org/en-US/firefox/addon/auto-subs-for-asb-player)
  - Chrome:
    - On [latest releases](https://github.com/GodPepe7/asb-auto-subs/releases) under "Assets" click on "asb-auto-subs-chrome.zip" to download the extension
    - Unzip the downloaded file
    - open "chrome://extensions/", click on "Load Unpacked" and select the unzipped extension
2. Create a [Jimaku Account](https://jimaku.cc/login)  and generate your [API Key](https://jimaku.cc/account)
3. In your searchbar at the top click on the puzzle icon and click on the extension and submit the key
4. In Helium/Chromium, open ASB and choose the subtitle folder (for example Downloads/Legendas), allowing read/write access.
5. Go to any anime episode on hianimez or miruro and it should save the subtitles automatically

# Build locally

Prerequisite: Node 24 LTS installed

1. `npm ci`
2. `npm run build`
3. Replace manifest.json content with either firefox-manifest.json or chrome-manifest.json depending on what browser is used

## Manual subtitles

The popup opens on **Subtitles**. Searching by anime name opens a larger independent
picker window. Choose a Jimaku entry, then select individual files or whole
provider/format groups (for example, Judas / SRT). Providers are inferred from
filenames; files without a recognized prefix have an unidentified group.
Download formatted copies of the selected files.
Configure your Jimaku API key in **Configuration** first.

You can also select multiple local SRT, ASS, SSA or VTT files. No Jimaku key is
needed for local files. Manual formatting applies the individual options from
Configuration even if automatic formatting is disabled. Files must use UTF-8
or UTF-16 with a BOM, with a maximum of 20 MB per file. Unsupported encodings
produce an error instead of silently corrupting the text.

Copies retain their original filenames (no added suffix). Local files are saved
in `Anime name/` under the selected subtitle directory (Chromium) or Downloads (Firefox);
original files are preserved. Keep the picker window (or popup for local files) open until the batch finishes.
Each file has its own result, so a failure does not stop the remaining files.
The per-file result reports disk write success or failure.
Manual downloads are not auto-deleted and are not sent to asbplayer. Automatic
anime detection and its existing settings continue to work independently.

Run `npm test` for type checking and manual subtitle regression tests.

## Helium / Chromium and FDM (0.0.54)

ASB saves SRT, ASS, SSA and VTT directly in a user-authorized directory using the
File System Access API. The official FDM extension stays unchanged. There is no
global filename listener, no download URL marker and no compatible FDM build
required. Archives and ordinary files are left to your usual download tools.

Reload the existing unpacked ASB extension in chrome://extensions. Open ASB,
click **Choose folder**, then click it in the larger window and select a directory.
A dedicated folder such as Downloads/Legendas is recommended. Allow read/write
access. If the browser later revokes access, use **Authorize folder** in the larger
window. ASB reports an error instead of silently using the browser download API.
Firefox continues using its existing download API.

Local files and selected Jimaku files are saved under the anime title. Automatic
subtitles use the Jimaku entry name as their folder. Original subtitle filenames
are preserved. For example:

`High School DxD/[Judas] High School DxD S1 - 02_jp.srt`

Existing files are preserved: a duplicate becomes `episode (1).srt`.
Files saved directly do not appear in browser download history. The batch result
reports successful disk writes and the actual filename. Manual files are kept;
auto-delete applies only to files saved automatically for that episode/tab.
It checks stored file handles and contents, preserving user edits. Missing files
are discarded from tracking; permission or disk failures remain for retry.
The legacy browser-download cleanup still consumes callback errors and ignores
invalid IDs and files owned by another extension. Folder handles are persisted
locally in IndexedDB, never synced to another computer.

`npm test` checks types, formatting, legacy cleanup, safe paths, concurrent saves,
duplicate preservation, permission failures and direct-file cleanup.
The optional runner uses an isolated browser profile, real OPFS file handles and
IndexedDB, plus a fixture of FDM 3.3.1's unmodified naming behavior. It does not
initialize the installed FDM native application or automate the OS folder picker:

`node tests/browser-downloads.cjs --browser '<Helium executable>' --order fdm-first`

The root selection in production always comes from the user's directory picker;
OPFS is used only as disposable storage in the integration test.

Manual Jimaku requests remain serialized and spaced by at least 1.2 seconds.
Search/file lists are cached for five minutes. Rate limits and HTTP 429 pause the
batch until the server reset time. Pending files remain selected for retry and
keep their anime folder. Provider/format groups start collapsed; their checkboxes
select the group without expanding it.

## Miruro detection and reloads (0.0.55)

Current Miruro routes use an opaque site identifier and an anime title slug.
ASB resolves that slug through AniList and requires a matching title or synonym;
it never treats a numeric prefix of an opaque identifier as an AniList ID.
Legacy routes containing only a numeric AniList ID still work.
Reloading an episode resets navigation deduplication and runs automatic saving
again. Repeated events within one loaded document remain deduplicated, and
requests invalidated by a reload do not continue to process old metadata.

Regression tests cover the reported Kuroneko to Majo no Kyoushitsu route,
misleading numeric prefixes, unrelated search results, query parameter order,
legacy routes and reloads. The optional browser runner serves an offline Miruro
fixture at the reported URL and intercepts AniList/Jimaku requests with test
responses, exercising actual extension injection, reload events and tab-close
cleanup without using a live API key.

## Performance and regression tests (0.0.56)

- The subtitle file is downloaded once and reused for saving, formatting and
  asbplayer auto-load (previously up to three downloads).
- One settings read per download; the Jimaku API key is read once per navigation.
- Successful AniList title lookups are cached in memory for 10 minutes. Failures
  and ambiguous matches are never cached.
- The content script and CSS are injected only when the tab does not answer a
  ping, and in parallel when needed.
- The asbplayer event log is written serially, so concurrent events no longer
  overwrite each other.
- Base64 encoding no longer copies each chunk into a temporary array.
- New regression tests cover site detection, manifest parity (domains, CSP,
  versions), subtitle formatting, AniList/Jimaku logic and rate limits, the
  download and asbplayer flow, and end-to-end navigation.
