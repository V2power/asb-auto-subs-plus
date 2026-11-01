// Shared harness: transpiles src/*.ts and runs it inside a vm context with fakes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const transpile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

// Plain-data comparison across vm realms (deepStrictEqual rejects foreign prototypes).
const plain = value => JSON.parse(JSON.stringify(value));

function loadSites(url, textContent = null) {
  const context = {
    exports: {}, URL, JSON, parseInt,
    window: { location: new URL(url) },
    document: { querySelector: () => (textContent === null ? null : { textContent }) },
  };
  vm.createContext(context);
  vm.runInContext(transpile('src/animeSites.ts'), context);
  return context.exports.animeSites;
}

/**
 * Loads src/background.ts with a fake chrome API.
 * options.sync / options.local: initial storage contents.
 * options.fetch: (url, init) => Response (defaults to an empty JSON array).
 * options.sites: Map used for ./animeSites (defaults to the real one).
 */
function loadBackground(options = {}) {
  const sync = { ...(options.sync ?? {}) };
  const local = { apiKey: 'test-key', ...(options.local ?? {}) };
  const requests = [], downloads = [], saves = [], notifications = [], updated = [], history = [], removed = [], listeners = [];
  const storageArea = data => ({
    get: async keys => {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]]));
    },
    set: async values => { Object.assign(data, values); },
    remove: async keys => { for (const k of [].concat(keys)) delete data[k]; },
  });
  const event = { addListener() {} };
  let currentUrl = options.url ?? 'https://hianime.to/watch/x?ep=1';
  const sites = options.sites ?? loadSites('https://hianime.to/');
  const context = {
    exports: {}, console, Error, URL, JSON, TextEncoder, TextDecoder, Uint8Array, AbortController, Response,
    Promise, setTimeout, clearTimeout, btoa, atob, encodeURIComponent, Date,
    require: name => name === './subtitleFiles' ? {
      saveSubtitleFile: async (filename, bytes) => { const f = { id: String(saves.length), filename, bytes }; saves.push(f); return f; },
      trackSubtitleFile: async () => {}, removeSubtitleFiles: async () => {},
    } : { animeSites: sites },
    chrome: {
      runtime: {
        id: 'asb', getManifest: () => ({ version: 'test' }), getURL: p => `chrome-extension://asb/${p}`,
        onMessage: { addListener: fn => listeners.push(fn) },
      },
      storage: { sync: storageArea(sync), local: storageArea(local) },
      scripting: { insertCSS: async () => {}, executeScript: async () => {} },
      downloads: {
        download: (opts, cb) => { downloads.push(opts); cb(downloads.length); },
        onDeterminingFilename: event,
      },
      tabs: {
        get: async () => ({ url: currentUrl }),
        sendMessage: options.sendMessage ?? (async (tabId, message) => { notifications.push(message); }),
        onUpdated: { addListener: fn => updated.push(fn) },
        onRemoved: { addListener: fn => removed.push(fn) },
      },
      webNavigation: { onHistoryStateUpdated: { addListener: fn => history.push(fn) } },
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return options.fetch ? options.fetch(url, init) : new Response('[]');
    },
  };
  if (options.firefox) context.browser = { runtime: { getBrowserInfo() {} } };
  vm.createContext(context);
  vm.runInContext(transpile('src/background.ts'), context);
  return {
    context, sync, local, requests, downloads, saves, notifications, updated, history, removed, listeners,
    setUrl: url => { currentUrl = url; },
  };
}

const json = (body, init) => new Response(JSON.stringify(body), init);
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { transpile, plain, loadSites, loadBackground, json, tick, root };
