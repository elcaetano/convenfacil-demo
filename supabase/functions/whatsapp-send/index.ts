import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || ""
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || ""

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405)

  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!token) return json({ error: "Sessão ausente" }, 401)

  const { data: callerData, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !callerData?.user) return json({ error: "Sessão inválida" }, 401)

  const nivel = String(callerData.user.app_metadata?.nivel || "")
  if (nivel !== "superadmin") return json({ error: "Sem permissão" }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: "JSON inválido" }, 400)
  }

  const telefone = String(body.telefone || "").replace(/\D/g, "")
  const texto = String(body.texto || "").trim()
  if (!telefone || !texto) return json({ error: "Dados incompletos" }, 400)

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    return json({ error: "WhatsApp ainda não configurado (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)" }, 500)
  }

  const resp = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: telefone,
      type: "text",
      text: { body: texto },
    }),
  })
  const respBody = await resp.json()

  const { data: contato } = await admin
    .from("whatsapp_contatos")
    .select("id")
    .eq("telefone", telefone)
    .maybeSingle()

  await admin.from("whatsapp_mensagens").insert({
    contato_id: contato?.id || null,
    telefone,
    direcao: "saida",
    conteudo: texto,
    tipo: "texto",
    wa_message_id: respBody?.messages?.[0]?.id || null,
    status: resp.ok ? "enviada" : "falhou",
  })

  if (!resp.ok) return json({ error: respBody?.error?.message || "Falha ao enviar" }, 502)
  return json({ ok: true })
})
