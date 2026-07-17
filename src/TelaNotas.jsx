import React, { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { IMPOSTOS, SERVICOS_INSS, PISO_DISPENSA_PCC } from "./impostos-config.js";

// Limite seguro por requisição (bytes do PDF; o base64 infla ~33%).
// Vercel serverless: ~4,5 MB de payload; deixamos folga por causa do JSON envolvente.
const LIMITE_BYTES = 2 * 1024 * 1024; // 2 MB por parte
// Limite de páginas por parte, para evitar timeout da IA analisando muita nota de uma vez.
const LIMITE_PAGINAS = 8;

// Extrai um subconjunto de páginas [ini, fim) de um PDFDocument.
async function extrairPaginas(doc, ini, fim) {
  const sub = await PDFDocument.create();
  const idxs = Array.from({ length: fim - ini }, (_, k) => ini + k);
  const pgs = await sub.copyPages(doc, idxs);
  pgs.forEach((p) => sub.addPage(p));
  return new Uint8Array(await sub.save());
}

// Divide um PDF grande em partes menores que LIMITE_BYTES e com no máximo LIMITE_PAGINAS páginas.
// Divisão adaptativa: se uma parte ainda ficar grande, subdivide de novo.
async function prepararPartes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const docTeste = await PDFDocument.load(bytes, { ignoreEncryption: true });
  // se cabe no limite de tamanho E no limite de páginas, envia inteiro
  if (bytes.length <= LIMITE_BYTES && docTeste.getPageCount() <= LIMITE_PAGINAS) {
    return [{ nome: file.name, bytes }];
  }

  const doc = docTeste;
  const totalPag = doc.getPageCount();
  const baseNome = file.name.replace(/\.pdf$/i, "");
  const partes = [];

  // fila de intervalos [ini, fim) a processar
  const fila = [[0, totalPag]];
  while (fila.length) {
    const [ini, fim] = fila.shift();
    if (fim <= ini) continue;
    const nPags = fim - ini;
    // se ultrapassa limite de páginas, divide sem nem gerar o PDF
    if (nPags > LIMITE_PAGINAS) {
      const meio = Math.floor((ini + fim) / 2);
      fila.unshift([meio, fim]);
      fila.unshift([ini, meio]);
      continue;
    }
    const sub = await extrairPaginas(doc, ini, fim);
    if (sub.length <= LIMITE_BYTES || nPags === 1) {
      partes.push({ nome: `${baseNome} (págs ${ini + 1}-${fim}).pdf`, bytes: sub });
    } else {
      const meio = Math.floor((ini + fim) / 2);
      fila.unshift([meio, fim]);
      fila.unshift([ini, meio]);
    }
  }
  return partes;
}

