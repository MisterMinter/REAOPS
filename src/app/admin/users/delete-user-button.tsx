"use client";

import { deleteUser } from "@/app/admin/_actions/users";

export function DeleteUserButton({ userId }: { userId: string }) {
  return (
    <button
      type="button"
      className="rounded-md border border-[var(--coral-dim)] bg-[var(--coral)]/10 px-4 py-2 text-sm font-medium text-[var(--coral)] hover:bg-[var(--coral)]/20"
      onClick={() => {
        if (
          !confirm(
            "Permanently remove this user? Their Google sign-in will stop working until you add them again."
          )
        ) {
          return;
        }
        const fd = new FormData();
        fd.set("userId", userId);
        void deleteUser(fd);
      }}
    >
      Remove user permanently
    </button>
  );
}
