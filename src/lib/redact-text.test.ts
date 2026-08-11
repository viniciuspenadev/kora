// ═══════════════════════════════════════════════════════════════
// O redator de texto livre — o que NÃO pode sobreviver a ele
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Este teste existe porque o alvo é uma COLUNA, não um log. Erro persistido é
//    consultável e retido; se ele carregar identidade, a gente criou depósito de dado
//    pessoal sem nunca ter declarado um. Cada caso abaixo é uma mensagem que um gateway
//    real pode devolver.

import { describe, it, expect } from "vitest"
import { redigirTexto, redigirObjeto } from "./redact-text"

describe("credenciais não sobrevivem", () => {
  it("JWT vira marcador", () => {
    const s = redigirTexto("falha: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc-def_123")!
    expect(s).toContain("[jwt]")
    expect(s).not.toContain("eyJhbGci")
  })

  it("token de plataforma vira marcador", () => {
    const s = redigirTexto("401 usando sbp_618e0ee9635388b62db914e2230d74cc")!
    expect(s).not.toMatch(/sbp_[A-Za-z0-9]/)
  })

  it("header Authorization não vaza o valor", () => {
    const s = redigirTexto("request failed: Bearer abc123def456ghi789")!
    expect(s).toContain("Bearer [credencial]")
    expect(s).not.toContain("abc123def456")
  })

  it("query string inteira é descartada — é onde credencial e identidade viajam juntas", () => {
    const s = redigirTexto("GET /v3/payments?apikey=segredo&customer=cus_9&email=a@b.com falhou")!
    expect(s).toContain("?[query]")
    expect(s).not.toContain("segredo")
    expect(s).not.toContain("a@b.com")
  })
})

describe("identidade não sobrevive", () => {
  it("e-mail", () => {
    expect(redigirTexto("cliente maria.silva+x@empresa.com.br recusou")).not.toContain("@empresa")
  })

  it("CPF com e sem pontuação", () => {
    expect(redigirTexto("titular 123.456.789-09 inválido")).toContain("[cpf]")
    expect(redigirTexto("titular 12345678909 inválido")).toContain("[cpf]")
  })

  it("CNPJ", () => {
    expect(redigirTexto("emitente 12.345.678/0001-95")).toContain("[cnpj]")
  })

  it("telefone brasileiro", () => {
    expect(redigirTexto("envio para +55 11 98765-4321 falhou")).toContain("[telefone]")
  })

  it("número que parece cartão", () => {
    const s = redigirTexto("card 4242 4242 4242 4242 declined")!
    expect(s).not.toContain("4242 4242")
  })
})

describe("o que PRECISA sobreviver", () => {
  // ⚠️ Redator que apaga tudo é tão inútil quanto redator nenhum: ninguém investiga um
  //    incidente lendo "[opaco] [opaco] [opaco]".
  it("o UUID fica — é ele que liga o erro ao tenant/fatura/evento", () => {
    const id = "f6b1f665-98d0-4b2b-8c66-e92c3b8b29c2"
    expect(redigirTexto(`tenant ${id} sem assinatura`)).toContain(id)
  })

  it("status e código técnico ficam", () => {
    const s = redigirTexto("AsaasError 400 invalid_dueDate")!
    expect(s).toContain("400")
    expect(s).toContain("invalid_dueDate")
  })
})

describe("forma da saída", () => {
  it("só a primeira linha — stack trace não acrescenta e multiplica o risco", () => {
    const s = redigirTexto("boom\n  at foo (/app/src/x.ts:10)\n  at bar")!
    expect(s).toBe("boom")
  })

  it("tem teto de tamanho", () => {
    expect(redigirTexto("x".repeat(5000))!.length).toBeLessThanOrEqual(501)
  })

  it("vazio e nulo viram null, não string vazia", () => {
    expect(redigirTexto(null)).toBeNull()
    expect(redigirTexto("   ")).toBeNull()
  })

  it("Error e objeto viram texto sem explodir", () => {
    expect(redigirTexto(new Error("falhou"))).toContain("falhou")
  })
})

describe("objeto (o `meta` do livro de execuções)", () => {
  it("redige valores de texto em profundidade", () => {
    const r = redigirObjeto({ fase: "cobranca", detalhe: { erro: "cliente a@b.com" } }) as {
      fase: string; detalhe: { erro: string }
    }
    expect(r.fase).toBe("cobranca")
    expect(r.detalhe.erro).toContain("[email]")
  })

  it("números e contagens passam intactos — é o que a gente quer medir", () => {
    const r = redigirObjeto({ processados: 42, ms: 1234 }) as Record<string, number>
    expect(r.processados).toBe(42)
    expect(r.ms).toBe(1234)
  })
})
