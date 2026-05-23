import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { DockerContainerLog } from '@/lib/models/DockerContainerLog';
import { DockerContainerSnapshot } from '@/lib/models/DockerContainerSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { agentId: string; containerId: string };
}

export async function GET(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  let row = await DockerContainerLog.findOne({
    agentId: params.agentId,
    containerId: params.containerId,
  }).lean();

  if (!row) {
    const escapedId = params.containerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    row = await DockerContainerLog.findOne({
      agentId: params.agentId,
      containerId: { $regex: `^${escapedId}` },
    }).lean();
  }

  if (!row) {
    const snapshot = await DockerContainerSnapshot.findOne({
      agentId: params.agentId,
      containerId: params.containerId,
    }).lean();

    if (!snapshot) {
      const escapedId = params.containerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const snapshotByPrefix = await DockerContainerSnapshot.findOne({
        agentId: params.agentId,
        containerId: { $regex: `^${escapedId}` },
      }).lean();
      if (!snapshotByPrefix) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      row = {
        agentId: snapshotByPrefix.agentId,
        containerId: snapshotByPrefix.containerId,
        name: snapshotByPrefix.name,
        ts: snapshotByPrefix.ts,
        logTail: '',
      };
    } else {
      row = {
        agentId: snapshot.agentId,
        containerId: snapshot.containerId,
        name: snapshot.name,
        ts: snapshot.ts,
        logTail: '',
      };
    }
  }

  const url = new URL(req.url);
  const download = url.searchParams.get('download') === '1';

  if (download) {
    const safeName = (row.name || params.containerId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filename = `${safeName}-${new Date(row.ts).toISOString().replace(/[:.]/g, '-')}.log`;
    return new NextResponse(row.logTail ?? '', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    containerId: row.containerId,
    name: row.name,
    ts: row.ts,
    logTail: row.logTail,
  });
}
