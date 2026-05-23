import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppSettings } from '@/lib/app-settings';
import { connectDB } from '@/lib/db';
import { env } from '@/lib/env';
import { Agent } from '@/lib/models/Agent';
import { Metric } from '@/lib/models/Metric';
import { DockerContainerSnapshot } from '@/lib/models/DockerContainerSnapshot';
import { DockerContainerLog } from '@/lib/models/DockerContainerLog';
import { sendTelegramOverloadIfNeeded } from '@/lib/telegram-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const dockerContainerSchema = z.object({
  containerId: z.string().min(1).max(128),
  name: z.string().max(256).default(''),
  image: z.string().max(512).default(''),
  state: z.string().max(64).default(''),
  status: z.string().max(256).default(''),
  cpuPercent: z.number().min(0).max(1000).optional(),
  memUsage: z.string().max(128).default(''),
  memPercent: z.number().min(0).max(1000).optional(),
  netIO: z.string().max(128).default(''),
  blockIO: z.string().max(128).default(''),
  pids: z.number().int().min(0).max(100000).optional(),
});

const schema = z.object({
  agentId: z.string().min(1),
  token: z.string().min(1),
  cpuPercent: z.number().min(0).max(100).default(0),
  loadAvg1: z.number().min(0).default(0),
  loadAvg5: z.number().min(0).default(0),
  loadAvg15: z.number().min(0).default(0),
  memUsedBytes: z.number().min(0).default(0),
  memTotalBytes: z.number().min(0).default(0),
  swapUsedBytes: z.number().min(0).default(0),
  swapTotalBytes: z.number().min(0).default(0),
  diskUsedBytes: z.number().min(0).default(0),
  diskTotalBytes: z.number().min(0).default(0),
  netRxBytes: z.number().min(0).default(0),
  netTxBytes: z.number().min(0).default(0),
  netRxBps: z.number().min(0).default(0),
  netTxBps: z.number().min(0).default(0),
  uptimeSeconds: z.number().min(0).default(0),
  processCount: z.number().int().min(0).default(0),
  dockerAvailable: z.boolean().optional(),
  dockerContainers: z.array(dockerContainerSchema).max(200).optional(),
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
  });

  if (!agent) {
    return NextResponse.json({ error: 'Unknown agent or invalid token' }, { status: 401 });
  }

  const now = new Date();
  agent.lastSeenAt = now;
  await agent.save();

  await Metric.create({
    agentId: agent.agentId,
    ts: now,
    cpuPercent: parsed.data.cpuPercent,
    loadAvg1: parsed.data.loadAvg1,
    loadAvg5: parsed.data.loadAvg5,
    loadAvg15: parsed.data.loadAvg15,
    memUsedBytes: parsed.data.memUsedBytes,
    memTotalBytes: parsed.data.memTotalBytes,
    swapUsedBytes: parsed.data.swapUsedBytes,
    swapTotalBytes: parsed.data.swapTotalBytes,
    diskUsedBytes: parsed.data.diskUsedBytes,
    diskTotalBytes: parsed.data.diskTotalBytes,
    netRxBytes: parsed.data.netRxBytes,
    netTxBytes: parsed.data.netTxBytes,
    netRxBps: parsed.data.netRxBps,
    netTxBps: parsed.data.netTxBps,
    uptimeSeconds: parsed.data.uptimeSeconds,
    processCount: parsed.data.processCount,
  });

  if (parsed.data.dockerAvailable && parsed.data.dockerContainers) {
    const containerIds = parsed.data.dockerContainers.map((c) => c.containerId);

    await Promise.all(
      parsed.data.dockerContainers.map((c) =>
        DockerContainerSnapshot.updateOne(
          { agentId: agent.agentId, containerId: c.containerId },
          {
            $set: {
              agentId: agent.agentId,
              containerId: c.containerId,
              name: c.name,
              image: c.image,
              state: c.state,
              status: c.status,
              cpuPercent: c.cpuPercent,
              memUsage: c.memUsage,
              memPercent: c.memPercent,
              netIO: c.netIO,
              blockIO: c.blockIO,
              pids: c.pids,
              ts: now,
            },
          },
          { upsert: true }
        )
      )
    );

    await DockerContainerSnapshot.deleteMany({
      agentId: agent.agentId,
      containerId: { $nin: containerIds },
    });
    await DockerContainerLog.deleteMany({
      agentId: agent.agentId,
      containerId: { $nin: containerIds },
    });
  }

  const appSettings = await getAppSettings();
  const sent = await sendTelegramOverloadIfNeeded(
    agent,
    {
      cpuPercent: parsed.data.cpuPercent,
      memUsedBytes: parsed.data.memUsedBytes,
      memTotalBytes: parsed.data.memTotalBytes,
      diskUsedBytes: parsed.data.diskUsedBytes,
      diskTotalBytes: parsed.data.diskTotalBytes,
    },
    appSettings,
    env.APP_URL
  );
  if (sent) {
    agent.lastTelegramAlertAt = now;
    await agent.save();
  }

  return NextResponse.json({ ok: true });
}
