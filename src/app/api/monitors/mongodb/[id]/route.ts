import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { MongoMonitor } from '@/lib/models/MongoMonitor';
import { MongoMonitorMetric } from '@/lib/models/MongoMonitorMetric';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  intervalSeconds: z.number().int().min(10).max(3600).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const monitor = await MongoMonitor.findById(params.id).lean();
  if (!monitor) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const latest = await MongoMonitorMetric.findOne({ monitorId: params.id }).sort({ ts: -1 }).lean();

  return NextResponse.json({
    monitor: {
      _id: monitor._id,
      name: monitor.name,
      intervalSeconds: monitor.intervalSeconds,
      timeoutMs: monitor.timeoutMs,
      enabled: monitor.enabled,
      createdAt: monitor.createdAt,
      updatedAt: monitor.updatedAt,
    },
    latest,
  });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const monitor = await MongoMonitor.findByIdAndUpdate(params.id, { $set: parsed.data }, { new: true }).lean();
  if (!monitor) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    ok: true,
    monitor: {
      _id: monitor._id,
      name: monitor.name,
      intervalSeconds: monitor.intervalSeconds,
      timeoutMs: monitor.timeoutMs,
      enabled: monitor.enabled,
      createdAt: monitor.createdAt,
      updatedAt: monitor.updatedAt,
    },
  });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  await MongoMonitor.findByIdAndDelete(params.id);
  await MongoMonitorMetric.deleteMany({ monitorId: params.id });
  return NextResponse.json({ ok: true });
}
