import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { MongoMonitorMetric } from '@/lib/models/MongoMonitorMetric';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const range = url.searchParams.get('range') ?? '1h';

  const now = Date.now();
  let fromMs = now - 60 * 60 * 1000;
  if (range === '6h') fromMs = now - 6 * 60 * 60 * 1000;
  else if (range === '24h') fromMs = now - 24 * 60 * 60 * 1000;
  else if (range === '7d') fromMs = now - 7 * 24 * 60 * 60 * 1000;

  await connectDB();
  const rows = await MongoMonitorMetric.find({
    monitorId: params.id,
    ts: { $gte: new Date(fromMs) },
  })
    .sort({ ts: 1 })
    .limit(2000)
    .lean();

  return NextResponse.json({ metrics: rows });
}
