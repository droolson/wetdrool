import { type NextRequest, NextResponse } from 'next/server';

import { legacyHostRedirect } from './lib/canonical-host';

export function proxy(request: NextRequest) {
  // Next's production server may normalize `nextUrl` to its internal bind
  // address. The HTTP Host header retains the public hostname that determines
  // whether this exact legacy-domain redirect applies.
  const destination = legacyHostRedirect(request.nextUrl, request.headers.get('host') ?? undefined);
  return destination === undefined
    ? NextResponse.next()
    : NextResponse.redirect(destination, { status: 308 });
}

export const config = {
  matcher: '/:path*',
};
