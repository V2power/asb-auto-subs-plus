import { subtitleProvider, subtitleFormat } from "./providers";
type Language = "en" | "pt-BR";

const translations: Record<Language, Record<string, string>> = {
  en: {
    managerTitle: "Choose your subtitles",
    groupHelp: "Select individual files or an entire provider/format. Groups are inferred from filenames; review the files before downloading.",
    unknownProvider: "Unidentified provider",
    selectedCount: "selected",
    rateUnknown: "Requests are spaced and cached. The IP rate limit is checked using Jimaku responses.",
    rateRemaining: "Requests remaining reported by Jimaku",
    rateWarning: "This batch may exceed the reported allowance. The batch will pause when needed; other apps on the same IP share this limit.",
    paused: "Batch paused. Pending files remain selected. Wait until the indicated time and click download to continue.",
    openPicker: "Open subtitle picker",
    stopBatch: "Stop after this file",

    home: "Subtitles",
    configuration: "Configuration",
    searchLabel: "Anime name",
    search: "Search",
    selectFiles: "Select all files",
    downloadSelected: "Download formatted subtitles",
    localTitle: "Subtitles from your computer",
    manualHelp: "Applies the formatting options in Configuration, even when automatic formatting is off. Saves .f copies in Downloads and preserves originals. SRT, ASS, SSA and VTT in UTF-8 or UTF-16 with BOM. Up to 20 MB per file. Keep this window open until the batch finishes.",
    chooseFiles: "Select one or more subtitles",
    loading: "Loading…",
    noAnime: "No anime found. Try another name.",
    noFiles: "No supported text subtitles found.",
    processing: "Processing",
    queued: "Download started",
    batchDone: "Processing finished. Check the results below and your browser downloads.",
    failed: "Failed",

    title: "Automatic subtitles",
    languageLabel: "Language",
    apiKeyLabel: "Jimaku API key",
    apiKeyPlaceholder: "Paste your key here",
    apiKeyConfigured: "Key already configured",
    keyInfo: "Set up your key at",
    keySet: "API key set!",
    save: "Save",
    preferences: "Preferences",
    autoDeleteTitle: "Delete when changing episodes or closing the tab",
    autoDeleteDescription: "Removes the downloaded subtitle for this tab from your computer.",
    asbplayerAutoLoadTitle: "Add to asbplayer",
    asbplayerAutoLoadDescription: "Automatically sends the formatted subtitle to asbplayer.",
    formatSubtitlesTitle: "Format subtitles",
    formatSubtitlesDescription: "Removes names, furigana, and line breaks from text subtitles.",
    selectAllFormatting: "Select all formatting options",
    removeSpeakerNames: "Remove character names",
    removeFurigana: "Remove furigana in parentheses",
    removeAssTags: "Remove ASS formatting tags",
    removeDecorativeMarkers: "Remove decorative markers ＜ ＞ ➨ ➡",
    joinSubtitleLines: "Join lines from the same subtitle",
    diagnostics: "Diagnostics",
    copyLog: "Copy asbplayer log",
    collecting: "Collecting diagnostics…",
    copied: "Diagnostics copied.",
    copyFailed: "Copy failed: ",
  },
  "pt-BR": {
    managerTitle: "Escolha suas legendas",
    groupHelp: "Selecione arquivos individualmente ou marque um provider/formato inteiro. Os grupos são inferidos dos nomes; confira os arquivos antes de baixar.",
    unknownProvider: "Provider não identificado",
    selectedCount: "selecionadas",
    rateUnknown: "Requisições espaçadas, com cache. O limite por IP será conferido nas respostas do Jimaku.",
    rateRemaining: "Requisições restantes informadas pelo Jimaku",
    rateWarning: "Este lote pode ultrapassar o saldo informado. O lote será pausado quando necessário; outros aplicativos no mesmo IP também usam esse limite.",
    paused: "Lote pausado. Os arquivos pendentes continuam selecionados. Aguarde o horário indicado e clique em baixar para continuar.",
    openPicker: "Abrir seletor de legendas",
    stopBatch: "Parar após este arquivo",

    home: "Legendas",
    configuration: "Configurações",
    searchLabel: "Nome do anime",
    search: "Pesquisar",
    selectFiles: "Selecionar todos os arquivos",
    downloadSelected: "Baixar legendas formatadas",
    localTitle: "Legendas do computador",
    manualHelp: "Aplica as opções de formatação das Configurações, mesmo com a formatação automática desligada. Salva cópias .f em Downloads e preserva os originais. SRT, ASS, SSA e VTT em UTF-8 ou UTF-16 com BOM. Até 20 MB por arquivo. Mantenha esta janela aberta até concluir o lote.",
    chooseFiles: "Selecionar uma ou várias legendas",
    loading: "Carregando…",
    noAnime: "Nenhum anime encontrado. Tente outro nome.",
    noFiles: "Nenhuma legenda textual compatível encontrada.",
    processing: "Processando",
    queued: "Download iniciado",
    batchDone: "Processamento concluído. Confira os resultados abaixo e os downloads do navegador.",
    failed: "Falha",

    title: "Legendas automáticas",
    languageLabel: "Idioma",
    apiKeyLabel: "Chave da API Jimaku",
    apiKeyPlaceholder: "Cole sua chave aqui",
    apiKeyConfigured: "Chave já configurada",
    keyInfo: "Configure sua chave em",
    keySet: "Chave da API configurada!",
    save: "Salvar",
    preferences: "Preferências",
    autoDeleteTitle: "Excluir ao trocar de episódio ou fechar a aba",
    autoDeleteDescription: "Remove do computador a legenda baixada nesta aba.",
    asbplayerAutoLoadTitle: "Adicionar ao asbplayer",
    asbplayerAutoLoadDescription: "Envia a legenda formatada automaticamente ao asbplayer.",
    formatSubtitlesTitle: "Formatar legendas",
    formatSubtitlesDescription: "Remove nomes, furigana e quebras de linha das legendas textuais.",
    selectAllFormatting: "Selecionar todas as formatações",
    removeSpeakerNames: "Remover nomes de personagens",
    removeFurigana: "Remover furigana entre parênteses",
    removeAssTags: "Remover tags de formatação ASS",
    removeDecorativeMarkers: "Remover marcadores decorativos ＜ ＞ ➨ ➡",
    joinSubtitleLines: "Unir linhas da mesma legenda",
    diagnostics: "Diagnóstico",
    copyLog: "Copiar log do asbplayer",
    collecting: "Coletando diagnóstico…",
    copied: "Diagnóstico copiado.",
    copyFailed: "Falha ao copiar: ",
  },
};

