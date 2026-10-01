const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup(settings = {}) {
  const saved = [], tracked = [], filenameListeners = [], downloadCalls = [];
  const event = { addListener() {} };
  const context = {
    exports: {}, require: name => name === './subtitleFiles' ? {
      saveSubtitleFile: async (filename, bytes) => { const file = { id: String(saved.length), filename, bytes }; saved.push(file); return file; },
      trackSubtitleFile: async (tabId, file) => tracked.push({ tabId, file }), removeSubtitleFiles: async () => {},
    } : { animeSites: [] }, console: { ...console, error() {} }, Error, URL, TextDecoder, TextEncoder, Uint8Array, AbortController, Response,
    setTimeout, clearTimeout, btoa, atob,
    chrome: {
      runtime: { id: 'asb', onMessage: event },
      storage: { sync: { get: async () => settings }, local: { get: async () => ({}), set: async () => {} } },
      downloads: {
        onDeterminingFilename: { addListener: fn => filenameListeners.push(fn) },
        download: options => { downloadCalls.push(options); throw new Error('Must not use Chromium downloads'); },
      },
      tabs: { onUpdated: event, onRemoved: event }, webNavigation: { onHistoryStateUpdated: event },
    },
    fetch: async url => url.startsWith('data:') ? fetch(url) : new Response('1\n00:00:01,000 --> 00:00:02,000\n（太郎）漢字(かんじ)\n次\n'),
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(fs.readFileSync('src/background.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { context, saved, tracked, filenameListeners, downloadCalls };
}
test('Helium saving bypasses download naming, preserving the exact High School DxD path', async () => {
  const { context, saved, filenameListeners, downloadCalls } = setup();
  const filename = 'High School DxD/[Judas] High School DxD S1 - 02_jp.srt';
  assert.equal((await context.downloadFormattedSubtitle(filename, '字幕')).filename, filename);
  assert.equal(Buffer.from(saved[0].bytes).toString(), '字幕');
  assert.equal(filenameListeners.length, 0); assert.equal(downloadCalls.length, 0);
});
test('automatic saving keeps cleaning, anime folders and tracking for deletion', async () => {
  const { context, saved, tracked } = setup({ formatSubtitles: true });
  await context.downloadSub(7, { url: 'https://jimaku.cc/e.srt', name: 'episode.srt', extension: '.srt', entryName: 'High School DxD' });
  assert.equal(saved[0].filename, 'High School DxD/episode.srt');
  const content = Buffer.from(saved[0].bytes).toString();
  assert.match(content, /00:00:01,000 --> 00:00:02,000/); assert.match(content, /漢字次/); assert.doesNotMatch(content, /太郎|かんじ/);
  assert.equal(tracked[0].tabId, 7); assert.equal(tracked[0].file, saved[0]);
});
test('original subtitle bytes survive with formatting disabled', async () => {
  const { context, saved } = setup({ formatSubtitles: false });
  const bytes = Uint8Array.from([0xff, 0xfe, 0x41, 0]);
  context.fetch = async url => url.startsWith('data:') ? fetch(url) : new Response(bytes);
  await context.downloadSub(7, { url: 'https://jimaku.cc/e.srt', name: 'episode.srt', extension: '.srt' });
  assert.deepEqual(Buffer.from(saved[0].bytes), Buffer.from(bytes));
});
test('ASB rejects archives and ordinary files', () => {
  const { context } = setup();
  for (const name of ['movie.mp4', '01-03.zip', 'bundle.rar', 'bundle.7z', 'installer.exe']) assert.equal(context.validateSub({ url: `https://jimaku.cc/${name}`, name }), null);
});
test('failure never falls back to Chromium downloads', async () => {
  const { context, downloadCalls } = setup(); context.fetch = async () => { throw new Error('Authorize subtitle folder'); };
  assert.equal(await context.downloadSub(7, { url: 'https://jimaku.cc/e.srt', name: 'episode.srt', extension: '.srt' }), 'Authorize subtitle folder');
  assert.equal(downloadCalls.length, 0);
});
