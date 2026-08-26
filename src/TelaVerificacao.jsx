import React, { useState, useEffect } from "react";

const TIPO_LABEL = { book: "Book de Terceirizadas", notas: "Notas Fiscais" };

export default function TelaVerificacao() {
  const [filtro, setFiltro] = useState("");
  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  async function carregar(cond) {
    setCarregando(true); setErro(null);
    try {
      const qs = cond ? `?condominio=${encodeURIComponent(cond)}` : "";
      const resp = await fetch(`/api/log${qs}`);
      const raw = await resp.text();
      let data; try { data = JSON.parse(raw); } catch { throw new Error("Resposta inválida do servidor."); }
      if (!resp.ok) throw new Error(data.error || "Erro ao carregar.");
      setRegistros(data.registros || []);
    } catch (e) {
      setErro(String(e.message || e));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregar(""); }, []);

  function buscar(e) {
    e.preventDefault();
    carregar(filtro.trim());
  }

  return (
    <>
      <h2 className="tela-titulo">Verificação de Conferências</h2>
      <section className="card">
        <form onSubmit={buscar} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Filtrar por condomínio…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ccd3e0", fontSize: 14 }}
          />
          <button className="btn-primary" type="submit" style={{ width: "auto", padding: "10px 20px" }}>Buscar</button>
          {filtro && (
            <button type="button" className="rm" onClick={() => { setFiltro(""); carregar(""); }}>limpar</button>
          )}
        </form>

        {carregando && <p className="muted">Carregando…</p>}
        {erro && <div className="erro">{erro}</div>}

        {!carregando && !erro && registros.length === 0 && (
          <p className="muted">Nenhuma conferência encontrada{filtro ? ` para "${filtro}"` : ""}.</p>
        )}

        {!carregando && registros.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="fiscal">
              <thead>
                <tr>
                  <th>Condomínio</th>
                  <th>Tipo</th>
                  <th>Responsável</th>
                  <th>Resumo</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id}>
                    <td>{r.condominio}</td>
                    <td>{TIPO_LABEL[r.tipo] || r.tipo}</td>
                    <td>{r.usuario}</td>
                    <td>{r.resumo || "—"}</td>
                    <td>{new Date(r.criado_em).toLocaleString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
