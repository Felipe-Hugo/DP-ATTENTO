import React, { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { BOOK_CHECKLIST, BOOK_CONDICIONAIS } from "./checklist.js";

const LIMITE_BYTES = 2 * 1024 * 1024;
const LIMITE_PAGINAS = 3;
const LOTE_PARALELO = 4;
const TENTATIVAS = 3;

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

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function chamarComRetry(url, body, rotulo) {
  let ultimoErro = null;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await resp.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error(`${rotulo}: resposta inválida — ${raw.slice(0, 120)}`); }
      if (!resp.ok) throw new Error(`${rotulo}: ${data.error || resp.status}`);
      return data;
    } catch (e) {
      ultimoErro = e;
      if (t < TENTATIVAS) await espera(1500 * t);
    }
  }
  throw ultimoErro;
}

async function rodarEmParalelo(itens, executar, aoTerminarUma) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  let feitos = 0;
  async function trabalhador() {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await executar(itens[i], i);
      feitos++;
      aoTerminarUma?.(feitos);
    }
  }
  const n = Math.min(LOTE_PARALELO, itens.length);
  await Promise.all(Array.from({ length: n }, trabalhador));
  return resultados;
}

async function registrarLog(payload) {
  try {
    await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // falha no log não deve travar a experiência do usuário
  }
}

export default function TelaBook({ usuario }) {
  const [arquivos, setArquivos] = useState([]);
  const [condominio, setCondominio] = useState("");
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
    if (!condominio.trim()) { setErro("Informe o condomínio antes de conferir."); return; }
    if (arquivos.length === 0) { setErro("Adicione pelo menos um PDF."); return; }
    setCarregando(true);
    try {
      setProgresso({ feitos: 0, total: arquivos.length, etapa: "preparando" });
      const partes = [];
      for (const f of arquivos) {
        const ps = await prepararPartes(f);
        partes.push(...ps);
      }

      const total = partes.length;
      setProgresso({ feitos: 0, total, etapa: "analisando" });
      const analises = await rodarEmParalelo(
        partes,
        (p) => chamarComRetry(
          "/api/book-analisar",
          {
            documento: { nome: p.nome, data: bytesToBase64(p.bytes) },
            checklist: BOOK_CHECKLIST,
            condicionais: BOOK_CONDICIONAIS,
            competencia,
          },
          `Falha em "${p.nome}"`
        ),
        (feitos) => setProgresso({ feitos, total, etapa: "analisando" })
      );

      const grupos = new Map();
      for (const a of analises) {
        const chave = (a.terceirizada?.cnpj || a.terceirizada?.nome || "desconhecida").trim().toUpperCase();
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(a);
      }
      const listaGrupos = Array.from(grupos.values());

      setProgresso({ feitos: 0, total: listaGrupos.length, etapa: "consolidando" });
      const consolidados = await rodarEmParalelo(
        listaGrupos,
        (grupo, i) => chamarComRetry(
          "/api/book-consolidar",
          { analises: grupo, checklist: BOOK_CHECKLIST, condicionais: BOOK_CONDICIONAIS, competencia },
          `Consolidação (lote ${i + 1})`
        ),
        (feitos) => setProgresso({ feitos, total: listaGrupos.length, etapa: "consolidando" })
      );

      const terceirizadasFinal = [];
      const resumos = [];
      let competenciaDetectada = null;
      for (const dataC of consolidados) {
        if (dataC.competencia_detectada && !competenciaDetectada) competenciaDetectada = dataC.competencia_detectada;
        if (dataC.resumo_geral) resumos.push(dataC.resumo_geral);
        (dataC.terceirizadas || []).forEach((t) => terceirizadasFinal.push(t));
      }

      setResultado({
        competencia_detectada: competenciaDetectada,
        terceirizadas: terceirizadasFinal,
        resumo_geral: resumos.join(" "),
      });

      const scoreMedio = terceirizadasFinal.length
        ? Math.round(terceirizadasFinal.reduce((s, t) => s + (t.score || 0), 0) / terceirizadasFinal.length)
        : null;
      registrarLog({
        tipo: "book",
        condominio: condominio.trim(),
        usuario,
        resumo: `${terceirizadasFinal.length} terceirizada(s)${scoreMedio != null ? ` — score médio ${scoreMedio}` : ""}`,
      });
    } catch (e) {
      setErro(String(e.message || e));
    } finally {
      setCarregando(false); setProgresso(null);
    }
  }

  return (
    <>
      <h2 className="tela-titulo">Conferência de Book de Terceirizadas</h2>
      <section className="card">
        <label className="campo">
          Condomínio
          <input type="text" placeholder="Nome do condomínio" value={condominio}
            onChange={(e) => setCondominio(e.target.value)} />
        </label>

        <label className="campo">
          Competência de referência
          <input type="text" placeholder="MM/AAAA (opcional)" value={competencia}
            onChange={(e) => setCompetencia(e.target.value)} />
        </label>

        <div className={"dropzone" + (drag ? " drag" : "")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
          onClick={() => document.getElementById("bookInput").click()}>
          <input id="bookInput" type="file" accept=".pdf,application/pdf" multiple style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)} />
          <strong>Arraste os PDFs do book aqui</strong>
          <span>ou clique para selecionar — pode incluir várias terceirizadas</span>
        </div>

        {arquivos.length > 0 && (
          <ul className="filelist">
            {arquivos.map((f, i) => (
              <li key={i}>
                <span className="fname">📄 {f.name}</span>
                <button className="rm" onClick={() => setArquivos((p) => p.filter((_, x) => x !== i))}>remover</button>
              </li>
            ))}
          </ul>
        )}

        <button className="btn-primary" onClick={conferir} disabled={carregando}>
          {carregando ? "Processando…" : `Conferir book (${arquivos.length} arquivo${arquivos.length === 1 ? "" : "s"})`}
        </button>

        {progresso && (
          <div className="prog">
            <div className="prog-bar"><div className="prog-fill" style={{ width: `${Math.round((progresso.feitos / progresso.total) * 100)}%` }} /></div>
            <span>{progresso.etapa === "preparando" ? "Preparando arquivos (dividindo PDFs grandes)…" : progresso.etapa === "consolidando" ? `Consolidando ${progresso.feitos} de ${progresso.total} lote(s)…` : `Analisadas ${progresso.feitos} de ${progresso.total} partes (${LOTE_PARALELO} ao mesmo tempo)…`}</span>
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
