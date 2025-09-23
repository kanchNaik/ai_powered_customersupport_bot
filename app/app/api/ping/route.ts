import { NextResponse } from 'next/server';
export const runtime = 'edge'; // fast & free on Vercel
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'support-bot',
    version: '0.0.1',
    timestamp: new Date().toISOString(),
  });
}
