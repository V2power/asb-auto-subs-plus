const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const watchUrl = 'https://www.miruro.tv/watch/5xsd0uWbttra_ZDjNCkIaQptEu-bsD4U/kuroneko-to-majo-no-kyoushitsu?ep=1';
function site(url = watchUrl) {
  const context = { exports: {}, URL, window: { location: new URL(url) },
    document: { querySelector: () => ({ textContent: 'Cowboy Bebop' }) } };
  vm.createContext(context); vm.runInContext(transpile('src/animeSites.ts'), context);
  return context.exports.animeSites.get('miruro.tv');
}
const correctAnime = { id: 196974, title: { romaji: 'Kuroneko to Majo no Kyoushitsu', english: 'The Classroom of the Black Cat and a Witch' }, synonyms: [] };
const cowboy = { id: 5, title: { romaji: 'Cowboy Bebop: Tengoku no Tobira', english: 'Cowboy Bebop: The Movie' } };
function background() {
  const updates = [], history = [], saves = [], searches = [], notifications = [];
  let currentUrl = watchUrl;
  const event = { addListener() {} };
  const context = {
    exports: {}, console, Error, URL, TextEncoder, TextDecoder, Uint8Array, AbortController, Response, setTimeout, clearTimeout, btoa, atob,
    require: name => name === './subtitleFiles' ? {
      saveSubtitleFile: async (filename, bytes) => { const file = { id: String(saves.length), filename, bytes }; saves.push(file); return file; },
      trackSubtitleFile: async () => {}, removeSubtitleFiles: async () => {},
    } : { animeSites: new Map([['miruro.tv', { isOnEpSite: url => site(url).isOnEpSite(url) }]]) },
    chrome: {
      runtime: { id: 'asb', onMessage: event },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({ apiKey: 'fixture' }), set: async () => {} } },
      scripting: { insertCSS: async () => {}, executeScript: async () => {} },
      tabs: {
        get: async () => ({ url: currentUrl }),
        sendMessage: async (tabId, message) => {
          if (message.action === 'getAnimeMetaData') {
            const metadata = site(currentUrl);
            return { anilistId: metadata.getAnilistId(), title: metadata.getTitle(), episode: metadata.getEpisode() };
          }
          notifications.push(message);
        },
        onUpdated: { addListener: fn => updates.push(fn) }, onRemoved: event,
      },
      webNavigation: { onHistoryStateUpdated: { addListener: fn => history.push(fn) } },
    },
    fetch: async (url, options) => {
      if (url === 'https://graphql.anilist.co') return new Response(JSON.stringify({ data: { Page: { media: [cowboy, correctAnime] } } }));
      if (url.includes('/entries/search?')) {
        searches.push(url);
        return new Response(JSON.stringify([{ id: 10, name: 'Kuroneko to Majo no Kyoushitsu' }]));
      }
      if (url.includes('/entries/10/files')) return new Response(JSON.stringify([{ name: 'episode.srt', url: 'https://jimaku.cc/entry/10/download/episode.srt' }]));
      return new Response('1\n00:00:01,000 --> 00:00:02,000\n字幕\n');
    },
  };
  vm.createContext(context); vm.runInContext(transpile('src/background.ts'), context);
  return { context, updates, history, saves, searches, notifications, setUrl: url => { currentUrl = url; } };
}
test('opaque Miruro ID beginning with 5 does not become Cowboy Bebop, and route title beats unrelated DOM', () => {
  const miruro = site();
  assert.equal(miruro.getAnilistId(), null);
  assert.equal(miruro.getTitle(), 'kuroneko to majo no kyoushitsu');
  assert.equal(miruro.getEpisode(), 1); assert.equal(miruro.isOnEpSite(watchUrl), true);
});
test('legacy numeric AniList routes still work; partially numeric IDs never do', () => {
  assert.equal(site('https://miruro.tv/watch/196974?ep=1').getAnilistId(), 196974);
  assert.equal(site('https://miruro.tv/watch/196974/episode-2').getEpisode(), 2);
  for (const id of ['5abc', '196974abc', '5xsd0uWbttra_ZDjNCkIaQptEu-bsD4U']) assert.equal(site(`https://miruro.tv/watch/${id}?ep=1`).getAnilistId(), null);
});
test('episode parsing accepts query order and rejects invalid episode values and hosts', () => {
  assert.equal(site(watchUrl.replace('?ep=1', '?provider=x&ep=2')).getEpisode(), 2);
  for (const value of ['0', '-1', '2oops', '1.5']) assert.equal(site(watchUrl.replace('?ep=1', `?ep=${value}`)).getEpisode(), null);
  assert.equal(site().isOnEpSite(watchUrl.replace('miruro.tv', 'miruro.tv.example.com')), false);
});
test('AniList lookup selects the matching title and rejects unrelated or ambiguous search results', async () => {
  const { context } = background();
  assert.equal(await context.fetchAnilistId('kuroneko to majo no kyoushitsu'), 196974);
  // Successful lookups are cached, so each failure case gets a fresh background.
  const other = background().context;
  other.fetch = async () => new Response(JSON.stringify({ data: { Page: { media: [cowboy] } } }));
  assert.equal(await other.fetchAnilistId('kuroneko to majo no kyoushitsu'), undefined);
  const ambiguous = background().context;
  ambiguous.fetch = async () => new Response(JSON.stringify({ data: { Page: { media: [correctAnime, { ...correctAnime, id: 123 }] } } }));
  assert.equal(await ambiguous.fetchAnilistId('kuroneko to majo no kyoushitsu'), undefined);
});
test('same-document duplicate events are ignored, but reload of the same URL downloads again', async () => {
  const { context, updates, saves, searches } = background();
  const navigation = { tabId: 1, frameId: 0, url: watchUrl };
  await context.processNavigation(navigation);
  assert.equal(saves.length, 1); assert.match(searches[0], /anilist_id=196974/);
  await context.processNavigation(navigation); assert.equal(saves.length, 1);
  updates[0](1, { status: 'loading' }, { url: watchUrl });
  updates[0](1, { status: 'complete' }, { url: watchUrl });
  for (let i = 0; i < 30 && saves.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(saves.length, 2); assert.equal(searches.length, 2);
});
test('a reload invalidates unfinished metadata lookup before it can download a stale subtitle', async () => {
  const { context, updates, saves } = background();
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const fetch = context.fetch;
  context.fetch = async (url, options) => { if (url === 'https://graphql.anilist.co') await waiting; return fetch(url, options); };
  const processing = context.processNavigation({ tabId: 1, frameId: 0, url: watchUrl });
  await new Promise(resolve => setTimeout(resolve, 5));
  updates[0](1, { status: 'loading' }, { url: watchUrl }); release();
  await processing; assert.equal(saves.length, 0);
});
test('miruro.cx routes are recognised', () => {
  const url = 'https://www.miruro.cx/watch/V2KiTewCd4PssRSpSBrHFmrFWYdhKIp2/tensei-kizoku-kantei-skill-de-nariagaru-3rd-season?ep=4';
  const miruro = site(url);
  assert.equal(miruro.isOnEpSite(url), true);
  assert.equal(miruro.getEpisode(), 4);
  assert.equal(miruro.getAnilistId(), null);
  assert.equal(miruro.getTitle(), 'tensei kizoku kantei skill de nariagaru 3rd season');
});
