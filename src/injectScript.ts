import { AnimeSite, animeSites } from "./animeSites";

type ContentScriptScope = typeof globalThis & {
  asbAutoSubsMessageListenerInstalled?: boolean;
};

type SubtitleChoice = {
  url: string;
  name: string;
  extension: string;
  entryName: string;
};

const contentScriptScope = globalThis as ContentScriptScope;

// This file is injected whenever a supported site's URL changes. A SPA episode
// switch keeps the same document, so retain one message listener for it.
if (!contentScriptScope.asbAutoSubsMessageListenerInstalled) {
  contentScriptScope.asbAutoSubsMessageListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.action) {
      case "alreadyDownloadedInfo":
        createToast("Subs already downloaded once", "#ff9318d3");
        break;
      case "getAnimeMetaData":
        const animeSite: AnimeSite = animeSites.get(message.animeSiteKey)!;
        const anilistId = animeSite.getAnilistId();
        const title = animeSite.getTitle();
        const episode = animeSite.getEpisode();
        if (!episode && !anilistId && !title) {
          createToast("Couldn't get anime data", "#a51f07");
          return;
        }
        sendResponse({ anilistId, title, episode });
        break;
      case "notifyError":
        createToast(message.error, "#a51f07");
        break;
      case "notifySuccess":
        createToast(message.message ?? "Successfully downloaded subs", "#0a9611");
        break;
      case "showSubtitlePicker":
        showSubtitlePicker(message.choices, message.anilistId, message.episode);
        break;
    }
  });
}

function showSubtitlePicker(
  choices: SubtitleChoice[],
  anilistId: number,
  episode: number,
) {
  document.getElementById("asb-subtitle-picker")?.remove();
  const modal = document.createElement("div");
  modal.id = "asb-subtitle-picker";
  modal.innerHTML = `<div class="asb-picker-card" role="dialog" aria-modal="true" aria-labelledby="asb-picker-title"><div class="asb-picker-header"><div><h2 id="asb-picker-title">Escolha a legenda</h2><p>Episódio ${episode} · ${choices.length} opções</p></div><button type="button" class="asb-picker-close" aria-label="Fechar">×</button></div><div class="asb-picker-list"></div></div>`;
  const list = modal.querySelector(".asb-picker-list")!;
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "asb-subtitle-choice";
    const file = document.createElement("span");
    file.className = "asb-choice-file";
    const name = document.createElement("span");
    name.className = "asb-choice-name";
    name.textContent = choice.name.slice(0, -choice.extension.length) || choice.name;
    const extension = document.createElement("span");
    extension.className = "asb-choice-extension";
    extension.textContent = choice.extension;
    file.append(name, extension);
    const entry = document.createElement("span");
    entry.className = "asb-choice-entry";
    entry.textContent = choice.entryName;
    button.append(file, entry);
    button.addEventListener("click", () => {
      modal.querySelectorAll<HTMLButtonElement>("button").forEach((item) => {
        item.disabled = true;
      });
      entry.textContent = "Baixando…";
      chrome.runtime.sendMessage({
        action: "downloadSubtitleChoice",
        choice,
        anilistId,
        episode,
      });
      modal.remove();
    });
    list.append(button);
  }
  modal.querySelector(".asb-picker-close")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  document.body.append(modal);
}

function createToast(msg: string, color: string) {
  const toast = document.createElement("div");
  toast.className = "subs-toast";
  toast.textContent = msg;
  toast.style.backgroundColor = color;
  toast.className += " show";
  document.body.append(toast);
  setTimeout(() => {
    toast.className = toast.className.replace("show", "");
    toast.remove();
  }, 3000);
}
