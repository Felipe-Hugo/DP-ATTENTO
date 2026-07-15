// api/nf-analisar.js — analisa UMA nota fiscal: extrai dados, deduz regime, aplica retenções.
export const config = { maxDuration: 60 };

// Extrai JSON mesmo que a IA responda com texto em volta.
function extrairJSON(texto) {
  const limpo = String(texto || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(limpo); } catch {}
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini >= 0 && fim > ini) {
    try { return JSON.parse(limpo.slice(ini, fim + 1)); } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada na Vercel." });

  try {
    const { nota, condominio, impostos, servicosINSS, pisoPCC } = req.body;
    if (!nota || !nota.data) return res.status(400).json({ error: "Nenhuma nota enviada." });

    const listaImpostos = (impostos || []).map((i) => `${i.nome} (${i.percentual}%)`).join(", ");
    const listaServicos = (servicosINSS || []).join(", ");

    const instrucoes = `Você é um Analista Fiscal Sênior especializado em retenção de tributos para condomínios no Brasil. Recebeu um PDF${condominio ? ` do condomínio ${condominio}` : ""} com um pacote de notas fiscais empilhadas de um mês inteiro. Pode conter DEZENAS de notas fiscais (10, 30, 80, 200 — quantas houver). Junto podem vir boletos, comprovantes e capas.

INSTRUÇÃO CRÍTICA — EXAUSTIVIDADE:
- Percorra o PDF INTEIRO, página por página, do início ao fim.
- Identifique CADA nota fiscal individual (NFS-e, NF-e, RPS, DANFE). Cada nota é um item separado no array de saída.
- NÃO PULE nenhuma nota. NÃO agrupe. NÃO resuma. Se houver 47 notas, o array de saída deve ter 47 itens.
- Ignore APENAS páginas que claramente não são notas fiscais: boletos bancários, comprovantes PIX/TED, folhas de rosto, ordens de serviço avulsas. Se for uma nota, entra.
- Se a mesma nota estiver em 2 páginas (frente e verso, ou continuação), trate como UM item só.

Para CADA nota fiscal encontrada, extraia e classifique separadamente:

ETAPA 1 — EXTRAIA: empresa prestadora, CNPJ, número da NF, data de emissão, valor bruto, descrição do serviço. Se algo estiver ilegível ou ausente, registre em "inconsistencias".

ETAPA 2 — REGIME TRIBUTÁRIO: tente deduzir o regime (Simples Nacional, Lucro Presumido, Lucro Real) a partir de indícios na própria nota (ex.: menção "Optante pelo Simples Nacional", "não optante", CSTs, texto de retenção). Você NÃO tem acesso à consulta da Receita. Se a nota não deixar claro, use regime "Indefinido" e "regime_validar": true — NÃO invente.

ETAPA 3 — REGRAS DE RETENÇÃO (percentuais configurados: ${listaImpostos}):
- SIMPLES NACIONAL: em regra NÃO retém PIS/COFINS/CSLL/IRRF. Mas se o serviço for de natureza previdenciária (${listaServicos}), sinalize INSS → "inss_validar": true.
- LUCRO PRESUMIDO ou LUCRO REAL: reter PIS, COFINS, CSLL e IRRF sobre o valor bruto, usando os percentuais configurados. Se a soma de PIS+COFINS+CSLL for menor que R$ ${pisoPCC}, marque dispensa do PCC em "observacoes". Se o serviço for previdenciário, sinalize INSS → "inss_validar": true.
- Se o regime for Indefinido, NÃO calcule valores: marque tudo para validação humana.

Calcule cada imposto = valor bruto × percentual / 100. Se um imposto não se aplica, use 0 e explique em "observacoes".

REGRA ABSOLUTA DE FORMATO: responda começando com "{" e terminando com "}", sem markdown, sem texto fora do JSON:
{
  "notas": [
    {
      "empresa": "...", "cnpj": "...", "numero_nf": "...", "data_emissao": "...",
      "valor_bruto": 0.00, "servico": "...",
      "regime": "Simples Nacional|Lucro Presumido|Lucro Real|Indefinido",
      "regime_validar": false,
      "retencao_obrigatoria": true,
      "retencoes": [ { "imposto": "PIS", "percentual": 0.65, "valor": 0.00, "reter": true, "motivo": "por que retém ou não" } ],
      "inss_validar": false,
      "total_retido": 0.00,
      "inconsistencias": [],
      "observacoes": "resumo e alertas"
    }
  ],
  "paginas_ignoradas": "resumo do que não era nota fiscal, se houver"
}
Se não houver nenhuma nota fiscal no PDF, retorne "notas": [] e explique em "paginas_ignoradas".`;

    const content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: nota.data }, title: nota.nome || "Nota" },
      { type: "text", text: instrucoes },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 8000, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Erro na API Anthropic", detalhe: await r.text() });

    const data = await r.json();
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = extrairJSON(texto);
    if (!parsed) {
      return res.status(502).json({ error: `A IA não retornou JSON. Ela respondeu: ${String(texto).slice(0, 400)}` });
    }
    parsed._arquivo = nota.nome;
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
  }
}
