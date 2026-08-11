import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const ALLOWED_COUNTRY = 'CO'
const UNAVAILABLE_PATH = '/service-unavailable'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Keep the internal error route reachable and avoid rewriting its own request.
  if (pathname === UNAVAILABLE_PATH) {
    return NextResponse.next()
  }

  const country = request.headers
    .get('x-vercel-ip-country')
    ?.trim()
    .toUpperCase()

  // Vercel supplies the country header in production. An absent header is
  // intentionally allowed so local development and non-Vercel previews work.
  if (!country || country === ALLOWED_COUNTRY) {
    return NextResponse.next()
  }

  const unavailableUrl = request.nextUrl.clone()
  unavailableUrl.pathname = UNAVAILABLE_PATH
  unavailableUrl.search = ''

  return NextResponse.rewrite(unavailableUrl)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.png|robots.txt|sitemap.xml).*)',
  ],
}
