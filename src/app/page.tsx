import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/marketing");

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-20">
      <h1 className="font-display text-4xl font-normal leading-tight text-[var(--txt)] sm:text-5xl">
        RE Agent OS
      </h1>
      <p className="mt-4 text-[var(--txt2)]">
        AI-powered listing marketing and broker assistant. Sign in with your Google workspace account.
      </p>
      <Link
        href="/login"
        className="mt-10 inline-flex w-fit items-center justify-center rounded-md bg-[var(--gold)] px-6 py-3 text-sm font-semibold text-[var(--bg)] transition hover:brightness-110"
      >
        Sign in
      </Link>
    </div>
  );
}
