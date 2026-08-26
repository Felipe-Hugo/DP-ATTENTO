// api/log.js — registra e lista conferências feitas (condomínio, tipo, responsável).
import { getSupabase } from "./_supabase.js";

export default async function handler(req, res) {
  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: "Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes)." });

  if (req.method === "POST") {
    try {
      const { tipo, condominio, usuario, resumo } = req.body;
      if (!tipo || !condominio || !usuario) {
        return res.status(400).json({ error: "tipo, condominio e usuario são obrigatórios." });
      }
      const { error } = await supabase.from("conferencias_log").insert({
        tipo, condominio: String(condominio).trim(), usuario: String(usuario).trim(), resumo: resumo || null,
      });
      if (error) return res.status(500).json({ error: "Falha ao gravar log", detalhe: error.message });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
    }
  }

  if (req.method === "GET") {
    try {
      const { condominio } = req.query;
      let query = supabase.from("conferencias_log").select("*").order("criado_em", { ascending: false }).limit(200);
      if (condominio) query = query.ilike("condominio", `%${condominio}%`);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: "Falha ao listar", detalhe: error.message });
      return res.status(200).json({ registros: data || [] });
    } catch (e) {
      return res.status(500).json({ error: "Falha interna", detalhe: String(e) });
    }
  }

  return res.status(405).json({ error: "Método não permitido" });
}
