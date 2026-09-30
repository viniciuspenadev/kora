import { File, FileArchive, FileCode, FileImage, FileSpreadsheet, FileText, Film, Music, Presentation, type LucideIcon } from "lucide-react"
import type { FileKindKey } from "@/lib/chat/file-kind"
import { cn } from "@/lib/utils"

// Ícone por tipo de arquivo — a cor é a convenção que o atendente já reconhece do WhatsApp e do
// Office (PDF vermelho, Word azul, Excel verde, apresentação laranja). Cor com significado, não
// decoração: o resto (XML, texto, vídeo) fica neutro.
const STYLE: Record<FileKindKey, { icon: LucideIcon; tile: string }> = {
  pdf:        { icon: FileText,        tile: "bg-red-50 text-red-600" },
  word:       { icon: FileText,        tile: "bg-primary-50 text-primary-600" },
  excel:      { icon: FileSpreadsheet, tile: "bg-emerald-50 text-emerald-600" },
  powerpoint: { icon: Presentation,    tile: "bg-orange-50 text-orange-600" },
  zip:        { icon: FileArchive,     tile: "bg-amber-50 text-amber-700" },
  xml:        { icon: FileCode,        tile: "bg-slate-100 text-slate-600" },
  text:       { icon: FileText,        tile: "bg-slate-100 text-slate-600" },
  image:      { icon: FileImage,       tile: "bg-sky-50 text-sky-600" },
  video:      { icon: Film,            tile: "bg-slate-100 text-slate-600" },
  audio:      { icon: Music,           tile: "bg-slate-100 text-slate-600" },
  other:      { icon: File,            tile: "bg-slate-100 text-slate-500" },
}

/** Quadrado com o ícone do tipo. `bare` = só o ícone colorido (miniatura da bandeja). */
export function FileTypeIcon({ kind, className, bare = false }: { kind: FileKindKey; className?: string; bare?: boolean }) {
  const { icon: Icon, tile } = STYLE[kind]
  if (bare) return <Icon className={cn("size-5", tile.split(" ").find((c) => c.startsWith("text-")), className)} aria-hidden />
  return <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", tile, className)} aria-hidden><Icon className="size-[18px]" /></span>
}
