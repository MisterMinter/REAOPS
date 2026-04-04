"use client";

import { signIn } from "next-auth/react";

export function LoginButton({ callbackUrl }: { callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: callbackUrl || "/marketing" })}
      className="w-full rounded-md bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--bg)] transition hover:brightness-110"
    >
      Continue with Google
    </button>
  );
}
