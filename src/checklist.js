// ============================================================
// Lista de documentos do BOOK DE TERCEIRIZADAS — Attento DP
// Ordem cronológica conforme documento de referência.
// Esta é a "memória" da IA para a Função 2 (BOOK).
// ============================================================

export const BOOK_CHECKLIST = [
  { ordem: 1, label: "Protocolo" },
  { ordem: 2, label: "Extrato da folha" },
  { ordem: 3, label: "Holerites" },
  { ordem: 4, label: "Folhas de ponto" },
  { ordem: 5, label: "Comprovante do pagamento da guia FGTS" },
  { ordem: 6, label: "Guia FGTS" },
  { ordem: 7, label: "Comprovante do pagamento da guia DCTF" },
  { ordem: 8, label: "Vale transporte — relatório do pedido e comprovante do pagamento" },
  { ordem: 9, label: "Vale alimentação — relatório do pedido e comprovante de pagamento" },
  { ordem: 10, label: "Seguro e comprovante do pagamento" },
  { ordem: 11, label: "Detalhamento do FGTS" },
  { ordem: 12, label: "Recibo de entrega da declaração de débitos e créditos tributários federais — DCTFWeb" },
  { ordem: 13, label: "Relatório da declaração completa — DCTFWeb" },
  { ordem: 14, label: "Certidão da Receita Federal" },
  { ordem: 15, label: "Certidão do FGTS" },
  { ordem: 16, label: "Certidão trabalhista" },
  { ordem: 17, label: "Comprovantes de pagamento de salário" },
  { ordem: 18, label: "Recibo de férias e comprovante do pagamento" },
  { ordem: 19, label: "Rescisão, comprovante do pagamento, multa do FGTS, aviso de dispensa ou pedido do desligamento" },
];

// Documentos que só são exigidos quando há o evento na competência.
// Ausência sem o evento não é pendência crítica.
export const BOOK_CONDICIONAIS = [18, 19];

export const BRAND = { navy: "#001848", lime: "#90c018" };
