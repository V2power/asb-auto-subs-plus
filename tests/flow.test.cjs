const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, json, plain, tick } = require('./helpers.cjs');

const srt = '1\n00:00:01,000 --> 00:00:02,000\n（太郎）漢字(かんじ)\n';
const subUrl = 'https://jimaku.cc/entry/10/download/ep.srt';
const sub = { url: subUrl, name: 'ep.srt', extension: '.srt', entryName: 'My Show' };
const text = bytes => Buffer.from(bytes).toString('utf8');

function flow(options = {}) {
  const asb = { media: [{ active: true, title: 'video' }], loadStatus: 200, ...(options.asb ?? {}) };
  const bytes = options.bytes ?? Buffer.from(srt);
  const posts = [];
  const b = loadBackground({
    ...options,
    fetch: (url, init) => {
      if (url === subUrl) return new Response(bytes);
      if (url.endsWith('/bound-media')) return json({ media: asb.media });
      if (url.endsWith('/load-subtitles')) { posts.push(JSON.parse(init.body)); return new Response('ok', { status: asb.loadStatus }); }
      return options.fetch ? options.fetch(url, init) : new Response('', { status: 404 });
    },
  });
  b.posts = posts;
  return b;
}

test('download saves the formatted subtitle inside the anime folder', async () => {
  const b = flow();
  const result = await b.context.downloadSub(1, sub);
  assert.deepEqual(plain(result), { asbPlayerLoaded: false, name: 'ep.srt' });
  assert.equal(b.saves.length, 1);
  assert.equal(b.saves[0].filename, 'My Show/ep.srt');
  assert.match(text(b.saves[0].bytes), /漢字/);
  assert.doesNotMatch(text(b.saves[0].bytes), /太郎|かんじ/);
  assert.equal(b.requests.filter(r => r.url.includes('127.0.0.1')).length, 0, 'asbplayer is opt-in');
});

test('formatting disabled saves the original bytes untouched', async () => {
  const b = flow({ sync: { formatSubtitles: false } });
  await b.context.downloadSub(1, sub);
  assert.equal(text(b.saves[0].bytes), srt);
});

test('non-UTF-8 subtitles are never re-encoded', async () => {
  const legacy = Buffer.from([0x31, 0x0a, 0xff, 0xfe, 0x41]);
  const b = flow({ bytes: legacy });
  await b.context.downloadSub(1, sub);
  assert.equal(Buffer.from(b.saves[0].bytes).equals(legacy), true);
});

test('unsupported extensions are rejected before any request', async () => {
  const b = flow();
  const result = await b.context.downloadSub(1, { ...sub, name: 'a.zip', extension: '.zip' });
  assert.equal(typeof result, 'string');
  assert.equal(b.requests.length, 0);
  assert.equal(b.saves.length, 0);
});

test('Firefox path uses browser downloads with a data URL and tracks the id', async () => {
  const b = flow({ firefox: true });
  await b.context.downloadSub(3, { ...sub, entryName: undefined });
  assert.equal(b.saves.length, 0);
  assert.equal(b.downloads.length, 1);
  assert.equal(b.downloads[0].filename, 'ep.srt');
  assert.equal(b.downloads[0].conflictAction, 'uniquify');
  assert.match(b.downloads[0].url, /^data:application\/x-subrip/);
  assert.deepEqual(plain(b.local['lastDownloaded:3']), [1]);
});

test('asbplayer auto-load posts the formatted subtitle as base64', async () => {
  const b = flow({ sync: { asbplayerAutoLoad: true } });
  const result = await b.context.downloadSub(1, sub);
  assert.deepEqual(plain(result), { asbPlayerLoaded: true, name: 'ep.srt' });
  assert.equal(b.posts.length, 1);
  assert.equal(b.posts[0].files[0].name, 'ep.srt');
  const posted = Buffer.from(b.posts[0].files[0].base64, 'base64').toString('utf8');
  assert.equal(posted, text(b.saves[0].bytes), 'asbplayer gets the same content that was saved');
  assert.ok(b.requests.findIndex(r => r.url.endsWith('/bound-media')) < b.requests.findIndex(r => r.url.endsWith('/load-subtitles')));
});

test('asbplayer auto-load with formatting off sends the original file', async () => {
  const b = flow({ sync: { asbplayerAutoLoad: true, formatSubtitles: false } });
  await b.context.downloadSub(1, sub);
  assert.equal(Buffer.from(b.posts[0].files[0].base64, 'base64').toString('utf8'), srt);
});

