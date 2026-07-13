// api/book-consolidar.js — consolida as análises e monta o checklist por terceirizada na ordem do book.
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
    const { analises, checklist, condicionais, competencia } = req.body;
    if (!Array.isArray(analises) || analises.length === 0) return res.status(400).json({ error: "Nada para consolidar." });

    const lista = checklist.map((c) => `${c.ordem}. ${c.label}`).join("\n");

    const instrucoes = `Você é um analista de DP da Attento consolidando a conferência do BOOK DE TERCEIRIZADAS. Abaixo, os resultados da análise individual de cada PDF do book.${competencia ? ` Competência: ${competencia}.` : ""}

RESULTADOS INDIVIDUAIS (JSON):
${JSON.stringify(analises, null, 2)}

LISTA PADRÃO DO BOOK (ordem cronológica obrigatória):
${lista}

Documentos condicionais (ordens ${condicionais.join(", ")}): só exigidos se houve o evento na competência; ausência sem evento = "nao_aplicavel", não "critico".

Agrupe por terceirizada e, para CADA UMA, monte o checklist com TODOS os itens da lista padrão, na ordem, marcando o status de cada um:
- "ok" presente e consistente
- "pendencia" presente com ressalva
- "critico" documento obrigatório ausente ou com problema grave
- "ausente" não encontrado (obrigatório)
- "nao_aplicavel" condicional sem evento

IMPORTANTE — para CADA item, preencha "obs" com UMA FRASE explicando o motivo do status: o que foi verificado e por que passou ou falhou. Exemplos: "Guia FGTS presente, valor R$ 134,40 confere com o detalhamento." / "Comprovante de pagamento do FGTS não localizado no book." / "Certidão trabalhista negativa e válida até 30/03/2026." / "Não há rescisão nesta competência, item não se aplica." Nunca deixe "obs" vazio.

Responda APENAS com JSON válido, sem markdown:
{
  "competencia_detectada": "MM/AAAA ou null",
  "terceirizadas": [
    {
      "nome": "...", "cnpj": "... ou null", "score": 0,
      "checklist": [ { "ordem": 1, "label": "Protocolo", "status": "ok|pendencia|critico|ausente|nao_aplicavel", "obs": "curta" } ],
      "pendencias": ["itens faltando ou com problema, em texto curto"]
    }
  ],
  "resumo_geral": "2 a 3 frases sobre o book"
}
Score 0 a 100 (peso maior para itens críticos/ausentes obrigatórios). O checklist de cada terceirizada deve conter os ${checklist.length} itens da lista, na ordem.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 8000, messages: [{ role: "user", content: instrucoes }] }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Erro na API Anthropic", detalhe: await r.text() });

    const data = await r.json();
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").replace(/```json|```/g, "").trim();
    const parsed = extrairJSON(texto);
    if (!parsed) {
      const resumo = String(texto || "").slice(0, 400);
      return res.status(502).json({ error: `A IA não retornou JSON. Ela respondeu: ${resumo}` });
    }
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
  }
}
