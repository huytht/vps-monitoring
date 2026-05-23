import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { getSessionFromCookies } from '@/lib/auth';
import { DockerContainerSnapshot } from '@/lib/models/DockerContainerSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { agentId: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const rows = await DockerContainerSnapshot.find({ agentId: params.agentId })
    .sort({ name: 1, containerId: 1 })
    .lean();

  return NextResponse.json({ containers: rows });
}
