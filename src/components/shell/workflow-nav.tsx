"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/start", label: "00 · Start" },
  { href: "/marketing", label: "01 · Listing Marketing Pack" },
  { href: "/assistant", label: "02 · Broker Assistant" },
  { href: "/settings", label: "03 · Settings" },
];

export function WorkflowNav() {
  const pathname = usePathname();

  return (
    <nav className="relative z-10 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-0 px-4 sm:px-6 lg:flex-row lg:flex-wrap lg:gap-2 lg:border-0">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`border-b border-[var(--border)] px-1 py-3 text-left text-sm font-medium transition lg:border-b-2 lg:border-transparent lg:px-4 lg:py-3 ${
                active
                  ? "border-l-4 border-l-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)] lg:border-l-0 lg:bg-transparent lg:text-[var(--gold)] lg:border-b-[var(--gold)]"
                  : "border-l-4 border-l-transparent text-[var(--txt3)] hover:text-[var(--txt2)] lg:text-[var(--txt3)]"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
