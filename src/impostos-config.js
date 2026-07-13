// ============================================================
// CONFIGURAÇÃO DE RETENÇÃO DE IMPOSTOS — Análise de Notas Fiscais
// Edite aqui os nomes, percentuais e regras. O resto do app usa isto.
// Percentuais são os padrões da legislação; ajuste se necessário.
// ============================================================

// Impostos federais retidos de Lucro Presumido / Lucro Real (PCC + IRRF).
// Percentuais sobre o valor bruto da nota.
export const IMPOSTOS = [
  { chave: "PIS", nome: "PIS", percentual: 0.65 },
  { chave: "COFINS", nome: "COFINS", percentual: 3.0 },
  { chave: "CSLL", nome: "CSLL", percentual: 1.0 },
  { chave: "IRRF", nome: "IRRF", percentual: 1.5 },
  // INSS é calculado à parte (regra previdenciária por tipo de serviço).
  { chave: "INSS", nome: "INSS", percentual: 11.0 },
];

// Piso de dispensa do PCC (PIS+COFINS+CSLL): abaixo deste valor de retenção, dispensa.
// A IN RFB usa R$ 10,00 como referência de dispensa do DARF de PCC.
export const PISO_DISPENSA_PCC = 10.0;

// Tipos de serviço que ACENDEM alerta de retenção previdenciária (INSS),
// tanto para Simples quanto para Lucro Presumido/Real.
export const SERVICOS_INSS = [
  "obras", "construção", "construcao", "construção civil",
  "apoio a edifícios", "apoio a edificios",
  "manutenção predial", "manutencao predial",
  "manutenção", "manutencao", "limpeza", "conservação", "conservacao",
  "vigilância", "vigilancia", "portaria", "zeladoria",
];

// Regimes tributários reconhecidos.
export const REGIMES = ["Simples Nacional", "Lucro Presumido", "Lucro Real", "Outro"];

export const BRAND = { navy: "#001848", lime: "#90c018" };
