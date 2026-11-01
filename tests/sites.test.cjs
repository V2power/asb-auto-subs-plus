const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSites, loadBackground, root } = require('./helpers.cjs');

test('hianime and hianimez recognise only watch pages with an episode', () => {
  const sites = loadSites('https://hianime.to/');
  for (const key of ['hianime.to', 'hianimez.to']) {
    const site = sites.get(key);
    assert.equal(site.isOnEpSite(`https://${key}/watch/spy-x-family-17977?ep=12345`), true);
    assert.equal(site.isOnEpSite(`https://${key}/watch/spy-x-family-17977`), false);
    assert.equal(site.isOnEpSite(`https://${key}/home`), false);
    assert.equal(site.isOnEpSite(`http://${key}/watch/x?ep=1`), false);
  }
});

test('hianime reads title, episode and AniList id from the DOM', () => {
  assert.equal(loadSites('https://hianime.to/watch/x?ep=1', 'Frieren').get('hianime.to').getTitle(), 'Frieren');
  assert.equal(loadSites('https://hianime.to/watch/x?ep=1', '7 Ep title').get('hianime.to').getEpisode(), 7);
  assert.equal(loadSites('https://hianime.to/watch/x?ep=1', '{"anilist_id":"154587"}').get('hianime.to').getAnilistId(), 154587);
  const empty = loadSites('https://hianime.to/watch/x?ep=1');
  assert.equal(empty.get('hianime.to').getTitle(), null);
  assert.equal(empty.get('hianime.to').getEpisode(), null);
  assert.equal(empty.get('hianime.to').getAnilistId(), null);
});

test('every supported Miruro domain is registered and only accepts https watch routes', () => {
  const sites = loadSites('https://miruro.tv/');
  for (const domain of ['miruro.tv', 'miruro.online', 'miruro.to', 'miruro.cx']) {
    const site = sites.get(domain);
    assert.ok(site, domain);
    assert.equal(site.isOnEpSite(`https://${domain}/watch/abc123/some-slug?ep=3`), true);
    assert.equal(site.isOnEpSite(`https://www.${domain}/watch/196974/episode-3`), true);
    assert.equal(site.isOnEpSite(`http://${domain}/watch/abc123/some-slug?ep=3`), false);
    assert.equal(site.isOnEpSite(`https://${domain}/watch/abc123/some-slug`), false);
    assert.equal(site.isOnEpSite(`https://${domain}/search?ep=3`), false);
  }
  assert.equal(sites.has('miruro.example.com'), false);
});

test('getAnimeSiteKey resolves www/port/path forms and ignores everything else', () => {
  const { context } = loadBackground();
  assert.equal(context.getAnimeSiteKey('https://hianime.to/watch/x?ep=1'), 'hianime.to');
  assert.equal(context.getAnimeSiteKey('https://hianimez.to/watch/x?ep=1'), 'hianimez.to');
  assert.equal(context.getAnimeSiteKey('https://www.miruro.tv/watch/abc/slug?ep=2'), 'miruro.tv');
  assert.equal(context.getAnimeSiteKey('https://hianime.to/home'), null);
  assert.equal(context.getAnimeSiteKey('https://example.com/watch/x?ep=1'), null);
  assert.equal(context.getAnimeSiteKey('not a url'), null);
  assert.equal(context.getAnimeSiteKey('https://hianime.to.evil.com/watch/x?ep=1'), null);
});

// Adding a domain without touching host_permissions fails silently in production.
test('every site domain is covered by host_permissions in all three manifests', () => {
  const domains = [...loadSites('https://hianime.to/').keys()];
  assert.ok(domains.length >= 6);
  for (const file of ['chrome-manifest.json', 'firefox-manifest.json', 'manifest.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const domain of domains) {
      assert.ok(manifest.host_permissions.includes(`https://${domain}/*`), `${file} lacks ${domain}`);
    }
  }
});

test('manifests agree with package.json and keep the restrictive CSP', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const file of ['chrome-manifest.json', 'firefox-manifest.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.equal(manifest.version, pkg.version, `${file} version`);
    const csp = manifest.content_security_policy.extension_pages;
    const connect = csp.match(/connect-src ([^;]*)/)[1].split(/\s+/).sort();
    assert.deepEqual(connect, ["'self'", 'http://127.0.0.1:8766', 'https://graphql.anilist.co', 'https://jimaku.cc'].sort(), file);
  }
  const active = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(active.version, pkg.version, 'manifest.json version');
});
