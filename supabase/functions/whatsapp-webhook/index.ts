import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || ""

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function upsertContato(telefone: string, nomePerfil: string | null) {
  const { data: existente } = await admin
    .from("whatsapp_contatos")
    .select("id")
    .eq("telefone", telefone)
    .maybeSingle()
  if (existente) return existente.id

  const { data: criado, error } = await admin
    .from("whatsapp_contatos")
    .insert({ nome: nomePerfil || telefone, telefone, categoria: "prospect" })
    .select("id")
    .single()
  if (error) throw error
  return criado.id
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode")
    const token = url.searchParams.get("hub.verify_token")
    const challenge = url.searchParams.get("hub.challenge")
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 })
    }
    return json({ error: "Verificação inválida" }, 403)
  }

  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: "JSON inválido" }, 400)
  }

  try {
    const entries = (body.entry as unknown[]) || []
    for (const entry of entries) {
      const changes = ((entry as Record<string, unknown>).changes as unknown[]) || []
      for (const change of changes) {
        const value = (change as Record<string, unknown>).value as Record<string, unknown>
        const contacts = (value?.contacts as Record<string, unknown>[]) || []
        const messages = (value?.messages as Record<string, unknown>[]) || []

        for (const msg of messages) {
          const de = String(msg.from || "")
          if (!de) continue
          const perfil = contacts.find((c) => c.wa_id === de)
          const nomePerfil = (perfil?.profile as Record<string, unknown>)?.name as string | undefined
          const contatoId = await upsertContato(de, nomePerfil || null)

          const texto =
            (msg.text as Record<string, unknown>)?.body ||
            (msg.button as Record<string, unknown>)?.text ||
            null

          await admin.from("whatsapp_mensagens").insert({
            contato_id: contatoId,
            telefone: de,
            direcao: "entrada",
            conteudo: texto ? String(texto) : null,
            tipo: String(msg.type || "texto"),
            wa_message_id: String(msg.id || "") || null,
            status: "recebida",
          })
        }
      }
    }
  } catch (err) {
    console.error("Erro processando webhook do WhatsApp", err)
  }

  return json({ ok: true })
})
