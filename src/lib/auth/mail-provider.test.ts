import { describe, expect, it } from "vitest"
import { mailProviderFor } from "./mail-provider"

describe("mailProviderFor", () => {
  it("Gmail abre a conta certa e busca o código em qualquer pasta (inclui spam)", () => {
    const p = mailProviderFor("  Vinicius.Pena@Gmail.com ")
    expect(p?.name).toBe("Gmail")
    expect(p?.url).toBe("https://mail.google.com/mail/?authuser=vinicius.pena%40gmail.com#search/in%3Aanywhere+newer_than%3A1d+Kora")
  })

  it("reconhece os provedores comuns no Brasil", () => {
    expect(mailProviderFor("a@hotmail.com")?.name).toBe("Outlook")
    expect(mailProviderFor("a@outlook.com.br")?.name).toBe("Outlook")
    expect(mailProviderFor("a@yahoo.com.br")?.name).toBe("Yahoo Mail")
    expect(mailProviderFor("a@icloud.com")?.name).toBe("iCloud Mail")
  })

  it("e-mail de empresa ou inválido não ganha atalho", () => {
    expect(mailProviderFor("ana@clinicasorriso.com.br")).toBeNull()
    expect(mailProviderFor("gmail.com")).toBeNull()
    expect(mailProviderFor("@gmail.com")).toBeNull()
    expect(mailProviderFor("ana@")).toBeNull()
    expect(mailProviderFor("")).toBeNull()
  })

  it("o e-mail entra codificado — não injeta nada no endereço", () => {
    const url = mailProviderFor("a+b&c#d@gmail.com")!.url
    expect(url.startsWith("https://mail.google.com/mail/?authuser=a%2Bb%26c%23d%40gmail.com#search/")).toBe(true)
  })
})
