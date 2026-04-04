import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginButton } from "./login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  if (session?.user) {
    redirect(params.callbackUrl && params.callbackUrl.startsWith("/") ? params.callbackUrl : "/marketing");
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return (
      <div className="relative z-10 mx-auto max-w-md px-6 py-24">
        <p className="text-[var(--coral)]">Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>
        <Link href="/" className="mt-6 inline-block text-[var(--gold)]">
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div className="relative z-10 mx-auto max-w-md px-6 py-24">
      <h1 className="font-display text-3xl text-[var(--txt)]">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--txt2)]">
        Use the Google account your administrator invited. New accounts cannot self-register.
      </p>
      {params.error && (
        <p className="mt-4 rounded-md border border-[var(--coral-dim)] bg-[var(--coral)]/10 px-3 py-2 text-sm text-[var(--coral)]">
          Access denied. Your email may not be provisioned yet — contact your administrator.
        </p>
      )}
      <div className="mt-8">
        <LoginButton callbackUrl={params.callbackUrl} />
      </div>
      <Link href="/" className="mt-8 inline-block text-sm text-[var(--txt3)] hover:text-[var(--gold)]">
        ← Home
      </Link>
    </div>
  );
}
