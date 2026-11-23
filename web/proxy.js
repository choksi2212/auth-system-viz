import { NextResponse } from "next/server";
export function proxy(request) {
  if (
    request.method === "POST" &&
    Number(request.headers.get("content-length") || 0) >
      20 * 1024 * 1024 + 65536
  ) {
    return NextResponse.json(
      { detail: "Files must be 20 MB or smaller." },
      { status: 413 },
    );
  }
  return NextResponse.next();
}
export const config = { matcher: "/api/vault/documents" };
