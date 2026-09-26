import type { Metadata } from "next";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Redefinir senha | Kora", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Page() { return <PasswordRecoveryForm reset/>; }