let currentLanguage: Language = "en";
const translate = (key: string) => translations[currentLanguage][key] ?? key;

function applyTranslations() {
  document.documentElement.lang = currentLanguage;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = translate(element.dataset.i18n!);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = translate(element.dataset.i18nPlaceholder!);
  });
  const languagePicker = document.getElementById("language") as HTMLSelectElement | null;
  if (languagePicker) languagePicker.setAttribute("aria-label", translate("languageLabel"));
}

async function loadLanguage() {
  const { language } = await chrome.storage.sync.get("language");
  if (language === "pt-BR" || language === "en") currentLanguage = language;
  const languagePicker = document.getElementById("language") as HTMLSelectElement | null;
  if (languagePicker) languagePicker.value = currentLanguage;
  applyTranslations();
  setApiKeyInfo();
}

document.getElementById("language")?.addEventListener("change", async (event) => {
  currentLanguage = (event.target as HTMLSelectElement).value === "pt-BR" ? "pt-BR" : "en";
  await chrome.storage.sync.set({ language: currentLanguage });
  applyTranslations();
  setApiKeyInfo();
});
applyTranslations();

document
  .getElementById("apiKeyForm")
  ?.addEventListener("submit", async function (event) {
    event.preventDefault();
    const inputAPIKey = (document.getElementById("apiKey") as HTMLInputElement)
      .value.trim();
    if (!inputAPIKey) return;
    await chrome.storage.local.set({ apiKey: inputAPIKey });
    setApiKeyInfo();
  });

async function setApiKeyInfo() {
  const localStorageItem = await chrome.storage.local.get("apiKey");
  let apiKey = localStorageItem.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    const legacyStorageItem = await chrome.storage.sync.get("apiKey");
    apiKey = legacyStorageItem.apiKey;
    if (typeof apiKey === "string" && apiKey.length > 0) {
      await chrome.storage.local.set({ apiKey });
      await chrome.storage.sync.remove("apiKey");
    }
  }
  if (typeof apiKey !== "string" || apiKey.length === 0) return;
  const input = document.getElementById("apiKey") as HTMLInputElement;
  input.value = "";
  input.placeholder = translate("apiKeyConfigured");
  const keyInfo = document.querySelector(".key-info");
  keyInfo!.textContent = translate("keySet");
  keyInfo!.classList.add("set");
}
loadLanguage();

document
  .getElementById("autoDelete")
  ?.addEventListener("change", async function (event) {
    const autoDelete = (event.target as HTMLInputElement).checked;
    await chrome.storage.sync.set({ autoDelete });
  });

