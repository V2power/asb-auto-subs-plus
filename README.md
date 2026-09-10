# asb auto subs

A small chrome extension using the jimaku.cc API to automatically download japanese subtitles of the anime episode you are currently watching. Works on hianime.to and miruro.tv (can be extended on request)
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
4. Go to any anime episode on hianimez or miruro and it should download the subtitles automatically

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

Copies are saved as `name.f.ext` in the browser's download directory;
original files are preserved. Keep the picker window (or popup for local files) open until the batch finishes.
Each file has its own result, so a failure does not stop the remaining files.
The browser's download list shows final download completion or disk errors.
Manual downloads are not auto-deleted and are not sent to asbplayer. Automatic
anime detection and its existing settings continue to work independently.

Run `npm test` for type checking and manual subtitle regression tests.

Manual Jimaku requests are serialized, spaced by at least 1.2 seconds, and search/file
list responses are cached for five minutes. Identical concurrent lookups are shared.
The picker reports the remaining allowance from Jimaku response headers and warns
when a selection may exceed it. HTTP 429 and exhausted allowance pause manual traffic
until the server reset time (or Retry-After; 60 seconds if neither is supplied).
Pending files remain selected for a manual retry; successful downloads are deselected.
The limit is shared by IP, so other applications can consume allowance too.
See https://jimaku.cc/api/docs#description/rate-limits.

Provider/format groups start collapsed. Click their heading to show episodes;
the separate checkbox selects the whole group without expanding it. Amazon and
Netflix tags inside filenames are recognized as streaming providers.
Selecting two or more Jimaku files saves the batch under `Anime name/` in Downloads.
Single Jimaku downloads and local files keep their existing destination. A pending
file retried after a batch pause keeps its batch folder. Invalid folder characters
are replaced to keep the anime title a single directory name.
