import { Font } from "@react-pdf/renderer"
import path from "path"

// Registro ÚNICO da família Inter pros PDFs (fatura + cotação). react-pdf mantém
// as fontes num registro global por família — registrar a mesma família em dois
// módulos colidiria; centralizar aqui e chamar via guard idempotente resolve.
let done = false
export function registerPdfFonts(): void {
  if (done) return
  done = true
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(process.cwd(), "public/fonts/Inter-Regular.ttf"),  fontWeight: 400 },
      { src: path.join(process.cwd(), "public/fonts/Inter-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(process.cwd(), "public/fonts/Inter-Bold.ttf"),     fontWeight: 700 },
    ],
  })
  Font.registerHyphenationCallback((w) => [w]) // não quebra palavras
}