async function loadSettings() {
  const { autoDelete, asbplayerAutoLoad } = await chrome.storage.sync.get([
    "autoDelete",
    "asbplayerAutoLoad",
  ]);
  const autoDeleteCheckbox = <HTMLInputElement>(
    document.getElementById("autoDelete")
  );
  autoDeleteCheckbox.checked = autoDelete === true;
  const asbplayerAutoLoadCheckbox = document.getElementById(
    "asbplayerAutoLoad",
  ) as HTMLInputElement | null;
  if (asbplayerAutoLoadCheckbox) {
    asbplayerAutoLoadCheckbox.checked = asbplayerAutoLoad === true;
  }
}
loadSettings();

document
  .getElementById("asbplayerAutoLoad")
  ?.addEventListener("change", async (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    await chrome.storage.sync.set({ asbplayerAutoLoad: enabled });
  });

const formattingOptionIds = [
  "removeSpeakerNames",
  "removeFurigana",
  "removeAssTags",
  "removeDecorativeMarkers",
  "joinSubtitleLines",
];

function formattingOptions() {
  return formattingOptionIds
    .map((id) => document.getElementById(id) as HTMLInputElement | null)
    .filter((input): input is HTMLInputElement => input !== null);
}

function updateSelectAllState() {
  const selectAll = document.getElementById(
    "selectAllFormatting",
  ) as HTMLInputElement | null;
  if (!selectAll) return;
  const options = formattingOptions();
  const selectedCount = options.filter((option) => option.checked).length;
  selectAll.checked = options.length > 0 && selectedCount === options.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < options.length;
}

function setFormattingOptionsEnabled(enabled: boolean) {
  const container = document.getElementById("formattingOptions");
  container?.classList.toggle("disabled", !enabled);
  formattingOptions().forEach((option) => {
    option.disabled = !enabled;
  });
  const selectAll = document.getElementById(
    "selectAllFormatting",
  ) as HTMLInputElement | null;
  if (selectAll) selectAll.disabled = !enabled;
}

document
  .getElementById("selectAllFormatting")
  ?.addEventListener("change", async (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    const options = formattingOptions();
    options.forEach((option) => {
      option.checked = checked;
    });
    const settings: Record<string, boolean> = {};
    options.forEach((option) => {
      settings[option.id] = checked;
    });
    await chrome.storage.sync.set(settings);
    updateSelectAllState();
  });

formattingOptions().forEach((option) => {
  option.addEventListener("change", async () => {
    await chrome.storage.sync.set({ [option.id]: option.checked });
    updateSelectAllState();
  });
});

document
  .getElementById("formatSubtitles")
  ?.addEventListener("change", async (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    await chrome.storage.sync.set({ formatSubtitles: enabled });
    setFormattingOptionsEnabled(enabled);
  });

async function loadFormattingSettings() {
  const settings = await chrome.storage.sync.get([
    "formatSubtitles",
    ...formattingOptionIds,
  ]);
  const formatSubtitles = document.getElementById(
    "formatSubtitles",
  ) as HTMLInputElement | null;
  if (formatSubtitles) formatSubtitles.checked = settings.formatSubtitles !== false;
  formattingOptions().forEach((option) => {
    option.checked = settings[option.id] !== false;
  });
  setFormattingOptionsEnabled(formatSubtitles?.checked === true);
  updateSelectAllState();
}
loadFormattingSettings();

const extensionVersion = document.getElementById("extensionVersion");
if (extensionVersion) {
  extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
}

async function copyText(text: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.append(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("Clipboard access was denied");
}

document
  .getElementById("copyAsbLog")
  ?.addEventListener("click", async () => {
    const status = document.getElementById("asbLogStatus");
    if (status) status.textContent = translate("collecting");
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getAsbPlayerDiagnostic",
      });
      if (response?.error || typeof response?.diagnostic !== "string") {
        throw new Error(response?.error ?? "Could not collect asbplayer diagnostics");
      }
      await copyText(response.diagnostic);
      if (status) status.textContent = translate("copied");
    } catch (reason) {
      const details = reason instanceof Error ? reason.message : String(reason);
      if (status) status.textContent = `${translate("copyFailed")}${details}`;
    }
  });

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
for (const page of ["home", "settings"]) {
  element<HTMLButtonElement>(`${page}Tab`).addEventListener("click", () => {
    for (const target of ["home", "settings"]) {
      element(`${target}Panel`).hidden = target !== page;
      element(`${target}Tab`).setAttribute("aria-pressed", String(target === page));
    }
  });
}

