@AGENTS.md

# Notas para o Claude Code
- Converse com o usuário em português (BR).
- "Não detecta o anime / não baixa legenda" quase sempre significa domínio ou rota não reconhecida. Peça a URL completa e confira `animeSites.ts` e `host_permissions` antes de procurar bugs mais fundos.
- Depois de mudar código, rode `npm test` e `npm run build`, e lembre o usuário de recarregar a extensão em `chrome://extensions`.
- Sites já suportados: hianime.to, hianimez.to, miruro.tv/.online/.to/.cx.
- O git do projeto pode acusar "dubious ownership" neste ambiente. Não altere a configuração global do git sem pedir.
