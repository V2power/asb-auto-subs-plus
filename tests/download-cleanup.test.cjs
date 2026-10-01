const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const background = ts.transpileModule(fs.readFileSync('src/background.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const storageKey = 'lastDownloaded:1';
const ownDownload = (id, extra = {}) => ({
  id, state: 'complete', exists: true, byExtensionId: 'asb-test', ...extra,
});

function setup({ tracked = [11], items = [ownDownload(11)], autoDelete = true,
  style = 'callback', onRemove, onSearch } = {}) {
  const local = { [storageKey]: tracked };
  const history = new Map(items.map(item => [item.id, item]));
  const calls = { search: [], remove: [], errors: [], unchecked: [], warnings: [] };
  const event = { addListener() {} };
  let currentError, errorRead;
  const runtime = { id: 'asb-test', onMessage: event };
  Object.defineProperty(runtime, 'lastError', {
    get() { if (currentError) errorRead = true; return currentError; },
  });
  function finishCallback(callback, value, message) {
    currentError = message ? { message } : undefined;
    errorRead = false;
    callback(value);
    if (message) {
      calls.errors.push(message);
      if (!errorRead) calls.unchecked.push(message);
    }
    currentError = undefined;
  }
  const search = query => {
    calls.search.push(query);
    if (onSearch) return onSearch(query.id, history);
    return history.has(query.id) ? [history.get(query.id)] : [];
  };
  const remove = id => {
    calls.remove.push(id);
    if (onRemove) return onRemove(id, history);
    history.get(id).exists = false;
  };
  const callbackApi = {
    search(query, callback) {
      queueMicrotask(() => {
        let items;
        try { items = search(query); }
        catch (error) { finishCallback(callback, undefined, error.message); return; }
        finishCallback(callback, items);
      });
    },
    removeFile(id, callback) {
      queueMicrotask(() => {
        try { remove(id); }
        catch (error) { finishCallback(callback, undefined, error.message); return; }
        finishCallback(callback, undefined);
      });
    },
  };
  const promiseApi = {
    search: async query => search(query),
    removeFile: async id => remove(id),
  };
  const chrome = {
    runtime,
    storage: {
      sync: { get: async () => ({ autoDelete }) },
      local: {
        get: async key => Object.hasOwn(local, key) ? { [key]: local[key] } : {},
        set: async value => Object.assign(local, value),
        remove: async key => { delete local[key]; },
      },
    },
    downloads: { onDeterminingFilename: event, ...(style === 'promise' ? promiseApi : callbackApi) },
    tabs: { onUpdated: event, onRemoved: event },
    webNavigation: { onHistoryStateUpdated: event },
  };
  const context = {
    exports: {}, require: () => ({ animeSites: new Map(), removeSubtitleFiles: async () => {} }), chrome,
    console: { ...console, warn: (...args) => calls.warnings.push(args) },
    URL, TextDecoder, TextEncoder, Uint8Array, AbortController, Response,
    setTimeout, clearTimeout, btoa, atob, encodeURIComponent,
  };
  if (style === 'firefox') {
    context.browser = { downloads: promiseApi };
    chrome.downloads.search = () => { throw new Error('Expected Firefox Promise API'); };
    chrome.downloads.removeFile = () => { throw new Error('Expected Firefox Promise API'); };
  }
  vm.createContext(context);
  vm.runInContext(background, context);
  return { context, local, history, chrome, calls, finishCallback };
}

test('tracking accepts legacy IDs and filters duplicate or invalid persisted values', () => {
  const { context } = setup();
  assert.deepEqual(Array.from(context.getTrackedDownloadIds(11)), [11]);
  assert.deepEqual(Array.from(context.getTrackedDownloadIds([
    0, 11, 11, '12', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null,
  ])), [0, 11]);
});

test('auto-delete checks only tracked IDs and leaves unrelated downloads alone', async () => {
  const { context, local, calls, history } = setup({ items: [ownDownload(11), ownDownload(99)] });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.search.map(query => query.id), [11]);
  assert.deepEqual(calls.remove, [11]);
  assert.equal(history.get(99).exists, true);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('auto-delete does nothing when disabled', async () => {
  const { context, local, calls } = setup({ autoDelete: false });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.search, []);
  assert.deepEqual(calls.remove, []);
  assert.deepEqual(local[storageKey], [11]);
});

test('obsolete history IDs and missing files are discarded without removal calls', async () => {
  const { context, local, calls } = setup({ tracked: [11, 12], items: [ownDownload(12, { exists: false })] });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.search.map(query => query.id), [11, 12]);
  assert.deepEqual(calls.remove, []);
  assert.deepEqual(calls.warnings, []);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('invalid persisted IDs are discarded before browser API calls', async () => {
  const { context, local, calls } = setup({ tracked: [NaN, -1, 1.1, '11', null] });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.search, []);
  assert.deepEqual(calls.remove, []);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('cleanup never removes a tracked download owned by another extension', async () => {
  const { context, local, calls, history } = setup({ items: [ownDownload(11, { byExtensionId: 'fdm' })] });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.remove, []);
  assert.equal(history.get(11).exists, true);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('legacy tracking still cleans files when extension ownership metadata is unavailable', async () => {
  const { context, local, calls } = setup({ tracked: 11, items: [ownDownload(11, { byExtensionId: undefined })] });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.remove, [11]);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('a Chrome Invalid downloadId callback is consumed and dropped when history disappeared', async () => {
  const { context, local, calls } = setup({
    onRemove(id, history) { history.delete(id); throw new Error('Invalid downloadId'); },
  });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.errors, ['Invalid downloadId']);
  assert.deepEqual(calls.unchecked, []);
  assert.deepEqual(calls.search.map(query => query.id), [11, 11]);
  assert.deepEqual(calls.warnings, []);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('cleanup rechecks missing files without depending on browser error wording', async () => {
  const { context, local, calls } = setup({
    onRemove(id, history) { history.get(id).exists = false; throw new Error('Localized browser error'); },
  });
  await context.removeLastDownloaded(1);
  assert.deepEqual(calls.unchecked, []);
  assert.deepEqual(calls.warnings, []);
  assert.equal(Object.hasOwn(local, storageKey), false);
});

test('real Chrome deletion failures are consumed and retained for retry', async () => {
  let attempts = 0;
  const { context, local, calls } = setup({
    onRemove(id, history) {
      if (++attempts === 1) throw new Error('Permission denied');
      history.get(id).exists = false;
    },
  });
  await context.removeLastDownloaded(1);
  assert.deepEqual(Array.from(local[storageKey]), [11]);
  assert.deepEqual(calls.errors, ['Permission denied']);
  assert.deepEqual(calls.unchecked, []);
  assert.equal(calls.warnings.length, 1);
  await context.removeLastDownloaded(1);
  assert.equal(Object.hasOwn(local, storageKey), false);
  assert.deepEqual(calls.remove, [11, 11]);
});

test('search callback failures are consumed and preserve tracking for retry', async () => {
  const { context, local, calls } = setup({ onSearch() { throw new Error('Search unavailable'); } });
  await context.removeLastDownloaded(1);
  assert.deepEqual(Array.from(local[storageKey]), [11]);
  assert.deepEqual(calls.unchecked, []);
  assert.deepEqual(calls.remove, []);
  assert.equal(calls.warnings.length, 1);
});

test('downloads still in progress are retained without an invalid removal attempt', async () => {
  const { context, local, calls } = setup({ items: [ownDownload(11, { state: 'in_progress' })] });
  await context.removeLastDownloaded(1);
  assert.deepEqual(Array.from(local[storageKey]), [11]);
  assert.deepEqual(calls.remove, []);
  assert.deepEqual(calls.warnings, []);
});

for (const style of ['firefox', 'promise']) {
  test(`${style} Promise downloads API cleans existing files`, async () => {
    const { context, local, calls } = setup({ style });
    await context.removeLastDownloaded(1);
    assert.deepEqual(calls.remove, [11]);
    assert.equal(Object.hasOwn(local, storageKey), false);
  });

  test(`${style} Promise rejection preserves real deletion errors for retry`, async () => {
    const { context, local, calls } = setup({ style, onRemove() { throw new Error('Permission denied'); } });
    await context.removeLastDownloaded(1);
    assert.deepEqual(Array.from(local[storageKey]), [11]);
    assert.equal(calls.warnings.length, 1);
  });
}

test('a subtitle tracked during cleanup is preserved by the per-tab operation queue', async () => {
  const { context, local, chrome, calls, finishCallback } = setup();
  let pendingCallback;
  const started = new Promise(resolve => {
    chrome.downloads.removeFile = (id, callback) => {
      calls.remove.push(id);
      pendingCallback = callback;
      resolve();
    };
  });
  const cleanup = context.removeLastDownloaded(1);
  await started;
  const tracking = context.trackDownloadedFile(1, 12);
  finishCallback(pendingCallback, undefined);
  await Promise.all([cleanup, tracking]);
  assert.deepEqual(Array.from(local[storageKey]), [12]);
  assert.deepEqual(calls.remove, [11]);
});
