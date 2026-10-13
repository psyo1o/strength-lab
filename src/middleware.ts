import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 이 런타임은 Edge라 SQLite를 열 수 없다.
 * 모든 요청의 경로를 노드 레이아웃과 API 게이트로 넘긴다.
 * 상태 검사는 src/lib/member-gate.ts 가 요청마다 한다.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-sl-pathname", request.nextUrl.pathname);
  headers.set("x-sl-method", request.method);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
