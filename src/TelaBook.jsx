import React, { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { BOOK_CHECKLIST, BOOK_CONDICIONAIS } from "./checklist.js";

const LIMITE_BYTES = 2 * 1024 * 1024;
const LIMITE_PAGINAS = 3;

const STATUS = {
  ok: { cor: "#1f9d55", bg: "#e6f4ea", ic: "✓", txt: "OK" },
  pendencia: { cor: "#b7791f", bg: "#fef5e7", ic: "!", txt: "Pendência" },
  critico: { cor: "#c0392b", bg: "#fdecea", ic: "✕", txt: "Crítico" },
  ausente: { cor: "#7a7a7a", bg: "#f0f0f0", ic: "—", txt: "Ausente" },
  nao_aplicavel: { cor: "#5a6b8c", bg: "#eef1f7", ic: "·", txt: "N/A" },
};

async function extrairPaginas(doc, ini, fim) {
  const sub = await PDFDocument.create();
  const idxs = Array.from({ length: fim - ini }, (_, k) => ini + k);
  const pgs = await sub.copyPages(doc, idxs);
  pgs.forEach((p) => sub.addPage(p));
  return new Uint8Array(await sub.save());
}

async function prepararPartes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const docTeste = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (bytes.length <= LIMITE_BYTES && docTeste.getPageCount() <= LIMITE_PAGINAS) {
    return [{ nome: file.name, bytes }];
  }
  const doc = docTeste;
  const totalPag = doc.getPageCount();
  const baseNome = file.name.replace(/\.pdf$/i, "");
  const partes = [];
  const fila = [[0, totalPag]];
  while (fila.length) {
    const [ini, fim] = fila.shift();
    if (fim <= ini) continue;
    const nPags = fim - ini;
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

export default function TelaBook() {
  const [arquivos, setArquivos] = useState([]);
  const [competencia, setCompetencia] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [drag, setDrag] = useState(false);

  const addFiles = (lista) => {
    const pdfs = Array.from(lista).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
    setArquivos((p) => [...p, ...pdfs]);
  };

    async function conferir() {
    setErro(null); setResultado(null);
    if (arquivos.length === 0) { setErro("Adicione pelo menos um PDF."); return; }
    setCarregando(true);
    try {
      // 1) prepara: divide qualquer PDF grande em partes menores
      setProgresso({ feitos: 0, total: arquivos.length, etapa: "preparando" });
      const partes = [];
      for (const f of arquivos) {
        const ps = await prepararPartes(f);
        partes.push(...ps);
      }

      // 2) analisa parte por parte
      const total = partes.length;
      const analises = [];
      for (let i = 0; i < partes.length; i++) {
        setProgresso({ feitos: i, total, etapa: "analisando" });
        const p = partes[i];
        const base64 = bytesToBase64(p.bytes);
        const resp = await fetch("/api/book-analisar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documento: { nome: p.nome, data: base64 },
            checklist: BOOK_CHECKLIST,
            condicionais: BOOK_CONDICIONAIS,
            competencia,
          }),
        });
        const raw = await resp.text();
        let data; try { data = JSON.parse(raw); } catch { throw new Error(`Falha em "${p.nome}": ${raw.slice(0, 120)}`); }
        if (!resp.ok) throw new Error(`Falha em "${p.nome}": ${data.error || resp.status}`);
        analises.push(data);
      }

      // 3) agrupa as análises por terceirizada (cnpj, ou nome se não tiver cnpj)
      const grupos = new Map();
      for (const a of analises) {
        const chave = (a.terceirizada?.cnpj || a.terceirizada?.nome || "desconhecida").trim().toUpperCase();
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(a);
      }
      const listaGrupos = Array.from(grupos.values());

      // 4) consolida grupo por grupo (chamadas pequenas, sem risco de timeout)
      const terceirizadasFinal = [];
      const resumos = [];
      let competenciaDetectada = null;
      for (let i = 0; i < listaGrupos.length; i++) {
        setProgresso({ feitos: i, total: listaGrupos.length, etapa: "consolidando" });
        const respC = await fetch("/api/book-consolidar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analises: listaGrupos[i], checklist: BOOK_CHECKLIST, condicionais: BOOK_CONDICIONAIS, competencia }),
        });
        const rawC = await respC.text();
        let dataC; try { dataC = JSON.parse(rawC); } catch { throw new Error(`Consolidação inválida (lote ${i + 1}): ${rawC.slice(0, 120)}`); }
        if (!respC.ok) throw new Error(`Erro na consolidação (lote ${i + 1}): ${dataC.error || respC.status}`);
        if (dataC.competencia_detectada && !competenciaDetectada) competenciaDetectada = dataC.competencia_detectada;
        if (dataC.resumo_geral) resumos.push(dataC.resumo_geral);
        (dataC.terceirizadas || []).forEach((t) => terceirizadasFinal.push(t));
      }

      setResultado({
        competencia_detectada: competenciaDetectada,
        terceirizadas: terceirizadasFinal,
        resumo_geral: resumos.join(" "),
      });
    } catch (e) {
      setErro(String(e.message || e));
    } finally {
      setCarregando(false); setProgresso(null);
    }
  }

        <button className="btn-primary" onClick={conferir} disabled={carregando}>
          {carregando ? "Processando…" : `Conferir book (${arquivos.length} arquivo${arquivos.length === 1 ? "" : "s"})`}
        </button>

        {progresso && (
          <div className="prog">
            <div className="prog-bar"><div className="prog-fill" style={{ width: `${Math.round((progresso.feitos / progresso.total) * 100)}%` }} /></div>
            <span>{progresso.etapa === "preparando" ? "Preparando arquivos (dividindo PDFs grandes)…" : progresso.etapa === "consolidando" ? "Cruzando documentos e consolidando…" : `Analisando parte ${progresso.feitos + 1} de ${progresso.total}…`}</span>
          </div>
        )}
        {erro && <div className="erro">{erro}</div>}
      </section>

      {resultado && (
        <section>
          <div className="card">
            <h3 style={{ marginTop: 0, color: "var(--navy)" }}>Resultado</h3>
            {resultado.competencia_detectada && <p className="muted">Competência detectada: <strong>{resultado.competencia_detectada}</strong></p>}
            <p>{resultado.resumo_geral}</p>
          </div>

          {(resultado.terceirizadas || []).map((t, ti) => (
            <div className="card" key={ti}>
              <div className="terc-hdr">
                <div><h3 style={{ margin: 0, color: "var(--navy)" }}>{t.nome}</h3>{t.cnpj && <span className="cnpj">CNPJ {t.cnpj}</span>}</div>
                <div className="score"><span>{t.score}</span><small>/100</small></div>
              </div>
              {t.pendencias?.length > 0 && (
                <div className="criticas"><strong>Pendências</strong><ul>{t.pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
              )}
              <h4>Checklist (ordem do book)</h4>
              <ol className="check">
                {(t.checklist || []).map((c, i) => {
                  const s = STATUS[c.status] || STATUS.ausente;
                  return (
                    <li key={i}>
                      <span className="badge" style={{ color: s.cor, background: s.bg }}>{s.ic} {s.txt}</span>
                      <span className="clabel">{c.label}{c.obs ? <small> — {c.obs}</small> : null}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
