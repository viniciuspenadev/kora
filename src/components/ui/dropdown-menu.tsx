"use client"

/**
 * ⚠️ DIVERGE DE PROPÓSITO do `C:\apps\crm\src\components\ui\dropdown-menu.tsx`.
 *
 * Até 2026-07-30 os dois arquivos eram IDÊNTICOS (o default do shadcn base-nova). O dono
 * pediu pra melhorar aqui e refletir no app inteiro, então o Kora passou na frente.
 * Se um dia o CRM for alinhado, é copiar este arquivo — não refazer as decisões.
 *
 * O que mudou e POR QUÊ (o "porquê" importa mais que o "o quê" — sem ele, a próxima
 * pessoa que rodar `npx shadcn add dropdown-menu` sobrescreve tudo sem perceber):
 *   1. Popup nasce do CONTEÚDO (`w-auto` + piso), não da largura do gatilho.
 *   2. Item com respiro de verdade (~36px), não os ~28px espremidos do default.
 *   3. Ícone NÃO perde a cor no hover (o default pintava todo descendente).
 * Detalhe de cada um nos comentários inline abaixo.
 *
 * 🔴 Efeito colateral pretendido: as 18 larguras na unha (`w-48`/`w-52`/`w-56`) espalhadas
 *    pelas telas foram REMOVIDAS junto — elas só existiam pra contornar o item 1. Não
 *    reintroduzir: largura por tela é como a inconsistência volta.
 */

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          // 🔴 `w-auto`, e NÃO `w-(--anchor-width)` (o default do shadcn). Amarrar a
          //    largura do menu à do gatilho é o que deixava tudo torto: um botão de ícone
          //    de 32px gerava um menu de 32px, e por isso cada tela ia colando `w-52`,
          //    `w-48`, `w-56` na mão — cada uma com um número diferente. Agora o menu
          //    nasce do CONTEÚDO, com um piso confortável.
          // Sombra mais profunda + ring mais leve: o menu flutua acima da página em vez
          // de parecer uma caixa colada nela.
          className={cn("z-50 max-h-(--available-height) w-auto min-w-[13rem] max-w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg shadow-slate-900/[0.08] ring-1 ring-slate-900/[0.07] duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        // Micro-rótulo de seção, mesma linguagem dos cabeçalhos de tabela do app.
        "px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      // Três mudanças sobre o default do shadcn:
      // 1. RESPIRO — era `px-1.5 py-1` (6px/4px): item de ~28px com o texto encostando na
      //    borda. `px-2.5 py-2` dá ~36px, que é alvo de clique honesto e lê como menu de
      //    produto, não como tooltip com lista dentro.
      // 2. ÍCONE NÃO PERDE A COR NO HOVER — o default tinha
      //    `focus:**:text-accent-foreground`, que pinta TODO descendente (inclusive o
      //    `<svg>`) na cor do texto. Ícone colorido (canal, categoria, ação) virava
      //    cinza justo no momento em que a pessoa aponta pra ele. Agora só o TEXTO muda.
      // 3. `rounded-lg` acompanhando o `rounded-xl` do popup, senão o item quadrado
      //    dentro da caixa arredondada denuncia a emenda.
      // O ramo `destructive` continua pintando o svg de propósito: ali a cor É o aviso.
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-700 outline-hidden select-none transition-colors focus:bg-slate-100 focus:text-slate-900 data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        // Mesma régua do DropdownMenuItem — submenu com padding diferente do item irmão
        // é o tipo de desalinho que ninguém sabe nomear mas todo mundo sente.
        "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-700 outline-hidden select-none transition-colors focus:bg-slate-100 focus:text-slate-900 data-inset:pl-7 data-popup-open:bg-slate-100 data-popup-open:text-slate-900 data-open:bg-slate-100 data-open:text-slate-900 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-lg py-2 pr-9 pl-2.5 text-[13px] font-medium text-slate-700 outline-hidden select-none transition-colors focus:bg-slate-100 focus:text-slate-900 data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-lg py-2 pr-9 pl-2.5 text-[13px] font-medium text-slate-700 outline-hidden select-none transition-colors focus:bg-slate-100 focus:text-slate-900 data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      // `-mx-1.5` acompanha o `p-1.5` do popup: a linha vai de ponta a ponta em vez de
      // parar antes da borda, que é o que fazia o separador parecer torto.
      className={cn("-mx-1.5 my-1.5 h-px bg-slate-100", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