function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Falha ao ler " + file.name));
    r.readAsDataURL(file);
  });
}
const ehPDF = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const brl = (n) => (typeof n === "number" ? n : parseFloat(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TelaNotas() {
  const [notas, setNotas] = useState([]);
  const [condominio, setCondominio] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [drag, setDrag] = useState(false);

  function addNotas(lista) {
    const todos = Array.from(lista);
    const pdfs = todos.filter(ehPDF);
    const ign = todos.filter((f) => !ehPDF(f));
    setErro(ign.length ? `Ignorado(s) por não ser(em) PDF: ${ign.map((f) => f.name).join(", ")}` : null);
    if (pdfs.length) setNotas((p) => [...p, ...pdfs]);
  }

  async function analisar() {
    setErro(null); setResultado(null);
    if (notas.length === 0) { setErro("Adicione ao menos um arquivo com notas fiscais."); return; }
    setCarregando(true);
    try {
      // 1) prepara: divide os PDFs grandes em partes menores
      setProgresso({ feitos: 0, total: notas.length, etapa: "preparando" });
      const partes = [];
      for (const f of notas) {
        const ps = await prepararPartes(f);
        partes.push(...ps);
      }

      // 2) TRIAGEM: para cada parte, descobre quais páginas são NF.
      //    Depois, monta blocos contíguos de NF para enviar à análise fiscal.
      const totalPartes = partes.length;
      const blocosNF = []; // [{ nome, bytes (PDF só com as páginas NF), origem }]
      let paginasDescartadas = 0;
      let paginasNF = 0;

      for (let i = 0; i < partes.length; i++) {
        setProgresso({ feitos: i, total: totalPartes, etapa: "triando" });
        const p = partes[i];
        const doc = await PDFDocument.load(p.bytes, { ignoreEncryption: true });
        const nPags = doc.getPageCount();

        // chama a triagem
        const respT = await fetch("/api/nf-triar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf: { nome: p.nome, data: bytesToBase64(p.bytes) }, paginaInicial: 1 }),
        });
        const rawT = await respT.text();
        let dataT; try { dataT = JSON.parse(rawT); } catch { throw new Error(`Triagem falhou em "${p.nome}": ${rawT.slice(0, 300)}`); }
        if (!respT.ok) throw new Error(`Triagem falhou em "${p.nome}": ${dataT.error || respT.status}`);

        // encontra intervalos contíguos de páginas NF
        const paginas = dataT.paginas || [];
        const isNF = (t) => String(t || "").toUpperCase() === "NF";
        // normaliza: cria vetor booleano por índice de página (0..nPags-1)
        const marcada = new Array(nPags).fill(false);
        paginas.forEach((pg) => {
          const idx = (pg.n - 1); // triagem começa em 1
          if (idx >= 0 && idx < nPags && isNF(pg.tipo)) marcada[idx] = true;
        });
        // agrupa em intervalos contíguos
        const intervalos = [];
        let ini = -1;
        for (let k = 0; k < nPags; k++) {
          if (marcada[k] && ini < 0) ini = k;
          if ((!marcada[k] || k === nPags - 1) && ini >= 0) {
            const fim = marcada[k] ? k + 1 : k;
            intervalos.push([ini, fim]);
            ini = -1;
          }
        }
        // gera um novo PDF por intervalo (bloco de NFs contíguas)
        for (const [a, b] of intervalos) {
          const sub = await PDFDocument.create();
          const idxs = Array.from({ length: b - a }, (_, k) => a + k);
          const pgs = await sub.copyPages(doc, idxs);
          pgs.forEach((x) => sub.addPage(x));
          const subBytes = new Uint8Array(await sub.save());
          blocosNF.push({
            nome: `${p.nome.replace(/\.pdf$/i, "")} · NF págs ${a + 1}-${b}.pdf`,
            bytes: subBytes,
          });
          paginasNF += (b - a);
        }
        paginasDescartadas += (nPags - marcada.filter(Boolean).length);
      }

      // 3) ANÁLISE FISCAL — só nos blocos de NF
      const totalBlocos = blocosNF.length;
      const itens = [];
      const avisos = [];
      if (totalBlocos === 0) {
        avisos.push("Nenhuma página foi classificada como nota fiscal.");
      }
      for (let i = 0; i < blocosNF.length; i++) {
        setProgresso({ feitos: i, total: totalBlocos, etapa: "analisando" });
        const b = blocosNF[i];
        const resp = await fetch("/api/nf-analisar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nota: { nome: b.nome, data: bytesToBase64(b.bytes) },
            condominio,
            impostos: IMPOSTOS,
            servicosINSS: SERVICOS_INSS,
            pisoPCC: PISO_DISPENSA_PCC,
          }),
        });
        const raw = await resp.text();
        let data; try { data = JSON.parse(raw); } catch { throw new Error(`Falha em "${b.nome}": ${raw.slice(0, 300)}`); }
        if (!resp.ok) throw new Error(`Falha em "${b.nome}": ${data.error || resp.status}`);
        const lista = Array.isArray(data.notas) ? data.notas : [data];
        lista.forEach((n) => { n._arquivo = b.nome; itens.push(n); });
        if (data._truncado) avisos.push(`${b.nome}: resposta pode estar incompleta`);
      }

      setResultado({
        condominio, itens, avisos,
        partesTotal: totalPartes,
        blocosNF: totalBlocos,
        paginasNF, paginasDescartadas,
      });
    } catch (e) {
      setErro(String(e.message || e));
    } finally {
      setCarregando(false); setProgresso(null);
    }
  }


  return (
    <>
      <h2 className="tela-titulo">Análise de Notas Fiscais · Retenção</h2>
      <section className="card">
        <label className="campo">
          Condomínio (opcional)
          <input type="text" placeholder="Nome do condomínio" value={condominio}
            onChange={(e) => setCondominio(e.target.value)} />
        </label>

        <div className={"dropzone" + (drag ? " drag" : "")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addNotas(e.dataTransfer.files); }}
          onClick={() => document.getElementById("nfInput").click()}>
          <input id="nfInput" type="file" accept=".pdf,application/pdf" multiple style={{ display: "none" }}
            onChange={(e) => addNotas(e.target.files)} />
          <strong>Arraste as notas fiscais aqui</strong>
          <span>ou clique para selecionar — todas de um mesmo condomínio</span>
        </div>

        {notas.length > 0 && (
          <ul className="filelist">
            {notas.map((f, i) => (
              <li key={i}><span className="fname">📄 {f.name}</span>
                <button className="rm" onClick={() => setNotas((p) => p.filter((_, x) => x !== i))}>remover</button></li>
            ))}
          </ul>
        )}

        <button className="btn-primary" onClick={analisar} disabled={carregando}>
          {carregando ? "Analisando…" : `Analisar ${notas.length} arquivo${notas.length === 1 ? "" : "s"}`}
        </button>
        {progresso && (
          <div className="prog">
            <div className="prog-bar"><div className="prog-fill" style={{ width: `${Math.round((progresso.feitos / progresso.total) * 100)}%` }} /></div>
            <span>{progresso.etapa === "preparando" ? "Preparando arquivos (dividindo PDFs grandes)…" : progresso.etapa === "triando" ? `Triando páginas ${progresso.feitos + 1} de ${progresso.total} (separando NFs de anexos)…` : `Analisando bloco ${progresso.feitos + 1} de ${progresso.total}…`}</span>
          </div>
        )}
        {erro && <div className="erro">{erro}</div>}
      </section>

      {resultado && (
        <section>
          <div className="card" style={{ background: "#eef1f7", borderColor: "var(--navy)" }}>
            <strong style={{ color: "var(--navy)", fontSize: 16 }}>
              {resultado.itens.length} nota{resultado.itens.length === 1 ? "" : "s"} fiscal
              {resultado.itens.length === 1 ? "" : "is"} encontrada
              {resultado.itens.length === 1 ? "" : "s"}
            </strong>
            {resultado.condominio && <span className="muted"> · {resultado.condominio}</span>}
            {(resultado.paginasNF > 0 || resultado.paginasDescartadas > 0) && (
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Triagem: {resultado.paginasNF} página{resultado.paginasNF === 1 ? "" : "s"} de NF analisada{resultado.paginasNF === 1 ? "" : "s"},{" "}
                {resultado.paginasDescartadas} descartada{resultado.paginasDescartadas === 1 ? "" : "s"} (boletos/comprovantes/anexos).
              </p>
            )}
            {resultado.avisos?.length > 0 && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#fef5e7", color: "#b7791f", borderRadius: 6, fontSize: 13 }}>
                <strong>Atenção:</strong> {resultado.avisos.join("; ")}. Considere subir o pacote em arquivos menores se alguma nota faltar.
              </div>
            )}
          </div>

          {/* Relatório detalhado por nota */}
          {resultado.itens.map((it, i) => (
            <div className="card" key={i}>
              <div className="nf-hdr">
                <h3 style={{ margin: 0, color: "var(--navy)" }}>NF {it.numero_nf || "—"}</h3>
                {it.regime_validar || it.regime === "Indefinido"
                  ? <span className="tag-validar">Regime a validar</span>
                  : <span className="tag-regime">{it.regime}</span>}
              </div>
              <div className="nf-dados">
                <div><small>Empresa</small>{it.empresa || "—"}</div>
                <div><small>CNPJ</small>{it.cnpj || "—"}</div>
                <div><small>Emissão</small>{it.data_emissao || "—"}</div>
                <div><small>Valor bruto</small>R$ {brl(it.valor_bruto)}</div>
              </div>
              <p className="nf-serv"><small>Serviço:</small> {it.servico || "—"}</p>

              <table className="fiscal">
                <thead><tr><th>Imposto</th><th>%</th><th>Reter?</th><th>Valor</th><th>Motivo</th></tr></thead>
                <tbody>
                  {(it.retencoes || []).map((r, j) => (
                    <tr key={j}>
                      <td className="cod">{r.imposto}</td>
                      <td className="num">{r.percentual != null ? `${r.percentual}%` : "—"}</td>
                      <td>{r.reter ? "Sim" : "Não"}</td>
                      <td className="num">{r.reter ? `R$ ${brl(r.valor)}` : "—"}</td>
                      <td className="detalhe-td">{r.motivo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="nf-rodape">
                <strong>Total retido: R$ {brl(it.total_retido)}</strong>
                {it.inss_validar && <span className="tag-validar">INSS a validar</span>}
                {it.retencao_obrigatoria === false && <span className="tag-ok">Sem retenção</span>}
              </div>
              {it.inconsistencias?.length > 0 && (
                <div className="criticas"><strong>Inconsistências</strong><ul>{it.inconsistencias.map((x, k) => <li key={k}>{x}</li>)}</ul></div>
              )}
              {it.observacoes && <p className="muted">{it.observacoes}</p>}
            </div>
          ))}

          {/* Consolidado */}
          <div className="card">
            <h3 style={{ marginTop: 0, color: "var(--navy)" }}>Resumo consolidado</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="fiscal">
                <thead>
                  <tr><th>Empresa</th><th>CNPJ</th><th>Regime</th><th>Valor NF</th>
                    {IMPOSTOS.map((im) => <th key={im.chave} className="num">{im.nome}</th>)}
                    <th className="num">Total</th></tr>
                </thead>
                <tbody>
                  {resultado.itens.map((it, i) => {
                    const get = (nome) => {
                      const r = (it.retencoes || []).find((x) => x.imposto === nome);
                      return r && r.reter ? `R$ ${brl(r.valor)}` : "—";
                    };
                    return (
                      <tr key={i}>
                        <td>{it.empresa || "—"}</td>
                        <td>{it.cnpj || "—"}</td>
                        <td>{it.regime_validar ? "validar" : it.regime}</td>
                        <td className="num">R$ {brl(it.valor_bruto)}</td>
                        {IMPOSTOS.map((im) => <td key={im.chave} className="num">{get(im.nome)}</td>)}
                        <td className="num"><strong>R$ {brl(it.total_retido)}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
