import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { MongoMonitor } from '@/lib/models/MongoMonitor';
import { runMongoMonitorCheck } from '@/lib/mongodb-monitor-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

export async function POST(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const monitor = await MongoMonitor.findById(params.id).lean();
  if (!monitor) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await runMongoMonitorCheck(params.id);
  const updated = await MongoMonitor.findById(params.id).lean();

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    ok: true,
    monitor: {
      _id: updated._id,
      name: updated.name,
      intervalSeconds: updated.intervalSeconds,
      timeoutMs: updated.timeoutMs,
      enabled: updated.enabled,
      lastCheckedAt: updated.lastCheckedAt,
      lastSuccessAt: updated.lastSuccessAt,
      lastError: updated.lastError,
      lastLatencyMs: updated.lastLatencyMs,
      serverVersion: updated.serverVersion,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}
