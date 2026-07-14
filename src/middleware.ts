import { NextResponse, type NextRequest } from 'next/server';

/**
 * /admin is unauthenticated.
 *
 * That's fine on localhost — it's a single-operator tool and the DB is a file on
 * disk. It is emphatically NOT fine in production: the review screen can
 * republish, retitle, and reject any deck in the archive, and there is nothing
 * between it and the open internet.
 *
 * Rather than ship a lock that looks real and isn't, this refuses to serve
 * /admin at all once deployed, until real auth is wired up (Auth.js + Google +
 * an email allowlist is the plan; it needs OAuth credentials to exist).
 * ADMIN_AUTH_CONFIGURED is the switch that flips once that's true.
 */
export function middleware(req: NextRequest) {
  const isProd = process.env.NODE_ENV === 'production';
  const authed = process.env.ADMIN_AUTH_CONFIGURED === 'true';

  if (isProd && !authed) {
    return new NextResponse('관리자 화면은 인증 설정 전까지 비활성화되어 있습니다.', { status: 404 });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
