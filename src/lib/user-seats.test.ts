import { readFileSync } from "node:fs"
import { describe, expect, it, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  responses: [] as { data: unknown; error: { message: string } | null }[],
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args })
      return state.responses.shift() ?? { data: null, error: { message: "unexpected" } }
    },
  },
}))

const {
  acceptInviteWithAtomicSeat,
  createInviteWithAtomicSeat,
  createTenantUserWithAtomicSeat,
  reactivateMemberWithAtomicSeat,
} = await import("./user-seats")

beforeEach(() => {
  state.calls.length = 0
  state.responses.length = 0
})

describe("adaptador de assentos atômicos", () => {
  it("manda as quatro portas exclusivamente para RPCs transacionais", async () => {
    state.responses.push(
      { data: [{ invite_id: "invite_1" }], error: null },
      { data: [{ tenant_id: "tenant_1", user_id: "user_1", email: "a@b.com", is_new_user: true }], error: null },
      { data: [{ user_id: "user_2", is_new_user: false }], error: null },
      { data: [{ changed: true, member_role: "agent" }], error: null },
    )

    await createInviteWithAtomicSeat({
      tenantId: "tenant_1", email: "a@b.com", phone: null, role: "agent",
      token: "x".repeat(48), invitedBy: "owner_1", departmentId: null,
    })
    await acceptInviteWithAtomicSeat({ token: "x".repeat(48), fullName: "A", passwordHash: "hash" })
    await createTenantUserWithAtomicSeat({
      tenantId: "tenant_1", fullName: "B", email: "b@b.com", passwordHash: "hash",
      role: "agent", actorId: "god_1",
    })
    await reactivateMemberWithAtomicSeat({ tenantId: "tenant_1", userId: "user_3", actorId: "owner_1" })

    expect(state.calls.map((call) => call.name)).toEqual([
      "criar_convite_com_assento_atomico",
      "aceitar_convite_com_assento_atomico",
      "criar_usuario_tenant_com_assento_atomico",
      "reativar_membro_com_assento_atomico",
    ])
  })

  it("duas tentativas concorrentes chegam como duas transações independentes ao banco", async () => {
    state.responses.push(
      { data: [{ invite_id: "winner" }], error: null },
      { data: null, error: { message: "seat_limit_reached:3:3" } },
    )
    const input = {
      tenantId: "tenant_1", phone: null, role: "agent" as const,
      token: "x".repeat(48), invitedBy: "owner_1", departmentId: null,
    }
    const [first, second] = await Promise.all([
      createInviteWithAtomicSeat({ ...input, email: "first@b.com" }),
      createInviteWithAtomicSeat({ ...input, email: "second@b.com", token: "y".repeat(48) }),
    ])

    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, error: "Limite de usuários atingido. Aumente o teto de usuários e tente novamente." })
    expect(state.calls).toHaveLength(2)
  })
})

describe("contrato SQL do teto duro", () => {
  const migration = readFileSync("supabase/migrations/20260831000200_p0_user_seats_atomic.sql", "utf8")

  it("serializa todas as portas pelo lock do tenant", () => {
    expect(migration.match(/FROM public\.tenants WHERE id = .* FOR UPDATE/g)?.length).toBe(4)
  })

  it("resolve override, plano e default sem usar user_quota", () => {
    expect(migration).toContain("FROM public.tenant_limits")
    expect(migration).toContain("p.limits")
    expect(migration).toContain("WHEN 'trial'      THEN 3")
    expect(migration).toContain("WHEN 'starter'    THEN 5")
    expect(migration).toContain("WHEN 'pro'        THEN 15")
    expect(migration).toContain("WHEN 'enterprise' THEN NULL")
    expect(migration).not.toMatch(/SELECT[^;]*user_quota/i)
  })

  it("conta ativos e somente convites pendentes ainda válidos", () => {
    expect(migration).toContain("tu.active = true")
    expect(migration).toContain("i.accepted_at IS NULL")
    expect(migration).toContain("i.expires_at >= pg_catalog.now()")
  })

  it("aceite é delta zero e não repete o gate de +1", () => {
    const accept = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.aceitar_convite_com_assento_atomico"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.criar_usuario_tenant_com_assento_atomico"),
    )
    expect(accept).not.toContain("seat_limit_reached")
    expect(accept).toContain("ON CONFLICT ON CONSTRAINT tenant_users_tenant_id_user_id_key DO UPDATE")
    expect(accept).toContain("SET accepted_at = pg_catalog.now()")
    // `email` também é coluna OUT da RPC; sem alias, PL/pgSQL trata a referência
    // como ambígua e o primeiro aceite falha em runtime.
    expect(accept).toContain("WHERE p.email = v_invite.email")
    expect(accept).not.toMatch(/FROM public\.profiles WHERE email =/)
  })

  it("fecha deactivate -> invite -> reactivate acima do teto", () => {
    const reactivate = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.reativar_membro_com_assento_atomico"),
      migration.indexOf("ALTER FUNCTION public.user_seat_assert_service_role"),
    )
    expect(reactivate).toContain("v_used := public.user_seat_usage_locked")
    expect(reactivate).toContain("seat_limit_reached")
    expect(reactivate.indexOf("seat_limit_reached")).toBeLessThan(reactivate.indexOf("SET active = true"))
  })

  it("qualifica colunas que colidem com nomes OUT das RPCs", () => {
    expect(migration).toContain("WHERE p.email = v_invite.email")
    expect(migration).toContain("WHERE pa.user_id = p_actor_id")
    expect(migration).not.toMatch(/FROM public\.platform_admins WHERE user_id =/)
  })

  it("mantém browser sem EXECUTE e valida claim service_role", () => {
    expect(migration).toContain("request.jwt.claim.role")
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role")
    expect(migration.match(/GRANT EXECUTE ON FUNCTION public\.(criar|aceitar|reativar)/g)?.length).toBe(4)
  })
})

describe("integração das portas e cobrança", () => {
  it("nenhuma das quatro portas mantém check-then-write em TypeScript", () => {
    const team = readFileSync("src/lib/actions/team.ts", "utf8")
    const accept = readFileSync("src/app/invite/[token]/actions.ts", "utf8")
    const admin = readFileSync("src/lib/actions/admin-users.ts", "utf8")
    const adminInvites = readFileSync("src/lib/actions/admin.ts", "utf8")
    expect(team).toContain("createInviteWithAtomicSeat")
    expect(team).toContain("reactivateMemberWithAtomicSeat")
    expect(accept).toContain("acceptInviteWithAtomicSeat")
    expect(admin).toContain("createTenantUserWithAtomicSeat")
    expect(adminInvites).toContain("createInviteWithAtomicSeat")
    expect(team).not.toContain('checkLimit(tenantId, "users")')
    expect(accept).not.toContain('checkLimit(invite.tenant_id, "users")')
    expect(admin).not.toContain('checkLimit(input.tenantId, "users")')
    const createInviteAction = adminInvites.slice(
      adminInvites.indexOf("export async function createInvite"),
      adminInvites.indexOf("export async function deleteInvite"),
    )
    expect(createInviteAction).not.toContain('.from("invites").insert')
  })

  it("billing continua cobrando ativos acima de plans.user_quota", () => {
    const billing = readFileSync("src/lib/billing.ts", "utf8")
    expect(billing).toContain('.from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true)')
    expect(billing).toContain("Math.max(0, users - plan.user_quota)")
    expect(billing).toContain("plan.extra_user_price_cents")
  })
})