async function manualRequest(message: object) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.rate) {
    rateRemaining = response.rate.remaining;
    updateRateNotice();
  }
  if (!response || response.error) {
    const error = new Error(response?.error ?? "No response") as Error & { retryAt?: number };
    error.retryAt = response?.retryAt;
    throw error;
  }
  return response;
}

const managerMode = new URLSearchParams(location.search).get("manager") === "1";
if (managerMode) {
  document.body.classList.add("manager-mode");
  const title = document.querySelector<HTMLElement>("h1")!;
  title.dataset.i18n = "managerTitle";
  title.textContent = translate("managerTitle");
  element("pickerHelp").hidden = false;
}
let selectedAnimeName = "";
const pendingBatchFolders = new Map<string, string>();
let rateRemaining: number | undefined;
let batchStopped = false;
let availableFiles: Array<{ name: string; url: string }> = [];
let searchGeneration = 0;
let fileGeneration = 0;
let manualBusy = false;
function updateFileSelection() {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".file-choice input"));
  const count = inputs.filter((input) => input.checked).length;
  element<HTMLButtonElement>("downloadSelected").disabled = manualBusy || count === 0;
  element("selectionCount").textContent = `${count} ${translate("selectedCount")}`;
  document.querySelectorAll<HTMLInputElement>(".group-select").forEach(group => {
    const children = Array.from(group.closest(".provider-group")!.querySelectorAll<HTMLInputElement>(".file-choice input"));
    group.checked = children.every(input => input.checked);
    group.indeterminate = !group.checked && children.some(input => input.checked);
  });
  updateRateNotice();
  const all = element<HTMLInputElement>("selectFiles");
  all.checked = inputs.length > 0 && count === inputs.length;
  all.indeterminate = count > 0 && count < inputs.length;
}
element("selectFiles").addEventListener("change", () => {
  document.querySelectorAll<HTMLInputElement>(".file-choice input").forEach((input) => {
    input.checked = element<HTMLInputElement>("selectFiles").checked;
  });
  updateFileSelection();
});

