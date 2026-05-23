import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { Agent } from '@/lib/models/Agent';
import { Metric } from '@/lib/models/Metric';
import { DockerContainerSnapshot } from '@/lib/models/DockerContainerSnapshot';
import { DockerContainerLog } from '@/lib/models/DockerContainerLog';
import { getSessionFromCookies } from '@/lib/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { agentId: string };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  const agent = await Agent.findOne({ agentId: params.agentId }).lean();
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const latest = await Metric.findOne({ agentId: params.agentId }).sort({ ts: -1 }).lean();

  const offlineMs = env.AGENT_OFFLINE_AFTER_SECONDS * 1000;
  const online =
    agent.lastSeenAt && Date.now() - new Date(agent.lastSeenAt).getTime() <= offlineMs;

  return NextResponse.json({
    agent: {
      agentId: agent.agentId,
      hostname: agent.hostname,
      label: agent.label,
      os: agent.os,
      osVersion: agent.osVersion,
      kernel: agent.kernel,
      arch: agent.arch,
      cpuModel: agent.cpuModel,
      cpuCores: agent.cpuCores,
      totalMemoryBytes: agent.totalMemoryBytes,
      totalDiskBytes: agent.totalDiskBytes,
      publicIp: agent.publicIp,
      privateIp: agent.privateIp,
      tags: agent.tags,
      online,
      lastSeenAt: agent.lastSeenAt,
      registeredAt: agent.registeredAt,
      latest,
    },
  });
}

const patchSchema = z.object({
  label: z.string().max(64).optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
});

export async function PATCH(req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  await connectDB();
  const agent = await Agent.findOneAndUpdate(
    { agentId: params.agentId },
    { $set: parsed.data },
    { new: true }
  );
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectDB();
  await Agent.deleteOne({ agentId: params.agentId });
  await Metric.deleteMany({ agentId: params.agentId });
  await DockerContainerSnapshot.deleteMany({ agentId: params.agentId });
  await DockerContainerLog.deleteMany({ agentId: params.agentId });

  return NextResponse.json({ ok: true });
}
