import React, { useState } from "react";
import TelaBook from "./TelaBook.jsx";
import TelaNotas from "./TelaNotas.jsx";

export default function App() {
  const [tela, setTela] = useState(null); // null = menu, "book", "dctf"

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="hdr-mark" />
        <div>
          <h1>Conferências · Departamento Pessoal</h1>
          <p className="sub">Attento</p>
        </div>
        {tela && (
          <button className="voltar" onClick={() => setTela(null)}>← Início</button>
        )}
      </header>

      {!tela && (
        <div className="menu">
          <button className="menu-card" onClick={() => setTela("book")}>
            <span className="menu-ico">📋</span>
            <strong>Conferência de Book</strong>
            <span className="menu-desc">
              Confere se a documentação das terceirizadas está de acordo com a
              lista padrão do book, na ordem correta.
            </span>
          </button>
          <button className="menu-card" onClick={() => setTela("notas")}>
            <span className="menu-ico">🧾</span>
            <strong>Análise de Notas Fiscais</strong>
            <span className="menu-desc">
              Lê as notas de um condomínio, identifica o regime tributário e
              calcula as retenções (PIS, COFINS, CSLL, IRRF, INSS).
            </span>
          </button>
        </div>
      )}

      {tela === "book" && <TelaBook />}
      {tela === "notas" && <TelaNotas />}

      <footer className="ft">Attento DP · Conferência assistida por IA · revise sempre antes de protocolar.</footer>
    </div>
  );
}
