// api/nf-triar.js — classifica cada página do PDF como NF ou não, e agrupa NFs contíguas em blocos.
// Chamada barata (só texto de saída), rodada antes da análise fiscal completa para economizar.

export const config = { maxDuration: 60 };

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
    const { pdf, paginaInicial } = req.body;
    if (!pdf || !pdf.data) return res.status(400).json({ error: "Nenhum PDF enviado." });
    const pagIni = typeof paginaInicial === "number" ? paginaInicial : 1;

    const instrucoes = `Você está fazendo uma TRIAGEM RÁPIDA de páginas de um PDF. O objetivo é apenas classificar cada página como "NF" ou "outro", sem analisar o conteúdo em detalhe.

Para cada página do PDF (numeradas a partir de ${pagIni}), diga se é uma NOTA FISCAL (NFS-e, NF-e, RPS, DANFE, nota de serviço) ou OUTRO (boleto bancário, comprovante de pagamento/PIX/TED, folha de rosto, ordem de serviço avulsa, extrato, contrato).

Se uma nota fiscal ocupar 2+ páginas (frente e verso, continuação), marque todas as páginas dela como "NF" — vou agrupar depois.

Responda APENAS com JSON válido, começando com "{" e terminando com "}", sem markdown:
{
  "paginas": [
    { "n": ${pagIni}, "tipo": "NF" ou "outro", "motivo": "1-2 palavras" }
  ]
}`;

    const content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data }, title: pdf.nome || "PDF" },
      { type: "text", text: instrucoes },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Erro na API Anthropic", detalhe: await r.text() });

    const data = await r.json();
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = extrairJSON(texto);
    if (!parsed || !Array.isArray(parsed.paginas)) {
      return res.status(502).json({ error: `Triagem não retornou lista de páginas. Resposta: ${String(texto).slice(0, 300)}` });
    }
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
  }
}
