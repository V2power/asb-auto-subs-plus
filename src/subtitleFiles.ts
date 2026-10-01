// File handles are structured-cloned by IndexedDB; chrome.storage cannot store them.
export type WritableDirectory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
};
export type SavedSubtitle = {
  id: string;
  filename: string;
  directory: WritableDirectory;
  handle: FileSystemFileHandle;
  digest: string;
  size: number;
  tabId?: number;
};

const databaseName = "asb-subtitle-files";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("settings");
      request.result.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function databaseOperation<T>(store: string, mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("File storage aborted"));
    });
  } finally { database.close(); }
}
export function getSubtitleDirectory(): Promise<WritableDirectory | undefined> {
  return databaseOperation("settings", "readonly", store => store.get("directory"));
}
export async function setSubtitleDirectory(directory: WritableDirectory) {
  await databaseOperation("settings", "readwrite", store => store.put(directory, "directory"));
}
async function subtitleFolderAccessError() {
  const { language } = await chrome.storage.sync.get("language");
  return new Error(language === "pt-BR"
    ? "Abra as Configurações do ASB e escolha ou autorize a pasta de legendas."
    : "Open ASB Configuration and choose or authorize the subtitle folder.");
}
export async function subtitleFileErrorMessage(reason: unknown): Promise<string> {
  const name = (reason as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return (await subtitleFolderAccessError()).message;
  }
  return reason instanceof Error ? reason.message : String(reason);
}
export async function requireSubtitleDirectory() {
  const directory = await getSubtitleDirectory();
  if (!directory || await directory.queryPermission({ mode: "readwrite" }) !== "granted") {
    throw await subtitleFolderAccessError();
  }
  return directory;
}
async function digest(bytes: ArrayBuffer) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, byte => (`0${byte.toString(16)}`).slice(-2)).join("");
}
function validateFilename(filename: string) {
  const parts = filename.split("/");
  if (!/\.(srt|ass|ssa|vtt)$/i.test(filename) || parts.some(part =>
    !part || part === "." || part === ".." || /[<>:"\\|?*\x00-\x1f\x7f]/.test(part) ||
    /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("Invalid subtitle filename");
  }
  return parts;
}
let saveQueue: Promise<unknown> = Promise.resolve();
export function saveSubtitleFile(filename: string, bytes: ArrayBuffer): Promise<SavedSubtitle> {
  // Serialize duplicate checks across manual batches and automatic requests.
  const result = saveQueue.then(async () => {
    const parts = validateFilename(filename);
    let directory = await requireSubtitleDirectory();
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part, { create: true }) as WritableDirectory;
    }
    const requestedName = parts[parts.length - 1];
    const dot = requestedName.lastIndexOf(".");
    let name = requestedName;
    for (let suffix = 1; ; suffix++) {
      try { await directory.getFileHandle(name); }
      catch (reason) {
        if ((reason as DOMException).name === "NotFoundError") break;
        if ((reason as DOMException).name !== "TypeMismatchError") throw reason;
      }
      name = `${requestedName.slice(0, dot)} (${suffix})${requestedName.slice(dot)}`;
    }
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(bytes); await writable.close(); }
    catch (reason) { try { await writable.abort(); } catch {} throw reason; }
    return { id: crypto.randomUUID(), filename: [...parts.slice(0, -1), name].join("/"),
      directory, handle, digest: await digest(bytes), size: bytes.byteLength };
  });
  saveQueue = result.catch(() => undefined);
  return result.catch(async reason => {
    if (reason?.name === "NotAllowedError" || reason?.name === "SecurityError") {
      throw await subtitleFolderAccessError();
    }
    throw reason;
  });
}
export async function trackSubtitleFile(tabId: number, file: SavedSubtitle) {
  await databaseOperation("files", "readwrite", store => store.put({ ...file, tabId }));
}
export async function removeSubtitleFiles(tabId: number) {
  const records: SavedSubtitle[] = await databaseOperation("files", "readonly", store => store.getAll());
  for (const record of records.filter(record => record.tabId === tabId)) {
    try {
      if (await record.directory.queryPermission({ mode: "readwrite" }) !== "granted") continue;
      const handle = await record.directory.getFileHandle(record.handle.name);
      const file = await handle.getFile();
      // Preserve replacements and user edits; only delete the exact saved contents.
      if (await handle.isSameEntry(record.handle) && file.size === record.size &&
          await digest(await file.arrayBuffer()) === record.digest) {
        await record.directory.removeEntry(handle.name);
      }
    } catch (reason) {
      if ((reason as DOMException).name !== "NotFoundError") {
        console.warn("Could not remove a saved subtitle", reason);
        continue;
      }
    }
    await databaseOperation("files", "readwrite", store => store.delete(record.id));
  }
}
