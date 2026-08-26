import React, { useState, useEffect } from "react";
import TelaBook from "./TelaBook.jsx";
import TelaNotas from "./TelaNotas.jsx";
import TelaVerificacao from "./TelaVerificacao.jsx";

const CHAVE_USUARIO = "attento_dp_usuario";

export default function App() {
  const [tela, setTela] = useState(null); // null = menu, "book", "notas", "verificacao"
  const [usuario, setUsuario] = useState(null);
  const [nomeDigitado, setNomeDigitado] = useState("");

  useEffect(() => {
    const salvo = sessionStorage.getItem(CHAVE_USUARIO);
    if (salvo) setUsuario(salvo);
  }, []);

  function confirmarNome() {
    const nome = nomeDigitado.trim();
    if (!nome) return;
    sessionStorage.setItem(CHAVE_USUARIO, nome);
    setUsuario(nome);
  }

  if (!usuario) {
    return (
      <div className="wrap">
        <header className="hdr">
          <div className="hdr-mark" />
          <div>
            <h1>Conferências · Departamento Pessoal</h1>
            <p className="sub">Attento</p>
          </div>
        </header>
        <section className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
          <h2 style={{ marginTop: 0, color: "var(--navy)", fontSize: 18 }}>Quem está usando o sistema?</h2>
          <p className="muted" style={{ marginTop: -6 }}>Isso identifica suas conferências no histórico. Só perguntamos uma vez por sessão.</p>
          <input
            type="text"
            placeholder="Seu nome"
            value={nomeDigitado}
            onChange={(e) => setNomeDigitado(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmarNome()}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #ccd3e0", fontSize: 15, marginBottom: 14 }}
            autoFocus
          />
          <button className="btn-primary" onClick={confirmarNome} disabled={!nomeDigitado.trim()}>Entrar</button>
        </section>
        <footer className="ft">Attento DP · Conferência assistida por IA · revise sempre antes de protocolar.</footer>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="hdr-mark" />
        <div>
          <h1>Conferências · Departamento Pessoal</h1>
          <p className="sub">Attento · {usuario}</p>
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
          <button className="menu-card" onClick={() => setTela("verificacao")}>
            <span className="menu-ico">🔎</span>
            <strong>Verificação</strong>
            <span className="menu-desc">
              Consulta quais condomínios já foram conferidos, quando e por quem.
            </span>
          </button>
        </div>
      )}

      {tela === "book" && <TelaBook usuario={usuario} />}
      {tela === "notas" && <TelaNotas usuario={usuario} />}
      {tela === "verificacao" && <TelaVerificacao />}

      <footer className="ft">Attento DP · Conferência assistida por IA · revise sempre antes de protocolar.</footer>
    </div>
  );
}
