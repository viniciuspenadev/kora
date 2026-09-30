import { describe, expect, it } from "vitest"
import { cropPixels, FULL_CROP, isEditableImage } from "./image-attachments"

describe("coordenadas do recorte", () => {
  it("preserva dimensão original e calcula recorte sem esticar a imagem", () => {
    expect(cropPixels(FULL_CROP, 400, 240)).toEqual({ x: 0, y: 0, width: 400, height: 240 })
    expect(cropPixels({ x: .1, y: .25, width: .5, height: .5 }, 400, 240)).toEqual({ x: 40, y: 60, width: 200, height: 120 })
  })
  it("limita a seleção às bordas e garante ao menos um pixel", () => {
    expect(cropPixels({ x: .9, y: .9, width: .8, height: .8 }, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 })
    expect(cropPixels({ x: 1, y: 1, width: 0, height: 0 }, 100, 100)).toEqual({ x: 99, y: 99, width: 1, height: 1 })
  })
  it("rejeita números não finitos e dimensões inválidas", () => {
    expect(() => cropPixels({ ...FULL_CROP, x: NaN }, 100, 100)).toThrow()
    expect(() => cropPixels(FULL_CROP, 0, 100)).toThrow()
  })
})

describe("o que o editor abre", () => {
  it("só imagem estática que o navegador sabe abrir", () => {
    expect(["image/jpeg", "image/png", "image/webp"].every((type) => isEditableImage({ type }))).toBe(true)
    expect(["image/gif", "image/heic", "application/pdf", "video/mp4"].some((type) => isEditableImage({ type }))).toBe(false)
  })
})
