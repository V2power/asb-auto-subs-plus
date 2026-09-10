const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup(settings = {}) {
  const downloads = [], writes = [], requests = [], listeners = [];
  const event = { addListener() {} };
  const context = {
    exports: {}, require: () => ({ animeSites: [] }), console, URL,
    TextDecoder, TextEncoder, Uint8Array, AbortController, Response, setTimeout, clearTimeout, btoa, atob, encodeURIComponent,
    chrome: {
      runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onMessage: { addListener: fn => listeners.push(fn) } },
      storage: {
        sync: { get: async () => settings },
        local: { get: async () => ({ apiKey: 'test-key' }), set: async x => writes.push(x) },
      },
      downloads: { onDeterminingFilename: event, download: (options, cb) => { downloads.push(options); cb(downloads.length); } },
      tabs: { onUpdated: event, onRemoved: event },
      webNavigation: { onHistoryStateUpdated: event },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response('[]');
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(fs.readFileSync('src/background.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { context, downloads, writes, requests, listeners };
}
const source = '1\n00:00:01,000 --> 00:00:02,000\n（太郎）漢字(かんじ)\n次\n';
const local = (content = source) => ({ action: 'manualLocal', animeName: 'Yuru Camp', name: 'episode.srt', base64: Buffer.from(content).toString('base64') });

test('manual formatting preserves timestamps, cleans text and never tracks episode downloads', async () => {
  const { context, downloads, writes } = setup({ formatSubtitles: false, autoDelete: true });
  await context.handleManualRequest(local());
  assert.equal(downloads[0].filename, 'Yuru Camp/episode.srt');
  assert.equal(downloads[0].conflictAction, 'uniquify');
  const text = Buffer.from(downloads[0].url.split(',')[1], 'base64').toString('utf8');
  assert.match(text, /00:00:01,000 --> 00:00:02,000/);
  assert.match(text, /漢字次/);
  assert.doesNotMatch(text, /太郎|かんじ/);
  assert.equal(writes.length, 0);
  assert.equal(await context.getFormattingOptions(), null);
});
test('manual formatting honors individual options', async () => {
  const { context, downloads } = setup({ removeSpeakerNames: false, joinSubtitleLines: false });
  await context.handleManualRequest(local());
  const text = Buffer.from(downloads[0].url.split(',')[1], 'base64').toString('utf8');
  assert.match(text, /（太郎）漢字\n次/);
});
test('rejects invalid encoding and unsupported formats; accepts UTF-16 BOM', async () => {
  const { context, downloads } = setup();
  await assert.rejects(context.handleManualRequest({ ...local(), base64: '/w==' }), /encoding/);
  await assert.rejects(context.handleManualRequest({ ...local(), name: 'bad.zip' }), /Unsupported/);
  await context.handleManualRequest({ ...local(), base64: Buffer.from('\ufeff' + source, 'utf16le').toString('base64') });
  assert.equal(downloads.length, 1);
});
test('Jimaku requests encode names and reject untrusted download URLs', async () => {
  const { context, requests } = setup();
  await context.handleManualRequest({ action: 'manualSearch', query: 'Anime & 日本語' });
  assert.match(requests[0].url, /query=Anime%20%26%20/);
  assert.equal(requests[0].options.headers.Authorization, 'test-key');
  await context.handleManualRequest({ action: 'manualFiles', entryId: 123 });
  assert.match(requests[1].url, /entries\/123\/files$/);
  await assert.rejects(context.handleManualRequest({ action: 'manualDownload', file: { name: 'e.srt', url: 'https://example.org/e.srt' } }));
  assert.equal(requests.length, 2);
});
test('manual message handler rejects content scripts', () => {
  const { listeners } = setup();
  let responded = false;
  assert.equal(listeners[1](local(), { id: 'test', tab: { id: 1 }, url: 'https://hianime.to/' }, () => { responded = true; }), undefined);
  assert.equal(responded, false);
});

test('search cache avoids another Jimaku request', async () => {
  const { context, requests } = setup();
  await context.handleManualRequest({ action: 'manualSearch', query: 'Haikyuu' });
  await context.handleManualRequest({ action: 'manualSearch', query: 'Haikyuu' });
  assert.equal(requests.length, 1);
});
test('rate headers block manual traffic before exhausting the next request', async () => {
  const { context, requests } = setup();
  await context.readJimakuRate(new Response('[]', { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '30' } }));
  await assert.rejects(context.handleManualRequest({ action: 'manualSearch', query: 'test' }), error => error.retryAt > Date.now());
  assert.equal(requests.length, 0);
});
test('429 stops further network calls and respects Retry-After', async () => {
  const { context } = setup();
  let calls = 0;
  context.fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '90' } }); };
  await assert.rejects(context.handleManualRequest({ action: 'manualSearch', query: 'test' }), error => error.retryAt >= Date.now() + 89000);
  await assert.rejects(context.handleManualRequest({ action: 'manualSearch', query: 'another' }));
  assert.equal(calls, 1);
});
test('extension picker window can call manual handlers', async () => {
  const { listeners } = setup();
  const response = await new Promise(resolve => {
    assert.equal(listeners[1](local(), { id: 'test', tab: { id: 2 }, url: 'chrome-extension://test/html/popup.html?manager=1' }, resolve), true);
  });
  assert.equal(response.filename, 'Yuru Camp/episode.srt');
});
test('providers distinguish Judas and Sergey-Commie and keep formats separate', () => {
  const scope = { exports: {} };
  vm.createContext(scope);
  vm.runInContext(ts.transpileModule(fs.readFileSync('src/providers.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, scope);
  assert.equal(scope.exports.subtitleProvider('[Judas] Haikyu!! S01E01.ja.srt'), 'Judas');
  assert.equal(scope.exports.subtitleProvider('(Hi10) Haikyuu!! - 01 (BD 720p) (Sergey-Commie) (B684D64B).ja-en.ass'), 'Sergey-Commie');
  assert.equal(scope.exports.subtitleProvider('Haikyuu - 01.srt'), '');
  assert.equal(scope.exports.subtitleProvider('ゆるキャン△.S01E01.ふじさんとカレーめん.WEBRip.Amazon.ja-jp[sdh].srt'), 'Amazon');
  assert.equal(scope.exports.subtitleProvider('ゆるキャン△.S01E01.ふじさんとカレーめん.WEBRip.Netflix.ja[cc].srt'), 'Netflix');
  assert.equal(scope.exports.subtitleFormat('[Judas] Haikyu!! S01E01.ja.srt'), 'SRT');
});

test('local files use their folder and only Jimaku batches use the anime folder', async () => {
  const { context, downloads, writes } = setup();
  context.fetch = async () => new Response(source);
  const file = { name: 'episode.srt', url: 'https://jimaku.cc/entry/1/download/episode.srt' };
  await context.handleManualRequest({ action: 'manualDownload', file, batchFolder: 'ゆるキャン△' });
  assert.equal(downloads[0].filename, 'ゆるキャン△/episode.srt');
  await context.handleManualRequest({ action: 'manualDownload', file });
  assert.equal(downloads[1].filename, 'episode.srt');
  await context.handleManualRequest({ ...local(), batchFolder: 'ignored' });
  assert.equal(downloads[2].filename, 'Yuru Camp/episode.srt');
  assert.equal(writes.length, 0);
});
test('anime folder stays a single safe path component', () => {
  const { context } = setup();
  assert.equal(context.safeAnimeFolder('Yuru Camp: Season 1?'), 'Yuru Camp_ Season 1_');
  assert.equal(context.safeAnimeFolder('../Anime/Season\\1'), '.._Anime_Season_1');
  assert.equal(context.safeAnimeFolder('..'), 'Anime');
  assert.equal(context.safeAnimeFolder('CON'), '_CON');
  assert.equal(context.safeAnimeFolder('Anime. '), 'Anime');
});

test('local subtitles require an anime name before downloading', async () => {
  const { context, downloads } = setup();
  await assert.rejects(context.handleManualRequest({ ...local(), animeName: '   ' }), /anime/);
  assert.equal(downloads.length, 0);
  await context.handleManualRequest({ ...local(), animeName: 'ゆるキャン△: Season 1' });
  assert.equal(downloads[0].filename, 'ゆるキャン△_ Season 1/episode.srt');
});