test('asbplayer waits for an active media item before loading', async () => {
  const b = flow({ sync: { asbplayerAutoLoad: true } });
  b.context.fetch = (orig => async (url, init) => {
    if (url.endsWith('/bound-media') && b.requests.filter(r => r.url.endsWith('/bound-media')).length < 1) {
      b.requests.push({ url, init });
      return json({ media: [{ active: false }] });
    }
    return orig(url, init);
  })(b.context.fetch);
  const result = await b.context.downloadSub(1, sub);
  assert.equal(result.asbPlayerLoaded, true);
  assert.equal(b.posts.length, 1);
});

test('asbplayer failure keeps the downloaded file and reports it', async () => {
  const b = flow({ sync: { asbplayerAutoLoad: true }, asb: { loadStatus: 500 } });
  const result = await b.context.downloadSub(1, sub);
  assert.match(result, /Downloaded ep\.srt, but asbplayer auto-load failed/);
  assert.equal(b.saves.length, 1);
  assert.ok(b.local.asbPlayerLog.some(e => e.level === 'error'));
});

test('a stale navigation neither loads into asbplayer nor saves', async () => {
  const stale = flow({ sync: { asbplayerAutoLoad: true } });
  assert.equal(await stale.context.downloadSub(1, sub, () => false), null);
  assert.equal(stale.saves.length, 0);
  assert.equal(stale.posts.length, 0);

  const b = flow({ sync: { asbplayerAutoLoad: true } });
  let current = true;
  b.context.fetch = (orig => async (url, init) => { if (url.endsWith('/bound-media')) current = false; return orig(url, init); })(b.context.fetch);
  const result = await b.context.downloadSub(1, sub, () => current);
  assert.equal(result.asbPlayerLoaded, false);
  assert.equal(b.posts.length, 0);
});

test('asbplayer log keeps only the 30 most recent entries', async () => {
  const b = loadBackground();
  for (let i = 0; i < 45; i++) await b.context.appendAsbPlayerLog('info', `m${i}`);
  assert.equal(b.local.asbPlayerLog.length, 30);
  assert.equal(b.local.asbPlayerLog[29].message, 'm44');
  assert.equal(b.local.asbPlayerLog[0].message, 'm15');
});

test('concurrent asbplayer log writes are not lost', async () => {
  const b = loadBackground();
  await Promise.all(Array.from({ length: 10 }, (_, i) => b.context.appendAsbPlayerLog('info', `c${i}`)));
  assert.equal(b.local.asbPlayerLog.length, 10);
});

test('diagnostic report lists events and the endpoint state', async () => {
  const b = flow();
  await b.context.appendAsbPlayerLog('error', 'boom');
  b.context.fetch = async () => { throw new Error('refused'); };
  const report = await b.context.createAsbPlayerDiagnostic();
  assert.match(report, /ERROR: boom/);
  assert.match(report, /unavailable \(refused\)/);
});

// ---- processNavigation end to end -------------------------------------------------

const watch = 'https://hianime.to/watch/show-1?ep=1';
function navigation(overrides = {}) {
  const meta = { anilistId: 100, title: 'Show', episode: 1, ...(overrides.meta ?? {}) };
  const injections = [];
  const b = flow({
    ...overrides,
    url: watch,
    sendMessage: async (tabId, message) => {
      if (message.action === 'getAnimeMetaData') return meta;
      if (message.action === 'ping') return undefined;
      b.notifications.push(message);
    },
    fetch: url => {
      if (url.includes('/entries/search')) return json([{ id: 10, name: 'Show' }]);
      if (url.includes('/entries/10/files')) return json(overrides.files ?? [{ name: 'ep.srt', url: subUrl, size: 1, lastModified: '' }]);
      return new Response('', { status: 404 });
    },
  });
  b.injections = injections;
  b.context.chrome.scripting.executeScript = async o => { injections.push(o.files[0]); };
  b.meta = meta;
  return b;
}

test('supported episode page: injects scripts, looks up Jimaku by AniList id, saves and notifies', async () => {
  const b = navigation();
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch });
  assert.deepEqual(plain(b.injections), ['dist/injectScript.js']);
  assert.ok(b.requests.some(r => r.url.endsWith('anilist_id=100')));
  assert.equal(b.saves.length, 1);
  assert.deepEqual(plain(b.notifications.map(n => n.action)), ['notifySuccess']);
  assert.match(b.notifications[0].message, /Successfully downloaded ep\.srt/);
});

