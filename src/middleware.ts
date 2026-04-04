import { authConfig } from "@/auth.config";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const path = req.nextUrl.pathname;
  if (!req.auth) {
    if (
      path.startsWith("/marketing") ||
      path.startsWith("/assistant") ||
      path.startsWith("/settings") ||
      path.startsWith("/admin")
    ) {
      const login = new URL("/login", req.nextUrl.origin);
      login.searchParams.set("callbackUrl", path);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  const role = req.auth.user?.role;
  if (path.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/marketing", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/marketing/:path*",
    "/assistant/:path*",
    "/settings/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
