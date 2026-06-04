"use client"

import { useRouter } from "next/navigation"
import { TemplateBuilder } from "./template-builder"

export function NewTemplateClient() {
  const router = useRouter()
  return (
    <TemplateBuilder
      onClose={() => router.push("/templates")}
      onDone={() => router.push("/templates?created=1")}
    />
  )
}
