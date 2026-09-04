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
  input.placeholder = "Chave já configurada";
  const keyInfo = document.querySelector(".key-info");
  keyInfo!.textContent = "API Key set!";
  keyInfo!.classList.add("set");
}
setApiKeyInfo();

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
    if (status) status.textContent = "Coletando diagnóstico…";
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getAsbPlayerDiagnostic",
      });
      if (response?.error || typeof response?.diagnostic !== "string") {
        throw new Error(response?.error ?? "Could not collect ASB Player diagnostics");
      }
      await copyText(response.diagnostic);
      if (status) status.textContent = "Diagnóstico copiado.";
    } catch (reason) {
      const details = reason instanceof Error ? reason.message : String(reason);
      if (status) status.textContent = `Falha ao copiar: ${details}`;
    }
  });