test('unsupported pages and sub-frames are ignored silently', async () => {
  const b = navigation();
  b.setUrl('https://example.com/watch/x?ep=1');
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: 'https://example.com/watch/x?ep=1' });
  b.setUrl('https://hianime.to/home');
  await b.context.processNavigation({ tabId: 2, frameId: 0, url: 'https://hianime.to/home' });
  await b.context.processNavigation({ tabId: 3, frameId: 4, url: watch });
  assert.equal(b.injections.length, 0);
  assert.equal(b.requests.length, 0);
  assert.equal(b.notifications.length, 0);
});

test('missing API key shows the setup toast and does no lookups', async () => {
  const b = navigation({ local: { apiKey: '' } });
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch });
  assert.equal(b.notifications.length, 1);
  assert.match(b.notifications[0].error, /jimaku API Key/);
  assert.equal(b.requests.length, 0);
});

test('without an AniList id the title is resolved through AniList', async () => {
  const b = navigation({ meta: { anilistId: null } });
  const inner = b.context.fetch;
  b.context.fetch = async (url, init) => url === 'https://graphql.anilist.co'
    ? (b.requests.push({ url, init }), anilist100())
    : inner(url, init);
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch });
  assert.ok(b.requests.some(r => r.url.endsWith('anilist_id=100')));
  assert.equal(b.saves.length, 1);
});
function anilist100() { return json({ data: { Page: { media: [{ id: 100, title: { romaji: 'Show' }, synonyms: [] }] } } }); }

test('unresolvable title shows an error instead of guessing', async () => {
  const b = navigation({ meta: { anilistId: null } });
  const inner = b.context.fetch;
  b.context.fetch = async (url, init) => url === 'https://graphql.anilist.co'
    ? json({ data: { Page: { media: [] } } }) : inner(url, init);
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch });
  assert.match(b.notifications[0].error, /Failed fetching AnilistId/);
  assert.equal(b.saves.length, 0);
});

test('several subtitle files open the picker instead of downloading', async () => {
  const b = navigation({ files: [
    { name: 'a.srt', url: 'https://jimaku.cc/a.srt', size: 1, lastModified: '' },
    { name: 'b.ass', url: 'https://jimaku.cc/b.ass', size: 1, lastModified: '' },
  ] });
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch });
  assert.equal(b.saves.length, 0);
  const picker = b.notifications.find(n => n.action === 'showSubtitlePicker');
  assert.equal(picker.choices.length, 2);
  assert.equal(picker.anilistId, 100);
  assert.equal(picker.episode, 1);
});

test('changing episode cleans up the previous one; same episode does not', async () => {
  const b = navigation();
  const cleaned = [];
  b.context.removeLastDownloaded = async tabId => { cleaned.push(tabId); };
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch });
  assert.equal(cleaned.length, 0);
  b.meta.episode = 2;
  b.setUrl('https://hianime.to/watch/show-1?ep=2');
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: 'https://hianime.to/watch/show-1?ep=2' });
  assert.deepEqual(cleaned, [1]);
  assert.equal(b.saves.length, 2);
});

test('closing a tab removes its tracked files', async () => {
  const b = navigation();
  let closed;
  b.context.removeLastDownloaded = async tabId => { closed = tabId; };
  b.removed[0](9);
  await tick();
  assert.equal(closed, 9);
});

test('picker choice message validates its input', async () => {
  const b = navigation();
  const reply = [];
  const send = (message, sender = { tab: { id: 1 } }) => b.listeners[0](message, sender, r => reply.push(r));
  send({ action: 'downloadSubtitleChoice', choice: { url: 'https://evil.com/a.srt', name: 'a.srt' }, anilistId: 1, episode: 1 });
  send({ action: 'downloadSubtitleChoice', choice: { url: subUrl, name: 'ep.srt' }, anilistId: 'x', episode: 1 });
  send({ action: 'downloadSubtitleChoice', choice: { url: subUrl, name: 'ep.srt' }, anilistId: 1, episode: 1 }, {});
  assert.deepEqual(plain(reply.map(r => r.error)), ['Invalid subtitle choice', 'Invalid subtitle choice', 'Invalid subtitle choice']);
});

