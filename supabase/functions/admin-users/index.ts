import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const ALLOWED_LEVELS = new Set(["operador", "gerente", "admin", "superadmin"])

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    })
  }
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: "JSON inválido" }, 400)
  }

  const authHeader = req.headers.get("Authorization") || ""
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!token) return json({ error: "Sessão ausente" }, 401)

  const { data: callerData, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !callerData?.user) return json({ error: "Sessão inválida" }, 401)

  const callerMeta = callerData.user.app_metadata || {}
  const callerNivel = String(callerMeta.nivel || "")
  const callerClienteId = callerMeta.cliente_id ? String(callerMeta.cliente_id) : null
  if (callerNivel !== "admin" && callerNivel !== "superadmin") {
    return json({ error: "Sem permissão" }, 403)
  }

  const action = String(body.action || "")

  if (action === "create") {
    const nivelAlvo = String(body.nivel || "operador")
    if (!ALLOWED_LEVELS.has(nivelAlvo)) return json({ error: "Nível inválido" }, 400)
    if (callerNivel !== "superadmin" && nivelAlvo === "superadmin") {
      return json({ error: "Somente o Master pode criar outro Master" }, 403)
    }

    const clienteIdAlvo =
      callerNivel === "superadmin"
        ? body.cliente_id
          ? String(body.cliente_id)
          : null
        : callerClienteId

    if (nivelAlvo !== "superadmin" && !clienteIdAlvo) {
      return json({ error: "Usuário sem loja associada" }, 400)
    }
    if (nivelAlvo === "superadmin" && clienteIdAlvo) {
      return json({ error: "O usuário Master não pode pertencer a uma loja" }, 400)
    }

    const email = String(body.email || "").trim().toLowerCase()
    const password = String(body.password || "")
    const nome = String(body.nome || "").trim()
    if (!email || !password || !nome) return json({ error: "Dados incompletos" }, 400)
    if (password.length < 8) return json({ error: "A senha deve ter pelo menos 8 caracteres" }, 400)

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { nivel: nivelAlvo, cliente_id: clienteIdAlvo },
    })
    if (createErr) return json({ error: createErr.message }, 400)

    const { error: insertErr } = await admin.from("usuarios").insert({
      id: created.user.id,
      nome,
      email,
      senha: "",
      nivel: nivelAlvo,
      ativo: true,
      cliente_id: clienteIdAlvo,
    })
    if (insertErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: insertErr.message }, 400)
    }
    return json({ ok: true, id: created.user.id })
  }

  if (action === "delete") {
    const alvoId = String(body.id || "")
    if (!alvoId) return json({ error: "ID obrigatório" }, 400)
    if (alvoId === callerData.user.id) return json({ error: "Você não pode excluir sua própria conta" }, 400)

    const { data: alvoRow } = await admin
      .from("usuarios")
      .select("id,nivel,cliente_id")
      .eq("id", alvoId)
      .single()
    if (!alvoRow) return json({ error: "Usuário não encontrado" }, 404)
    if (callerNivel !== "superadmin" && alvoRow.cliente_id !== callerClienteId) {
      return json({ error: "Sem permissão" }, 403)
    }
    if (callerNivel !== "superadmin" && alvoRow.nivel === "superadmin") {
      return json({ error: "Sem permissão" }, 403)
    }

    const { error: authDeleteErr } = await admin.auth.admin.deleteUser(alvoId)
    if (authDeleteErr) return json({ error: authDeleteErr.message }, 400)
    await admin.from("usuarios").delete().eq("id", alvoId)
    return json({ ok: true })
  }

  if (action === "reset_password") {
    const alvoId = String(body.id || "")
    const novaSenha = String(body.password || "")
    if (!alvoId || !novaSenha) return json({ error: "Dados incompletos" }, 400)
    if (novaSenha.length < 8) return json({ error: "A senha deve ter pelo menos 8 caracteres" }, 400)

    const { data: alvoRow } = await admin
      .from("usuarios")
      .select("id,nivel,cliente_id")
      .eq("id", alvoId)
      .single()
    if (!alvoRow) return json({ error: "Usuário não encontrado" }, 404)
    if (callerNivel !== "superadmin" && alvoRow.cliente_id !== callerClienteId) {
      return json({ error: "Sem permissão" }, 403)
    }
    if (callerNivel !== "superadmin" && alvoRow.nivel === "superadmin") {
      return json({ error: "Sem permissão" }, 403)
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(alvoId, {
      password: novaSenha,
    })
    if (updateErr) return json({ error: updateErr.message }, 400)
    return json({ ok: true })
  }

  return json({ error: "Ação desconhecida" }, 400)
})
