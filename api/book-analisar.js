// api/book-analisar.js — analisa UM PDF do book, identifica terceirizada e classifica os documentos contidos.
export const config = { maxDuration: 300 };

import { getSupabase, normalizarCNPJ } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada na Vercel." });

  try {
    const { documento, checklist, condicionais, competencia } = req.body;
    if (!documento || !documento.data) return res.status(400).json({ error: "Nenhum documento enviado." });

    const lista = checklist.map((c) => `${c.ordem}. ${c.label}`).join("\n");

    const instrucoes = `Você é um analista de Departamento Pessoal da Attento conferindo o BOOK DE TERCEIRIZADAS. Recebeu UM arquivo PDF ("${documento.nome}"), que pode conter VÁRIOS documentos de uma ou mais empresas terceirizadas.${competencia ? ` Competência de referência: ${competencia}.` : ""}

Identifique a(s) EMPRESA(S) TERCEIRIZADA(S) (nome e CNPJ) e, para cada tipo de documento da lista padrão abaixo, informe se ele está PRESENTE neste PDF:
${lista}

Documentos condicionais (ordens ${condicionais.join(", ")}): só exigidos se houve o evento (férias/rescisão) na competência. Se não houve, marque "nao_aplicavel", não "ausente".

Para cada documento presente, extraia dados-chave úteis para conferência (valores, competência, datas de pagamento, validade de certidões, situação negativa/positiva).

Responda APENAS com JSON válido, sem markdown:
{
  "terceirizada": { "nome": "...", "cnpj": "... ou null" },
  "competencia": "MM/AAAA ou null",
  "itens_presentes": [
    { "ordem": 1, "label": "Protocolo", "status": "ok|pendencia|critico|nao_aplicavel", "obs": "curta", "dados": {} }
  ],
  "alertas": ["problemas relevantes, se houver"]
}
Inclua em itens_presentes apenas os documentos que você localizou neste PDF (com seu status). Os não encontrados serão tratados na consolidação.`;

    const content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: documento.data }, title: documento.nome || "Documento" },
      { type: "text", text: instrucoes },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 3000, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Erro na API Anthropic", detalhe: await r.text() });

    const data = await r.json();
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").replace(/```json|```/g, "").trim();
    let parsed; try { parsed = JSON.parse(texto); } catch { return res.status(502).json({ error: "Resposta não-JSON", bruto: texto }); }
    parsed._arquivo = documento.nome;

    // ---------- Memória de empresas (Supabase) ----------
    // Aqui só mantemos o nome associado ao CNPJ atualizado (cross-referência com Notas Fiscais).
    // Não mexe em regime_tributario — isso é assunto exclusivo da tela de Notas.
    const supabase = getSupabase();
    if (supabase && parsed.terceirizada?.cnpj) {
      const cnpjNorm = normalizarCNPJ(parsed.terceirizada.cnpj);
      if (cnpjNorm) {
        try {
          const { data: existente } = await supabase.from("empresas").select("cnpj").eq("cnpj", cnpjNorm).maybeSingle();
          if (!existente) {
            await supabase.from("empresas").insert({ cnpj: cnpjNorm, nome: parsed.terceirizada.nome || null, atualizado_em: new Date().toISOString() });
          } else if (parsed.terceirizada.nome) {
            await supabase.from("empresas").update({ nome: parsed.terceirizada.nome, atualizado_em: new Date().toISOString() }).eq("cnpj", cnpjNorm);
          }
        } catch (e) {
          console.error("Supabase (book-analisar) falhou, seguindo sem memória:", e);
        }
      }
    }
    // ------------------------------------------------------

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
  }
}
