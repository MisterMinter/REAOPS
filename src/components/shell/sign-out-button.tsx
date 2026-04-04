"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-md border border-[var(--border2)] px-3 py-1.5 text-xs font-medium text-[var(--txt2)] transition hover:border-[var(--txt3)] hover:text-[var(--txt)]"
    >
      Sign out
    </button>
  );
}
