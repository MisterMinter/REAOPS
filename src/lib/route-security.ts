import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

type SecretOptions = {
  providedSecret?: unknown;
  queryParam?: string;
  allowMissingInDevelopment?: boolean;
};

export function requireRouteSecret(
  req: Request,
  envName: string,
  options: SecretOptions = {}
): NextResponse | null {
  const expected = process.env[envName]?.trim();
  const allowMissingInDevelopment = options.allowMissingInDevelopment ?? true;

  if (!expected) {
    if (process.env.NODE_ENV === "production" || !allowMissingInDevelopment) {
      return NextResponse.json(
        { error: `${envName} is not configured.` },
        { status: 503 }
      );
    }
    return null;
  }

  const url = new URL(req.url);
  const queryParam = options.queryParam ?? "secret";
  const provided =
    typeof options.providedSecret === "string"
      ? options.providedSecret
      : url.searchParams.get(queryParam) ??
        bearerToken(req.headers.get("authorization"));

  if (!provided || !constantTimeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function bearerToken(header: string | null) {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
