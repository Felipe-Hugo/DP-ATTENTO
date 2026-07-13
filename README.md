# Attento DP — Conferências

App do Departamento Pessoal da Attento com duas funções:

1. **Conferência de Book de Terceirizadas** — confere os PDFs do book contra a
   lista padrão de documentos (ordem cronológica), por terceirizada, com
   explicação item a item.
2. **Análise de Notas Fiscais (Retenção)** — lê as notas de um condomínio,
   deduz o regime tributário, aplica as regras de retenção (PIS, COFINS, CSLL,
   IRRF, INSS) e gera relatório detalhado + resumo consolidado.

*(A antiga Conferência de DCTF está guardada nos arquivos `_backup.txt`,
caso precise voltar.)*

## Stack
- Vite + React (front)
- Vercel Serverless Functions (`/api`) → Anthropic API (`claude-sonnet-4-6`)

## COMO SUBIR (passo a passo)

### 1. GitHub
1. Crie um repositório novo (Private) em github.com
2. **Add file → Upload files**
3. Arraste TUDO de dentro desta pasta (arquivos + pastas `api` e `src`)
4. **Commit changes**

### 2. Vercel
1. vercel.com → **Add New → Project**
2. Importe o repositório criado (framework detectado: **Vite**)
3. ANTES do deploy, expanda **Environment Variables** e adicione:
   - Name: `ANTHROPIC_API_KEY`
   - Value: sua chave da Anthropic (sk-ant-...)
4. **Deploy**

### 3. Pronto
A URL pública sai em ~1 minuto. Qualquer commit novo no GitHub
redeploya automaticamente.

## Onde editar as regras (sem mexer no resto)
- `src/checklist.js` — lista de documentos do Book (ordem, condicionais)
- `src/impostos-config.js` — nomes e percentuais dos impostos, piso de
  dispensa do PCC, e a lista de serviços que acendem alerta de INSS

## Observações
- A análise é assistida por IA: o time revisa antes de protocolar/lançar.
- Quando a nota não deixa claro o regime tributário, o app marca
  "Regime a validar" em vez de adivinhar — validação humana é parte do fluxo.
