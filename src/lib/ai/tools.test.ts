import { describe, it, expect } from "vitest"
import { parseUpdateContact, buildUpdateContactTool, UPDATE_CONTACT_TOOL_NAME } from "./tools"

describe("parseUpdateContact", () => {
  it("extrai campos presentes, trimando", () => {
    expect(parseUpdateContact('{"name":" Vinicius ","phone":"(11) 99999-8888","document":"123.456.789-00"}')).toMatchObject({
      name: "Vinicius", phone: "(11) 99999-8888", email: null, document: "123.456.789-00", company: null, birthdate: null,
    })
  })

  it("campos ausentes/vazios viram null", () => {
    expect(parseUpdateContact('{"name":"  ","email":"a@b.co","company":"Acme"}')).toMatchObject({
      name: null, phone: null, email: "a@b.co", company: "Acme", document: null, birthdate: null,
    })
  })

  it("nunca lança em JSON inválido", () => {
    expect(parseUpdateContact("não é json")).toMatchObject({ name: null, phone: null, email: null, document: null })
    expect(parseUpdateContact("")).toMatchObject({ name: null, phone: null, email: null, document: null })
  })

  it("ignora tipos não-string", () => {
    expect(parseUpdateContact('{"name":123,"document":true}')).toMatchObject({ name: null, document: null })
  })
})

describe("buildUpdateContactTool", () => {
  it("expõe os 6 campos de identidade, todos opcionais", () => {
    const t = buildUpdateContactTool()
    if (t.type !== "function") throw new Error("esperava tool do tipo function")
    expect(t.function.name).toBe(UPDATE_CONTACT_TOOL_NAME)
    const params = t.function.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(Object.keys(params.properties).sort()).toEqual(["birthdate", "company", "document", "email", "name", "phone"])
    expect(params.required).toEqual([])
  })
})
