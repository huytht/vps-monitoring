import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { env } from '@/lib/env';
import { getSessionFromCookies } from '@/lib/auth';
import { MongoMonitor } from '@/lib/models/MongoMonitor';
import { MongoMonitorMetric } from '@/lib/models/MongoMonitorMetric';
import { runMongoMonitorCheck, startMongoMonitorService } from '@/lib/mongodb-monitor-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1).max(128),
  intervalSeconds: z.number().int().min(10).max(3600).default(60),
  timeoutMs: z.number().int().min(1000).max(60000).default(8000),
  enabled: z.boolean().default(true),
});

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  startMongoMonitorService();
  await connectDB();

  const monitors = await MongoMonitor.find({}).sort({ createdAt: -1 }).lean();
  const ids = monitors.map((m) => String(m._id));
  const latestRows = await MongoMonitorMetric.aggregate([
    { $match: { monitorId: { $in: ids } } },
    { $sort: { ts: -1 } },
    { $group: { _id: '$monitorId', metric: { $first: '$$ROOT' } } },
  ]);
  const latestMap = new Map<string, Record<string, unknown>>();
  for (const row of latestRows) latestMap.set(row._id, row.metric);

  return NextResponse.json({
    monitors: monitors.map((m) => ({
      _id: m._id,
      name: m.name,
      intervalSeconds: m.intervalSeconds,
      timeoutMs: m.timeoutMs,
      enabled: m.enabled,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      latest: latestMap.get(String(m._id)) ?? null,
    })),
    targetMongoConfigured: Boolean(env.TARGET_MONGODB_URI),
  });
}

export async function POST(req: Request) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!env.TARGET_MONGODB_URI) {
    return NextResponse.json(
      { error: 'Missing TARGET_MONGODB_URI in environment. Set it in .env and restart app.' },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const monitor = await MongoMonitor.create(parsed.data);

  await runMongoMonitorCheck(String(monitor._id));
  const updated = await MongoMonitor.findById(monitor._id).lean();
  const latest = await MongoMonitorMetric.findOne({ monitorId: String(monitor._id) }).sort({ ts: -1 }).lean();

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(
    {
      ok: true,
      monitor: {
        _id: updated._id,
        name: updated.name,
        intervalSeconds: updated.intervalSeconds,
        timeoutMs: updated.timeoutMs,
        enabled: updated.enabled,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      latest,
    },
    { status: 201 }
  );
}
