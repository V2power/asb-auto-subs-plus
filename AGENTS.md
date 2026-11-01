# ASB Auto Subs — guia para agentes

Extensão de navegador (MV3, TypeScript + webpack) que detecta o anime/episódio em sites de streaming, baixa a legenda japonesa do Jimaku (jimaku.cc) e, opcionalmente, carrega no asbplayer via webhook local (`http://127.0.0.1:8766/asbplayer`). Fork muito gerado por IA; README.md tem o histórico por versão.

## Comandos
- `npm ci` — instala dependências
- `npm test` — `tsc --noEmit` + `node --test tests/*.test.cjs` (os testes transpilam `src/*.ts` e rodam em `vm`)
- `npm run build` — webpack gera `dist/` (background, popup, injectScript)
- Na raiz, `manifest.json` está no `.gitignore`; é cópia de `chrome-manifest.json` ou `firefox-manifest.json`. Edite sempre os três.
- Teste opcional em navegador real: `node tests/browser-downloads.cjs --browser '<exe>' --order fdm-first`

## Fluxo principal (`src/background.ts`)
1. `webNavigation.onHistoryStateUpdated` e `tabs.onUpdated` (status complete) chamam `processNavigation`.
2. `getAnimeSiteKey(url)` busca o domínio em `animeSites` (`src/animeSites.ts`) e confere `isOnEpSite`. Se não bater, **ignora em silêncio**.
3. Injeta `css/index.css` e `dist/injectScript.js`, que responde `getAnimeMetaData` (título, episódio, AniList ID da página).
4. Sem AniList ID, `fetchAnilistId` busca pelo título e exige correspondência exata normalizada (proposital).
5. `fetchSubs` consulta o Jimaku por `anilist_id` + episódio; `chooseAndDownloadSubs` baixa/formata e salva. O asbplayer é opcional (`asbplayerAutoLoad`).
6. Chromium salva via File System Access API numa pasta autorizada (`src/subtitleFiles.ts`); Firefox usa a API de downloads.

## Armadilhas conhecidas
- **Novo domínio de site** exige mexer em 4 lugares: mapa `animeSites`, regex de `isOnEpSite`, `host_permissions` dos 3 manifestos e README. Esquecer um deles gera falha silenciosa (foi o caso do `miruro.cx`).
- Rotas do Miruro: `/watch/<id-opaco>/<slug>?ep=N` (título vem do slug), `/watch/<anilistId>/episode-N` ou `?ep=N` (legado numérico). Nunca interprete o prefixo numérico de um ID opaco como AniList ID.
- hianime lê título, episódio e `#syncData` do DOM.
- `dist/` está no `.gitignore`; rode o build antes de recarregar a extensão.
- A CSP restringe `connect-src` a jimaku.cc, graphql.anilist.co e 127.0.0.1:8766. Novos hosts de rede precisam entrar na CSP.
- Pedidos manuais ao Jimaku são serializados com intervalo mínimo de 1,2 s; respeite o limite de taxa (HTTP 429).

## Convenções
- Todo comportamento novo ganha teste em `tests/*.test.cjs`.
- Mensagens ao usuário são toasts via `injectScript.ts`; o README está em inglês, a conversa com o dono do projeto é em português.
