import React, { useState } from "react";
import { BOOK_CHECKLIST, BOOK_CONDICIONAIS } from "./checklist.js";

const STATUS = {
  ok: { cor: "#1f9d55", bg: "#e6f4ea", ic: "✓", txt: "OK" },
  pendencia: { cor: "#b7791f", bg: "#fef5e7", ic: "!", txt: "Pendência" },
  critico: { cor: "#c0392b", bg: "#fdecea", ic: "✕", txt: "Crítico" },
  ausente: { cor: "#7a7a7a", bg: "#f0f0f0", ic: "—", txt: "Ausente" },
  nao_aplicavel: { cor: "#5a6b8c", bg: "#eef1f7", ic: "·", txt: "N/A" },
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Falha ao ler " + file.name));
    r.readAsDataURL(file);
  });
}

export default function TelaBook() {
  const [arquivos, setArquivos] = useState([]);
  const [competencia, setCompetencia] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [drag, setDrag] = useState(false);

  const ehPDF = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");

  const addFiles = (lista) => {
    const todos = Array.from(lista);
    const pdfs = todos.filter(ehPDF);
    const ignorados = todos.filter((f) => !ehPDF(f));
    if (ignorados.length) setErro(`Ignorado(s) por não ser(em) PDF: ${ignorados.map((f) => f.name).join(", ")}`);
    else setErro(null);
    if (pdfs.length) setArquivos((p) => [...p, ...pdfs]);
  };

  async function conferir() {
    setErro(null); setResultado(null);
    if (arquivos.length === 0) { setErro("Adicione pelo menos um PDF."); return; }
    setCarregando(true);
    const total = arquivos.length;
    try {
      const analises = [];
      for (let i = 0; i < arquivos.length; i++) {
        setProgresso({ feitos: i, total, etapa: "analisando" });
        const f = arquivos[i];
        const base64 = await fileToBase64(f);
        const resp = await fetch("/api/book-analisar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documento: { nome: f.name, data: base64 },
            checklist: BOOK_CHECKLIST,
            condicionais: BOOK_CONDICIONAIS,
            competencia,
          }),
        });
        const raw = await resp.text();
        let data; try { data = JSON.parse(raw); } catch { throw new Error(`Falha em "${f.name}": ${raw.slice(0, 300)}`); }
        if (!resp.ok) throw new Error(`Falha em "${f.name}": ${data.error || resp.status}`);
        analises.push(data);
      }
      setProgresso({ feitos: total, total, etapa: "consolidando" });
      const respC = await fetch("/api/book-consolidar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analises, checklist: BOOK_CHECKLIST, condicionais: BOOK_CONDICIONAIS, competencia }),
      });
      const rawC = await respC.text();
      let dataC; try { dataC = JSON.parse(rawC); } catch { throw new Error("Consolidação inválida: " + rawC.slice(0, 300)); }
      if (!respC.ok) throw new Error(dataC.error || "Erro na consolidação");
      setResultado(dataC);
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
            <span>{progresso.etapa === "consolidando" ? "Cruzando documentos e consolidando…" : `Analisando documento ${progresso.feitos + 1} de ${progresso.total}…`}</span>
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
                      <span className="clabel">
                        {c.label}
                        {c.obs ? <small className="motivo">{c.obs}</small> : null}
                      </span>
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