test('picker choice for the current episode is saved; for another episode it is skipped', async () => {
  const two = [
    { name: 'a.srt', url: subUrl, size: 1, lastModified: '' },
    { name: 'b.ass', url: 'https://jimaku.cc/b.ass', size: 1, lastModified: '' },
  ];
  const b = navigation({ files: two });
  await b.context.processNavigation({ tabId: 1, frameId: 0, url: watch }); // registers 100_1 for tab 1
  const inner = b.context.fetch;
  b.context.fetch = async (url, init) => url === subUrl ? new Response(srt) : inner(url, init);
  const ask = episode => new Promise(resolve => {
    b.listeners[0]({ action: 'downloadSubtitleChoice', choice: { url: subUrl, name: 'a.srt' }, anilistId: 100, episode }, { tab: { id: 1 } }, resolve);
  });
  assert.deepEqual(plain(await ask(2)), { skipped: true });
  assert.equal(b.saves.length, 0);
  assert.deepEqual(plain(await ask(1)), { ok: true });
  assert.equal(b.saves.length, 1);
});

// ---- optimisations -------------------------------------------------------------------

test('the subtitle file is downloaded exactly once, whatever the path', async () => {
  for (const options of [
    {}, { sync: { asbplayerAutoLoad: true } }, { sync: { formatSubtitles: false } },
    { sync: { formatSubtitles: false, asbplayerAutoLoad: true } },
    { bytes: Buffer.from([0xff, 0xfe, 0x41]), sync: { asbplayerAutoLoad: true } }, { firefox: true },
  ]) {
    const b = flow(options);
    await b.context.downloadSub(1, sub);
    assert.equal(b.requests.filter(r => r.url === subUrl).length, 1, JSON.stringify(options));
  }
});

test('AniList lookups are cached per title; failures are not cached', async () => {
  let calls = 0;
  const b = loadBackground({ fetch: () => { calls++; return anilist100(); } });
  assert.equal(await b.context.fetchAnilistId('Show'), 100);
  assert.equal(await b.context.fetchAnilistId('Show'), 100);
  assert.equal(calls, 1);
  assert.equal(await b.context.fetchAnilistId('Other'), undefined);
  assert.equal(await b.context.fetchAnilistId('Other'), undefined);
  assert.equal(calls, 3);
});

test('fetchSubs accepts an already-read API key', async () => {
  const b = loadBackground({ local: { apiKey: '' }, fetch: () => json([]) });
  await b.context.fetchSubs(1, 1, 'explicit');
  assert.equal(b.requests[0].init.headers.Authorization, 'explicit');
});

test('content script injection is skipped when it already answers, done in parallel otherwise', async () => {
  const run = async sendMessage => {
    const injected = [];
    const b = loadBackground({ sendMessage });
    b.context.chrome.scripting.insertCSS = async () => { injected.push('css'); };
    b.context.chrome.scripting.executeScript = async () => { injected.push('js'); };
    await b.context.ensureContentScript(1);
    return injected;
  };
  assert.deepEqual(await run(async () => ({ ready: true })), []);
  assert.deepEqual((await run(async () => { throw new Error('Receiving end does not exist'); })).sort(), ['css', 'js']);
  assert.deepEqual((await run(async () => undefined)).sort(), ['css', 'js']);
});

test('AniList cache key is the normalised title and concurrent lookups share one request', async () => {
  let calls = 0;
  const b = loadBackground({ fetch: async () => { calls++; await tick(10); return anilist100(); } });
  const results = await Promise.all(['Show', 'show', ' SHOW! '].map(x => b.context.fetchAnilistId(x)));
  assert.deepEqual(plain(results), [100, 100, 100]);
  assert.equal(await b.context.fetchAnilistId('sHoW'), 100);
  assert.equal(calls, 1);
});

test('concurrent navigations for one tab inject the content script once', async () => {
  let injections = 0;
  const b = loadBackground({ sendMessage: async () => { await tick(5); } });
  b.context.chrome.scripting.insertCSS = async () => { injections++; };
  b.context.chrome.scripting.executeScript = async () => { injections++; };
  await Promise.all([b.context.ensureContentScript(1), b.context.ensureContentScript(1)]);
  assert.equal(injections, 2, 'one CSS + one script');
  await b.context.ensureContentScript(1);
  assert.equal(injections, 4, 'a later navigation checks again');
});
