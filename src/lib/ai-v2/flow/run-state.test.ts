import { expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
vi.mock("server-only", () => ({}))
const requests: URL[] = []
const supabaseAdmin = createClient("http://127.0.0.1:1", "local-test-key", {
  auth: { persistSession: false },
  global: { fetch: async (input) => {
    requests.push(new URL(String(input)))
    return new Response(JSON.stringify([{ id: "run" }]), { status: 200, headers: { "Content-Type": "application/json" } })
  } },
})
vi.mock("@/lib/supabase", () => ({ supabaseAdmin }))
const { updateFlowRun } = await import("./run-state")

it("serializa JSONB no cliente Supabase real, sem converter objeto em [object Object]", async () => {
  const run = { id: "run", status: "waiting", variables: { __run_generation: "generation", answer: "João" } } as any
  const before = structuredClone(run.variables)
  await updateFlowRun("tenant", run, { status: "done" })
  expect(requests[0].searchParams.get("variables")).toBe(`eq.${JSON.stringify(before)}`)
  expect(requests[0].searchParams.get("tenant_id")).toBe("eq.tenant")
  expect(requests[0].searchParams.get("status")).toBe("eq.waiting")
})
