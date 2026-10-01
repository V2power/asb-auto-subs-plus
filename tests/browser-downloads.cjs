// Optional real-browser regression check; deliberately excluded from npm test.
// Node 24+: node tests/browser-downloads.cjs --browser "C:\path\chrome.exe"
// Options: --asb <unpacked dir>, --order fdm-first|asb-first|none, --probe-file-system, --keep
// Direct writes are tested with real OPFS handles in an isolated profile.
// The external OS directory picker still requires a human gesture and selection.
// FDM is represented by its unmodified suggest() naming behavior, without native messaging.
// CDP reference: https://github.com/ChromeDevTools/devtools-protocol/tree/master/pdl/domains
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const workspace = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const browserPath = option('--browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
const asbSource = path.resolve(option('--asb', workspace));
const order = option('--order', 'fdm-first');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const progress = message => process.stderr.write(`[browser-downloads] ${message}\n`);

class CDP {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(expression, sessionId) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

async function waitFor(operation, description, timeout = 25000) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try { const result = await operation(); if (result) return result; }
    catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timeout waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function main() {
  if (!['fdm-first', 'asb-first', 'none'].includes(order)) throw new Error('Invalid --order');
  await fs.access(browserPath);
  const runRoot = await fs.mkdtemp(path.join(workspace, '.browser-downloads-'));
  const profile = path.join(runRoot, 'profile');
  const downloadDir = path.join(runRoot, 'downloads');
  const asbPath = path.join(runRoot, 'asb');
  const fdmPath = path.join(runRoot, 'fdm-fixture');
  const report = { browserPath, order, asbSource, nativeFdmInitialized: false, runRoot, diagnostics: [], cases: [] };
  let browser, cdp, server, browserOutput = '', tearingDown = false;
  try {
    await Promise.all([profile, downloadDir, asbPath, fdmPath].map(dir => fs.mkdir(dir, { recursive: true })));
    await fs.mkdir(path.join(profile, 'Default'));
    await fs.writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
      download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true },
    }));
    for (const item of ['manifest.json', 'dist', 'html', 'css', 'imgs']) {
      await fs.cp(path.join(asbSource, item), path.join(asbPath, item), { recursive: true });
    }
    await fs.writeFile(path.join(fdmPath, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'FDM 3.3.1 filename regression fixture', version: '3.3.1',
      permissions: ['downloads', 'storage'], background: { service_worker: 'background.js' },
    }));
    await fs.writeFile(path.join(fdmPath, 'background.js'), `
      globalThis.filenameEvents = [];
      chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
        filenameEvents.push({ id: downloadItem.id, filename: downloadItem.filename, byExtensionId: downloadItem.byExtensionId });
        chrome.storage.local.set({ filenameEvents });
        setTimeout(() => suggest(), 700);
        return true;
      });
    `);
    const commandLine = [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--enable-automation', '--enable-unsafe-extension-debugging',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ];
    browser = spawn(browserPath, commandLine, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    progress(`Launched isolated browser PID ${browser.pid}`);
    browser.stdout.on('data', data => { browserOutput += data; });
    browser.stderr.on('data', data => { browserOutput += data; });
    let launchError;
    browser.on('error', error => { launchError = error; });
    const websocketUrl = await waitFor(async () => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error(`Browser exited ${browser.exitCode}: ${browserOutput}`);
      const content = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      const [port, endpoint] = content.trim().split(/\r?\n/);
      return `ws://127.0.0.1:${port}${endpoint}`;
    }, 'browser CDP port');
    progress('Connecting to browser CDP');
    const socket = new WebSocket(websocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket connection timed out')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
    });
    cdp = new CDP(socket);
    progress('Connected to browser CDP');
    report.version = await cdp.send('Browser.getVersion');
    // CDP's allow override bypasses extension target filename determination.
    // Use the isolated profile's normal default download directory instead.
    cdp.listeners.push(message => {
      if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded', 'Browser.downloadWillBegin', 'Browser.downloadProgress'].includes(message.method)) {
        if (tearingDown) (report.teardownDiagnostics ??= []).push(message);
        else report.diagnostics.push(message);
      }
    });
    const load = extensionPath => cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    if (order === 'fdm-first') report.fdmId = (await load(fdmPath)).id;
    report.asbId = (await load(asbPath)).id;
    progress(`ASB extension loaded: ${report.asbId}`);
    if (order === 'asb-first') report.fdmId = (await load(fdmPath)).id;
    report.extensions = await cdp.send('Extensions.getExtensions').catch(error => ({ error: error.message }));

    async function attach(targetId) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Log.enable', {}, sessionId).catch(() => {});
      return sessionId;
    }
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    for (const target of targets.filter(target => target.type === 'service_worker')) await attach(target.targetId);
    if (report.fdmId) {
      const fixtureTarget = await waitFor(async () => (await cdp.send('Target.getTargets')).targetInfos.find(
        target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${report.fdmId}/`)), 'FDM fixture worker');
      const fixtureSession = await attach(fixtureTarget.targetId);
      await waitFor(() => cdp.evaluate('chrome.downloads.onDeterminingFilename.hasListeners()', fixtureSession), 'FDM listener');
      report.fixtureReady = true;
    }
    const { targetId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${report.asbId}/html/popup.html` });
    const session = await attach(targetId);
    await waitFor(() => cdp.evaluate('document.readyState === "complete" && !!chrome.runtime?.id', session), 'ASB popup');
    if (args.includes('--probe-file-system')) {
      report.fileSystemAccess = await cdp.evaluate(`({
        secureContext: isSecureContext,
        directoryPicker: typeof showDirectoryPicker,
        directoryHandle: typeof FileSystemDirectoryHandle,
        fileWriter: typeof FileSystemFileHandle?.prototype.createWritable,
        directoryCreation: typeof FileSystemDirectoryHandle?.prototype.getDirectoryHandle,
        deletion: typeof FileSystemDirectoryHandle?.prototype.removeEntry,
        indexedDB: typeof indexedDB,
      })`, session);
      const worker = (await cdp.send('Target.getTargets')).targetInfos.find(target =>
        target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${report.asbId}/`));
      if (worker) {
        report.workerFileSystemAccess = await cdp.evaluate(`({
          directoryHandle: typeof FileSystemDirectoryHandle,
          fileWriter: typeof FileSystemFileHandle?.prototype.createWritable,
          indexedDB: typeof indexedDB,
        })`, await attach(worker.targetId));
      }
      report.passed = report.fileSystemAccess.directoryPicker === 'function' &&
        report.fileSystemAccess.fileWriter === 'function' &&
        report.fileSystemAccess.directoryCreation === 'function' &&
        report.fileSystemAccess.deletion === 'function' &&
        report.workerFileSystemAccess?.fileWriter === 'function';
      if (!report.passed) throw new Error('Direct file-system APIs unavailable in this browser');
      return;
    }
    await cdp.evaluate('chrome.storage.sync.set({ autoDelete: true, removeSpeakerNames: true, removeFurigana: true, joinSubtitleLines: true })', session);
    const subtitle = '1\n00:00:01,000 --> 00:00:02,000\n（太郎）漢字(かんじ)\n次\n';
    const message = { action: 'manualLocal', animeName: 'High School DxD', name: '[Judas] High School DxD S1 - 02_jp.srt', base64: Buffer.from(subtitle).toString('base64') };
    const sendManual = value => cdp.evaluate(`new Promise(resolve => chrome.runtime.sendMessage(${JSON.stringify(value)}, resolve))`, session);
    const missing = await sendManual(message);
    report.cases.push({ name: 'missing folder prompts configuration in English without downloads', passed: !!missing.error && missing.error === 'Open ASB Configuration and choose or authorize the subtitle folder.' });
    const helper = require('typescript').transpileModule(await fs.readFile(path.join(workspace, 'src/subtitleFiles.ts'), 'utf8'), { compilerOptions: { target: 7, module: 1 } }).outputText;
    await cdp.evaluate(`(() => { const exports = {}; ${helper}; globalThis.fsApi = exports; })()`, session);
    await cdp.evaluate('(async () => { globalThis.testRoot = await navigator.storage.getDirectory(); await fsApi.setSubtitleDirectory(testRoot); })()', session);
    const response = await sendManual(message);
    report.response = response;
    if (response.error || !response.saved) throw new Error(JSON.stringify(response));
    const readSaved = filename => cdp.evaluate(`(async () => { const parts = ${JSON.stringify(filename)}.split('/'); let dir = testRoot; for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part); return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text(); })()`, session);
    const actualContent = await readSaved(response.filename);
    report.cases.push({ name: 'exact High School DxD folder and Judas SRT filename', passed: response.filename === 'High School DxD/[Judas] High School DxD S1 - 02_jp.srt' });
    report.cases.push({ name: 'subtitle cleaning', passed: actualContent.includes('漢字次') && !/太郎|かんじ/.test(actualContent) });
    report.cases.push({ name: 'timestamps preserved', passed: actualContent.includes('00:00:01,000 --> 00:00:02,000') });
    const choices = [{ ...message, animeName: 'Anime A', name: 'one.srt' }, { ...message, animeName: 'ゆるキャン△', name: 'two.ass' }];
    const concurrent = await Promise.all(choices.map(sendManual));
    for (let index = 0; index < choices.length; index++) {
      report.cases.push({ name: `concurrent ${choices[index].animeName} filename`, passed: concurrent[index].saved === true && concurrent[index].filename === `${choices[index].animeName}/${choices[index].name}` });
    }
    const duplicate = await sendManual(message);
    report.cases.push({ name: 'duplicate preserves original and uses numbered name', passed: duplicate.filename === 'High School DxD/[Judas] High School DxD S1 - 02_jp (1).srt' && await readSaved(response.filename) === actualContent });
    const automatic = await cdp.evaluate(`(async () => {
      const file = await fsApi.saveSubtitleFile('Auto/e.srt', new TextEncoder().encode('original').buffer);
      await fsApi.trackSubtitleFile(777, file);
      await fsApi.removeSubtitleFiles(777);
      try { await (await testRoot.getDirectoryHandle('Auto')).getFileHandle('e.srt'); return false; } catch (error) { return error.name === 'NotFoundError'; }
    })()`, session);
    report.cases.push({ name: 'real file handle tracking and auto-delete', passed: automatic });
    const edited = await cdp.evaluate(`(async () => {
      const file = await fsApi.saveSubtitleFile('Auto/edited.srt', new TextEncoder().encode('original').buffer);
      await fsApi.trackSubtitleFile(778, file);
      const writable = await file.handle.createWritable(); await writable.write('edited'); await writable.close();
      await fsApi.removeSubtitleFiles(778);
      return (await file.handle.getFile()).text();
    })()`, session);
    report.cases.push({ name: 'auto-delete preserves user edits', passed: edited === 'edited' });
    const histories = await cdp.evaluate('chrome.downloads.search({})', session);
    report.cases.push({ name: 'subtitles never create browser download entries', passed: histories.length === 0 });
    server = http.createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fdm-managed.bin"' });
      response.end('FDM integration fixture');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const externalUrl = `http://127.0.0.1:${server.address().port}/fdm-managed.bin`;
    await cdp.send('Target.createTarget', { url: externalUrl });
    const externalDownload = await waitFor(async () => {
      const items = await cdp.evaluate(`chrome.downloads.search({ url: ${JSON.stringify(externalUrl)} })`, session);
      return items[0]?.state === 'complete' && items[0];
    }, 'FDM unrelated download');
    report.externalDownloadId = externalDownload.id;
    report.cases.push({ name: 'unrelated download retains FDM filename', passed: externalDownload.filename === path.join(downloadDir, 'fdm-managed.bin') });
    report.cases.push({ name: 'unrelated download contents', passed: await fs.readFile(externalDownload.filename, 'utf8') === 'FDM integration fixture' });
    const workers = (await cdp.send('Target.getTargets')).targetInfos.filter(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${report.fdmId}/`));
    if (workers.length) {
      const workerSession = await attach(workers[0].targetId);
      report.fdmEvents = (await cdp.evaluate('chrome.storage.local.get("filenameEvents")', workerSession)).filenameEvents ?? [];
      report.cases.push({ name: 'FDM filename listener registered', passed: report.fixtureReady });
      report.cases.push({ name: 'FDM handled unrelated download', passed: report.fdmEvents.length === 1 && report.fdmEvents[0].id === report.externalDownloadId });
    }
    try {
      const extensionsTarget = await cdp.send('Target.createTarget', { url: 'chrome://extensions/' });
      const extensionsSession = await attach(extensionsTarget.targetId);
      await waitFor(() => cdp.evaluate('!!chrome.developerPrivate', extensionsSession), 'extension diagnostics', 3000);
      const extensions = await cdp.evaluate('new Promise(resolve => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, resolve))', extensionsSession);
      report.extensionDiagnostics = extensions.filter(extension => [report.asbId, report.fdmId].includes(extension.id)).map(extension => ({
        id: extension.id, name: extension.name, state: extension.state, runtimeErrors: extension.runtimeErrors,
        runtimeWarnings: extension.runtimeWarnings, installWarnings: extension.installWarnings, manifestErrors: extension.manifestErrors,
      }));
      report.cases.push({ name: 'no extension filename warnings', passed: report.extensionDiagnostics.every(extension => extension.runtimeWarnings.length === 0) });
    } catch (error) { report.extensionDiagnostics = { unavailable: error.message }; }
    report.cases.push({ name: 'no extension Runtime or Log errors', passed: !report.diagnostics.some(entry =>
      entry.method === 'Runtime.exceptionThrown' || entry.params.type === 'error' || entry.params.entry?.level === 'error') });
    report.passed = report.cases.every(result => result.passed);
  } catch (error) {
    report.passed = false;
    report.error = error.stack;
  } finally {
    tearingDown = true;
    if (server) await new Promise(resolve => server.close(resolve));
    if (cdp) await cdp.send('Browser.close').catch(() => {});
    if (browser && browser.exitCode === null) {
      await Promise.race([once(browser, 'exit'), delay(5000)]);
      if (browser.exitCode === null) browser.kill();
    }
    report.browserOutput = browserOutput;
    if (!args.includes('--keep')) {
      // This path comes exclusively from mkdtemp inside this workspace. Verify
      // containment before deleting only this runner's disposable directory.
      const relative = path.relative(workspace, path.resolve(runRoot));
      if (!relative.startsWith('.browser-downloads-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Refusing unexpected cleanup path');
      await fs.rm(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      report.cleaned = true;
    }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
