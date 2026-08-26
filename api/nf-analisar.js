// api/nf-analisar.js — analisa UMA nota fiscal: extrai dados, deduz regime, aplica retenções.
// Com memória: se o CNPJ já tem regime confirmado no Supabase, usa ele em vez de confiar na dedução da IA.
export const config = { maxDuration: 60 };

import { getSupabase, normalizarCNPJ } from "./_supabase.js";

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

// Recalcula as retenções de forma determinística, dado um regime já CONHECIDO.
// Mesma lógica que pedimos pra IA aplicar, só que sem depender dela adivinhar de novo.
function calcularRetencoes(regime, valorBruto, servico, impostos, servicosINSS, pisoPCC) {
  const ehServicoINSS = (servicosINSS || []).some((s) =>
    String(servico || "").toLowerCase().includes(String(s).toLowerCase())
  );

  if (regime === "Simples Nacional") {
    const retencoes = (impostos || []).map((imp) => {
      if (imp.chave === "INSS") {
        return { imposto: imp.nome, percentual: imp.percentual, valor: 0, reter: false,
          motivo: ehServicoINSS ? "Simples Nacional, mas serviço de natureza previdenciária — validar INSS manualmente" : "Simples Nacional — não se aplica" };
      }
      return { imposto: imp.nome, percentual: imp.percentual, valor: 0, reter: false,
        motivo: "Optante pelo Simples Nacional — dispensado desta retenção" };
    });
    return { retencoes, inss_validar: ehServicoINSS, retencao_obrigatoria: false, total_retido: 0 };
  }

  if (regime === "Lucro Presumido" || regime === "Lucro Real") {
    const pccChaves = ["PIS", "COFINS", "CSLL"];
    const somaPCC = (impostos || [])
      .filter((i) => pccChaves.includes(i.chave))
      .reduce((s, i) => s + (valorBruto * i.percentual) / 100, 0);
    const dispensaPCC = pisoPCC != null && somaPCC < pisoPCC;

    const retencoes = (impostos || []).map((imp) => {
      if (imp.chave === "INSS") {
        return { imposto: imp.nome, percentual: imp.percentual, valor: 0, reter: false,
          motivo: ehServicoINSS ? "Serviço de natureza previdenciária — validar INSS manualmente" : "Não se aplica a este serviço" };
      }
      const valor = Math.round(((valorBruto * imp.percentual) / 100) * 100) / 100;
      const isPCC = pccChaves.includes(imp.chave);
      const reter = isPCC ? !dispensaPCC : true;
      return { imposto: imp.nome, percentual: imp.percentual, valor: reter ? valor : 0, reter,
        motivo: reter ? "Retenção obrigatória conforme regime" : `Dispensado — soma PIS+COFINS+CSLL abaixo do piso de R$ ${pisoPCC}` };
    });
    const total_retido = Math.round(retencoes.reduce((s, r) => s + (r.reter ? r.valor : 0), 0) * 100) / 100;
    return { retencoes, inss_validar: ehServicoINSS, retencao_obrigatoria: true, total_retido };
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

    const instrucoes = `Você é um Analista Fiscal Sênior especializado em retenção de tributos para condomínios no Brasil. Recebeu UMA nota fiscal (PDF) de um prestador de serviços${condominio ? ` do condomínio ${condominio}` : ""}. Analise-a com rigor.

ETAPA 1 — EXTRAIA da nota: empresa prestadora, CNPJ, número da NF, data de emissão, valor bruto, descrição do serviço. Se algo estiver ilegível ou ausente, registre em "inconsistencias".

ETAPA 2 — REGIME TRIBUTÁRIO: tente deduzir o regime (Simples Nacional, Lucro Presumido, Lucro Real) a partir de indícios na própria nota (ex.: menção "Optante pelo Simples Nacional", "não optante", CSTs, texto de retenção). Você NÃO tem acesso à consulta da Receita. Se a nota não deixar claro o regime, marque regime "Indefinido" e "regime_validar": true — NÃO invente.

ETAPA 3 — REGRAS DE RETENÇÃO (percentuais configurados: ${listaImpostos}):
- SIMPLES NACIONAL: em regra NÃO retém PIS/COFINS/CSLL/IRRF. Mas se o serviço for de natureza previdenciária (${listaServicos}), sinalize que INSS pode ser devido → "inss_validar": true.
- LUCRO PRESUMIDO ou LUCRO REAL: reter PIS, COFINS, CSLL e IRRF sobre o valor bruto, usando os percentuais configurados. Se a soma de PIS+COFINS+CSLL for menor que R$ ${pisoPCC}, marque dispensa do PCC em "observacoes". Se o serviço for previdenciário (lista acima), sinalize INSS → "inss_validar": true.
- Se o regime for Indefinido, NÃO calcule valores: marque tudo para validação humana.

Calcule cada imposto = valor bruto × percentual / 100. Se um imposto não se aplica, use 0 e explique em "observacoes".

REGRA ABSOLUTA DE FORMATO: responda começando com "{" e terminando com "}", sem markdown, sem texto fora do JSON:
{
  "empresa": "...", "cnpj": "...", "numero_nf": "...", "data_emissao": "...",
  "valor_bruto": 0.00, "servico": "...",
  "regime": "Simples Nacional|Lucro Presumido|Lucro Real|Indefinido",
  "regime_validar": false,
  "retencao_obrigatoria": true,
  "retencoes": [ { "imposto": "PIS", "percentual": 0.65, "valor": 0.00, "reter": true, "motivo": "por que retém ou não" } ],
  "inss_validar": false,
  "total_retido": 0.00,
  "inconsistencias": ["campos ilegíveis/ausentes"],
  "observacoes": "resumo e alertas"
}`;

    const content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: nota.data }, title: nota.nome || "Nota" },
      { type: "text", text: instrucoes },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 6000, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Erro na API Anthropic", detalhe: await r.text() });

    const data = await r.json();
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = extrairJSON(texto);
    if (!parsed) {
      return res.status(502).json({ error: `A IA não retornou JSON. Ela respondeu: ${String(texto).slice(0, 400)}` });
    }
    parsed._arquivo = nota.nome;

    // ---------- Memória de empresas (Supabase) ----------
    const supabase = getSupabase();
    if (supabase && parsed.cnpj) {
      const cnpjNorm = normalizarCNPJ(parsed.cnpj);
      if (cnpjNorm) {
        try {
          const { data: empresa } = await supabase
            .from("empresas")
            .select("*")
            .eq("cnpj", cnpjNorm)
            .maybeSingle();

          if (empresa && empresa.regime_confirmado && empresa.regime_tributario) {
            // Empresa já conhecida com regime confirmado: usa ele, sem depender da IA adivinhar de novo.
            const calc = calcularRetencoes(empresa.regime_tributario, parsed.valor_bruto, parsed.servico, impostos, servicosINSS, pisoPCC);
            if (calc) {
              parsed.regime = empresa.regime_tributario;
              parsed.regime_validar = false;
              parsed.retencoes = calc.retencoes;
              parsed.inss_validar = calc.inss_validar;
              parsed.retencao_obrigatoria = calc.retencao_obrigatoria;
              parsed.total_retido = calc.total_retido;
              parsed.observacoes = (parsed.observacoes ? parsed.observacoes + " " : "") + "Regime obtido do histórico (empresa já conhecida).";
            }
          } else if (!parsed.regime_validar && parsed.regime && parsed.regime !== "Indefinido") {
            // Regime novo e identificado com confiança: guarda para a próxima vez.
            await supabase.from("empresas").upsert({
              cnpj: cnpjNorm,
              nome: parsed.empresa || null,
              regime_tributario: parsed.regime,
              regime_confirmado: true,
              atualizado_em: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.error("Supabase (nf-analisar) falhou, seguindo sem memória:", e);
        }
      }
    }
    // ------------------------------------------------------

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
  }
}