element("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!managerMode) {
    try {
      await chrome.windows.create({ url: chrome.runtime.getURL(`html/popup.html?manager=1&query=${encodeURIComponent(element<HTMLInputElement>("animeQuery").value.trim())}`), type: "popup", width: 1080, height: 820 });
      window.close();
    } catch (error) { element("searchStatus").textContent = String(error); }
    return;
  }
  const generation = ++searchGeneration;
  ++fileGeneration;
  const status = element("searchStatus");
  status.textContent = translate("loading");
  element("animeResults").replaceChildren();
  element("filePanel").hidden = true;
  try {
    const { entries } = await manualRequest({ action: "manualSearch", query: element<HTMLInputElement>("animeQuery").value });
    if (generation !== searchGeneration) return;
    status.textContent = entries.length ? "" : translate("noAnime");
    for (const entry of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "anime-result";
      const title = [entry.name, entry.english_name, entry.japanese_name].filter(Boolean).join(" · ") || String(entry.id);
      button.textContent = title;
      button.addEventListener("click", async () => {
        const request = ++fileGeneration;
        status.textContent = translate("loading");
        element("filePanel").hidden = true;
        try {
          const { files } = await manualRequest({ action: "manualFiles", entryId: entry.id });
          if (request !== fileGeneration) return;
          availableFiles = files;
          selectedAnimeName = entry.name || entry.english_name || entry.japanese_name || String(entry.id);
          pendingBatchFolders.clear();
          element("selectedAnime").textContent = title;
          element("subtitleResults").replaceChildren();
          const groups = new Map<string, Array<{name: string; index: number}>>();
          files.forEach((file: {name: string}, index: number) => {
            const key = `${subtitleProvider(file.name) || translate("unknownProvider")} · ${subtitleFormat(file.name)}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push({ name: file.name, index });
          });
          groups.forEach((members, groupName) => {
            const section = document.createElement("section");
            section.className = "provider-group";
            const heading = document.createElement("div");
            heading.className = "provider-heading";
            const groupSelect = document.createElement("input");
            groupSelect.type = "checkbox";
            groupSelect.className = "group-select";
            groupSelect.setAttribute("aria-label", `${translate("selectFiles")}: ${groupName}`);
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "provider-toggle";
            toggle.textContent = `${groupName} (${members.length})`;
            toggle.setAttribute("aria-expanded", "false");
            const fileList = document.createElement("div");
            fileList.id = `provider-files-${members[0].index}`;
            fileList.hidden = true;
            toggle.setAttribute("aria-controls", fileList.id);
            toggle.addEventListener("click", () => {
              fileList.hidden = !fileList.hidden;
              toggle.setAttribute("aria-expanded", String(!fileList.hidden));
            });
            heading.append(groupSelect, toggle);
            section.append(heading, fileList);
            groupSelect.addEventListener("change", () => {
              section.querySelectorAll<HTMLInputElement>(".file-choice input").forEach(input => { input.checked = groupSelect.checked; });
              updateFileSelection();
            });
            members.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).forEach(file => {
              const label = document.createElement("label");
              label.className = "file-choice";
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              checkbox.value = String(file.index);
              checkbox.addEventListener("change", updateFileSelection);
              label.append(checkbox, document.createTextNode(file.name));
              fileList.append(label);
            });
            element("subtitleResults").append(section);
          });
          element("filePanel").hidden = files.length === 0;
          status.textContent = files.length ? "" : translate("noFiles");
          updateFileSelection();
        } catch (error) {
          if (request === fileGeneration) status.textContent = String(error);
        }
      });
      element("animeResults").append(button);
    }
  } catch (error) {
    if (generation === searchGeneration) status.textContent = String(error);
  }
});

async function runManualBatch(jobs: Array<{name: string; run: () => Promise<any>}>) {
  if (manualBusy || !jobs.length) return;
  ++fileGeneration;
  manualBusy = true;
  batchStopped = false;
  element("stopBatch").hidden = false;
  element<HTMLButtonElement>("stopBatch").disabled = false;
  element("searchForm").querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(input => { input.disabled = true; });
  element("animeResults").querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
  element<HTMLInputElement>("localFiles").disabled = true;
  updateFileSelection();
  element("jobResults").replaceChildren();
  try {
    for (let index = 0; index < jobs.length; index++) {
      if (batchStopped) break;
      const job = jobs[index];
      element("manualStatus").textContent = `${translate("processing")} ${index + 1}/${jobs.length}`;
      element("batchProgress").textContent = element("manualStatus").textContent;
      const result = document.createElement("li");
      try {
        const response = await job.run();
        result.textContent = `${translate("queued")}: ${response.filename}`;
      } catch (error) {
        result.textContent = `${translate("failed")}: ${job.name} — ${String(error)}`;
        if ((error as {retryAt?: number}).retryAt) batchStopped = true;
      }
      element("jobResults").append(result);
    }
    element("manualStatus").textContent = translate(batchStopped ? "paused" : "batchDone");
    element("batchProgress").textContent = element("manualStatus").textContent;
  } finally {
    manualBusy = false;
    element("stopBatch").hidden = true;
    element("searchForm").querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(input => { input.disabled = false; });
    element("animeResults").querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
    element<HTMLInputElement>("localFiles").disabled = false;
    element<HTMLInputElement>("localFiles").value = "";
    updateFileSelection();
  }
}

element("downloadSelected").addEventListener("click", () => {
  const selected = Array.from(document.querySelectorAll<HTMLInputElement>(".file-choice input:checked"))
    .map((input) => availableFiles[Number(input.value)]);
  if (selected.length > 1) {
    selected.forEach(file => pendingBatchFolders.set(file.url, selectedAnimeName));
  }
  void runManualBatch(selected.map((file) => ({ name: file.name, run: async () => {
    const response = await manualRequest({ action: "manualDownload", file, batchFolder: pendingBatchFolders.get(file.url) });
    pendingBatchFolders.delete(file.url);
    const index = availableFiles.indexOf(file);
    const checkbox = document.querySelector<HTMLInputElement>(`.file-choice input[value="${index}"]`);
    if (checkbox) checkbox.checked = false;
    updateFileSelection();
    return response;
  } })));
});

element("localFiles").addEventListener("change", () => {
  const files = Array.from(element<HTMLInputElement>("localFiles").files ?? []);
  void runManualBatch(files.map((file) => ({ name: file.name, run: async () => {
    if (file.size > 20 * 1024 * 1024) throw new Error("Maximum 20 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 8192)));
    }
    return manualRequest({ action: "manualLocal", name: file.name, base64: btoa(binary) });
  } })));
});

function updateRateNotice() {
  const count = document.querySelectorAll(".file-choice input:checked").length;
  element("rateNotice").textContent = rateRemaining === undefined ? translate("rateUnknown")
    : `${translate("rateRemaining")}: ${rateRemaining}. ${count > rateRemaining ? translate("rateWarning") : ""}`;
}
element("stopBatch").addEventListener("click", () => {
  batchStopped = true;
  element<HTMLButtonElement>("stopBatch").disabled = true;
});
if (managerMode) {
  const query = new URLSearchParams(location.search).get("query") ?? "";
  element<HTMLInputElement>("animeQuery").value = query;
  if (query) element<HTMLFormElement>("searchForm").requestSubmit();
}
