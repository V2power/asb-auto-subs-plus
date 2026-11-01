const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackground, json, plain } = require('./helpers.cjs');

const media = (id, romaji, extra = {}) => ({ id, title: { romaji, english: null, native: null }, synonyms: [], ...extra });
const anilist = list => json({ data: { Page: { media: list } } });

test('fetchAnilistId: exact normalised match only (case, accents and punctuation ignored)', async () => {
  const b = loadBackground({ fetch: () => anilist([media(1, 'Other'), media(2, 'Sousou no Frieren')]) });
  assert.equal(await b.context.fetchAnilistId('SOUSOU no  frieren!'), 2);
  assert.equal(b.requests[0].url, 'https://graphql.anilist.co');
  assert.equal(JSON.parse(b.requests[0].init.body).variables.title, 'SOUSOU no  frieren!');
});

test('fetchAnilistId: matches english, native and synonyms', async () => {
  const entry = { id: 9, title: { romaji: 'x', english: 'English Name', native: '日本語' }, synonyms: ['Alt Name'] };
  for (const title of ['english name', '日本語', 'ALT-NAME']) {
    const b = loadBackground({ fetch: () => anilist([entry]) });
    assert.equal(await b.context.fetchAnilistId(title), 9, title);
  }
});

test('fetchAnilistId: no match, ambiguous match, HTTP error or network error gives undefined', async () => {
  const cases = [
    () => anilist([media(1, 'Something else')]),
    () => anilist([media(1, 'Same'), media(2, 'Same')]),
    () => new Response('', { status: 500 }),
    () => { throw new Error('offline'); },
  ];
  for (const fetch of cases) {
    const b = loadBackground({ fetch });
    assert.equal(await b.context.fetchAnilistId('Same'), undefined);
  }
});

test('fetchSubs: requires an API key', async () => {
  const b = loadBackground({ local: { apiKey: '' } });
  assert.match(await b.context.fetchSubs(1, 1), /API key/);
  assert.equal(b.requests.length, 0);
});

test('fetchSubs: sends the key and maps HTTP errors to messages', async () => {
  const expected = { 400: /shouldn't happen/, 401: /Authentification failed/, 404: /Entry not found/, 429: /too many subs/, 500: /Something went wrong/ };
  for (const [status, pattern] of Object.entries(expected)) {
    const b = loadBackground({ fetch: () => new Response('', { status: Number(status) }) });
    assert.match(await b.context.fetchSubs(5, 1), pattern, status);
    assert.equal(b.requests[0].url, 'https://jimaku.cc/api/entries/search?anilist_id=5');
    assert.equal(b.requests[0].init.headers.Authorization, 'test-key');
  }
});

test('fetchSubs: empty results and per-episode aggregation with entry names', async () => {
  let b = loadBackground({ fetch: () => json([]) });
  assert.match(await b.context.fetchSubs(5, 1), /No subs found for this anime/);

  const file = (n) => ({ name: `${n}.srt`, url: `https://jimaku.cc/entry/${n}.srt`, size: 1, lastModified: '' });
  b = loadBackground({
    fetch: url => {
      if (url.includes('/entries/search')) return json([{ id: 1, name: 'First' }, { id: 2, english_name: 'Second' }, { id: 3 }]);
      if (url.includes('/entries/1/files')) return json([file('a')]);
      if (url.includes('/entries/2/files')) return json([file('b'), file('c')]);
      return new Response('', { status: 404 }); // entry 3: failed lookup is skipped, not fatal
    },
  });
  const subs = await b.context.fetchSubs(5, 4);
  assert.deepEqual(plain(subs.map(s => `${s.entryName}:${s.name}`)), ['First:a.srt', 'Second:b.srt', 'Second:c.srt']);
  assert.ok(b.requests.some(r => r.url === 'https://jimaku.cc/api/entries/1/files?episode=4'));

  b = loadBackground({ fetch: url => json(url.includes('/search') ? [{ id: 1 }] : []) });
  assert.match(await b.context.fetchSubs(5, 7), /No subs for episode 7/);
});

test('validateSub: only https jimaku.cc hosts, safe names and subtitle extensions', () => {
  const { context } = loadBackground();
  const v = (url, name) => context.validateSub({ url, name, size: 1, lastModified: '' });
  assert.equal(v('https://jimaku.cc/a/b.srt', 'b.srt').name, 'b.srt');
  assert.equal(v('https://cdn.jimaku.cc/a/b.ASS', 'b.ASS').extension, '.ass');
  assert.equal(v('http://jimaku.cc/a.srt', 'a.srt'), null);
  assert.equal(v('https://jimaku.cc.evil.com/a.srt', 'a.srt'), null);
  assert.equal(v('https://evil-jimaku.cc/a.srt', 'a.srt'), null);
  assert.equal(v('https://jimaku.cc/a.zip', 'a.zip'), null);
  assert.equal(v('nope', 'a.srt'), null);
  assert.equal(v('https://jimaku.cc/a.srt', '..'), null);
  assert.equal(v('https://jimaku.cc/a.srt', '../../etc/x.srt').name, 'x.srt');
  assert.equal(v('https://jimaku.cc/a.srt', 'dir\\sub\\y.vtt').name, 'y.vtt');
});

test('manual requests: cached for repeated queries, search validated, files filtered', async () => {
  const b = loadBackground({
    fetch: url => url.includes('/files')
      ? json([{ name: 'a.srt', url: 'https://jimaku.cc/a.srt' }, { name: 'a.zip', url: 'https://jimaku.cc/a.zip' }, { name: 'b.ass', url: 'https://evil.com/b.ass' }])
      : json([{ id: 7, name: 'X' }]),
  });
  const { context } = b;
  const first = await context.handleManualRequest({ action: 'manualSearch', query: ' frieren ' });
  await context.handleManualRequest({ action: 'manualSearch', query: 'frieren' });
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].url, 'https://jimaku.cc/api/entries/search?query=frieren&anime=true');
  assert.equal(first.entries[0].id, 7);
  await assert.rejects(context.handleManualRequest({ action: 'manualSearch', query: '   ' }), /Invalid search/);
  await assert.rejects(context.handleManualRequest({ action: 'manualSearch', query: 'x'.repeat(201) }), /Invalid search/);
  await assert.rejects(context.handleManualRequest({ action: 'manualFiles', entryId: 0 }), /Invalid entry/);
  const files = await context.handleManualRequest({ action: 'manualFiles', entryId: 7 });
  assert.deepEqual(plain(files.files.map(f => f.name)), ['a.srt']);
});

test('manual requests: HTTP 429 blocks further requests without hitting the network', async () => {
  const b = loadBackground({ fetch: () => new Response('', { status: 429, headers: { 'retry-after': '30' } }) });
  await assert.rejects(b.context.handleManualRequest({ action: 'manualSearch', query: 'a' }), /rate limit/);
  assert.equal(b.requests.length, 1);
  await assert.rejects(b.context.handleManualRequest({ action: 'manualSearch', query: 'b' }), /rate limit/);
  assert.equal(b.requests.length, 1, 'second request must not reach Jimaku');
  assert.ok(b.local.manualJimakuRate.blockedUntil > Date.now() + 20000);
});

test('manual requests are spaced at least ~1.2 s apart', async () => {
  const b = loadBackground({ fetch: () => json([]) });
  const started = Date.now();
  await b.context.handleManualRequest({ action: 'manualSearch', query: 'a' });
  await b.context.handleManualRequest({ action: 'manualSearch', query: 'b' });
  assert.ok(Date.now() - started >= 1100, `elapsed ${Date.now() - started}`);
});
