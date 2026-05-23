import { NextResponse } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { Agent } from '@/lib/models/Agent';
import { DockerContainerLog } from '@/lib/models/DockerContainerLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  agentId: z.string().min(1),
  token: z.string().min(1),
  containerId: z.string().min(1).max(128),
  name: z.string().max(256).default(''),
  logTail: z.string().max(2_000_000).default(''),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  await connectDB();

  const agent = await Agent.findOne({
    agentId: parsed.data.agentId,
    token: parsed.data.token,
  }).select('agentId');

  if (!agent) {
    return NextResponse.json({ error: 'Unknown agent or invalid token' }, { status: 401 });
  }

  const now = new Date();
  await DockerContainerLog.updateOne(
    { agentId: parsed.data.agentId, containerId: parsed.data.containerId },
    {
      $set: {
        agentId: parsed.data.agentId,
        containerId: parsed.data.containerId,
        name: parsed.data.name,
        logTail: parsed.data.logTail,
        ts: now,
      },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}
