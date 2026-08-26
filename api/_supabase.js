// api/_supabase.js — cliente compartilhado do Supabase (memória de empresas/terceirizadas).
// Se as variáveis de ambiente não estiverem configuradas, retorna null e os endpoints
// continuam funcionando normalmente — só sem a camada de memória.
import { createClient } from "@supabase/supabase-js";

let cliente = null;

export function getSupabase() {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cliente = createClient(url, key, { auth: { persistSession: false } });
  return cliente;
}

export function normalizarCNPJ(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}
