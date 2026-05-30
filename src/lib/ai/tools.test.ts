import { describe, it, expect } from "vitest"
import { parseUpdateContact, buildUpdateContactTool, UPDATE_CONTACT_TOOL_NAME } from "./tools"

describe("parseUpdateContact", () => {
  it("extrai campos presentes, trimando", () => {
    expect(parseUpdateContact('{"name":" Vinicius ","phone":"(11) 99999-8888"}')).toEqual({
      name: "Vinicius", phone: "(11) 99999-8888", email: null,
    })
  })

  it("campos ausentes/vazios viram null", () => {
    expect(parseUpdateContact('{"name":"  ","email":"a@b.co"}')).toEqual({
      name: null, phone: null, email: "a@b.co",
    })
  })

  it("nunca lança em JSON inválido", () => {
    expect(parseUpdateContact("não é json")).toEqual({ name: null, phone: null, email: null })
    expect(parseUpdateContact("")).toEqual({ name: null, phone: null, email: null })
  })

  it("ignora tipos não-string", () => {
    expect(parseUpdateContact('{"name":123,"phone":true}')).toEqual({ name: null, phone: null, email: null })
  })
})

describe("buildUpdateContactTool", () => {
  it("expõe os 3 campos, todos opcionais", () => {
    const t = buildUpdateContactTool()
    if (t.type !== "function") throw new Error("esperava tool do tipo function")
    expect(t.function.name).toBe(UPDATE_CONTACT_TOOL_NAME)
    const params = t.function.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(Object.keys(params.properties).sort()).toEqual(["email", "name", "phone"])
    expect(params.required).toEqual([])
  })
})
