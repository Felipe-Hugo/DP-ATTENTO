import React, { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { IMPOSTOS, SERVICOS_INSS, PISO_DISPENSA_PCC } from "./impostos-config.js";

// Limite seguro por requisição (bytes do PDF; o base64 infla ~33%).
const LIMITE_BYTES = 3 * 1024 * 1024; // 3 MB

// Divide um PDF grande em partes menores (por páginas) para caber no limite da Vercel.
async function prepararPartes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length <= LIMITE_BYTES) return [{ nome: file.name, bytes }];
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPag = doc.getPageCount();
  const bytesPorPag = bytes.length / totalPag;
  const pagsPorParte = Math.max(1, Math.floor(LIMITE_BYTES / bytesPorPag));
  const partes = [];
  for (let ini = 0; ini < totalPag; ini += pagsPorParte) {
    const fim = Math.min(ini + pagsPorParte, totalPag);
    const sub = await PDFDocument.create();
    const idxs = Array.from({ length: fim - ini }, (_, k) => ini + k);
    const pgs = await sub.copyPages(doc, idxs);
    pgs.forEach((p) => sub.addPage(p));
    const subBytes = await sub.save();
    partes.push({ nome: `${file.name.replace(/\.pdf$/i, "")} (págs ${ini + 1}-${fim}).pdf`, bytes: new Uint8Array(subBytes) });
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
    if (notas.length === 0) { setErro("Adicione ao menos uma nota fiscal."); return; }
    setCarregando(true);
    try {
      // 1) prepara: divide os PDFs grandes em partes menores
      setProgresso({ feitos: 0, total: notas.length, etapa: "preparando" });
      const partes = [];
      for (const f of notas) {
        const ps = await prepararPartes(f);
        partes.push(...ps);
      }

      // 2) analisa parte por parte
      const total = partes.length;
      const itens = [];
      for (let i = 0; i < partes.length; i++) {
        setProgresso({ feitos: i, total, etapa: "analisando" });
        const p = partes[i];
        const base64 = bytesToBase64(p.bytes);
        const resp = await fetch("/api/nf-analisar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nota: { nome: p.nome, data: base64 },
            condominio,
            impostos: IMPOSTOS,
            servicosINSS: SERVICOS_INSS,
            pisoPCC: PISO_DISPENSA_PCC,
          }),
        });
        const raw = await resp.text();
        let data; try { data = JSON.parse(raw); } catch { throw new Error(`Falha em "${p.nome}": ${raw.slice(0, 300)}`); }
        if (!resp.ok) throw new Error(`Falha em "${p.nome}": ${data.error || resp.status}`);
        // a API devolve { notas: [...] } — achata tudo num só resultado
        const lista = Array.isArray(data.notas) ? data.notas : [data];
        lista.forEach((n) => { n._arquivo = p.nome; itens.push(n); });
      }
      setResultado({ condominio, itens });
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
          {carregando ? "Analisando…" : `Analisar ${notas.length} nota${notas.length === 1 ? "" : "s"}`}
        </button>
        {progresso && (
          <div className="prog">
            <div className="prog-bar"><div className="prog-fill" style={{ width: `${Math.round((progresso.feitos / progresso.total) * 100)}%` }} /></div>
            <span>{progresso.etapa === "preparando" ? "Preparando arquivos (dividindo PDFs grandes)…" : `Analisando parte ${progresso.feitos + 1} de ${progresso.total}…`}</span>
          </div>
        )}
        {erro && <div className="erro">{erro}</div>}
      </section>

      {resultado && (
        <section>
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
