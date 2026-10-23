import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const ALLOWED_COUNTRIES = new Set(['CO', 'GB'])

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const country = request.headers
    .get('x-vercel-ip-country')
    ?.trim()
    .toUpperCase()

  const allowed = country
    ? ALLOWED_COUNTRIES.has(country)
    : process.env.NODE_ENV !== 'production'

  return NextResponse.json(
    { allowed },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
