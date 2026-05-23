import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { env } from '@/lib/env';
import { MongoMonitor } from '@/lib/models/MongoMonitor';
import { MongoMonitorMetric } from '@/lib/models/MongoMonitorMetric';

interface MonitorCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  serverVersion?: string;
  host?: string;
  replSetName?: string;
  replState?: string;
  dbName?: string;
  dbCollections?: number;
  dbObjects?: number;
  dbDataSizeBytes?: number;
  dbStorageSizeBytes?: number;
  dbIndexSizeBytes?: number;
  connectionsCurrent?: number;
  connectionsAvailable?: number;
  connectionsTotalCreated?: number;
  opQuery?: number;
  opInsert?: number;
  opUpdate?: number;
  opDelete?: number;
  opGetMore?: number;
  opCommand?: number;
  netBytesIn?: number;
  netBytesOut?: number;
  netNumRequests?: number;
  wtCacheBytes?: number;
  wtDirtyBytes?: number;
  queueTotal?: number;
  queueReaders?: number;
  queueWriters?: number;
  serverStatusError?: string;
  replSetStatusError?: string;
  dbStatsError?: string;
}

function isMongoUri(uri: string): boolean {
  return uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://');
}

function sanitizeErrorMessage(message: string): string {
  return message.replace(/(mongodb(?:\+srv)?:\/\/)([^@\s]+)@/gi, '$1***@').slice(0, 512);
}

function extractDatabaseName(uri: string): string | undefined {
  const withoutProtocol = uri.replace(/^mongodb(?:\+srv)?:\/\//i, '');
  const slashIdx = withoutProtocol.indexOf('/');
  if (slashIdx < 0) return undefined;
  const path = withoutProtocol.slice(slashIdx + 1);
  const raw = path.split('?')[0]?.trim();
  if (!raw || raw === 'admin') return undefined;
  return decodeURIComponent(raw);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (value && typeof value === 'object') {
    const maybeWithToNumber = value as { toNumber?: () => number; valueOf?: () => unknown };
    if (typeof maybeWithToNumber.toNumber === 'function') {
      try {
        const n = maybeWithToNumber.toNumber();
        if (Number.isFinite(n)) return n;
      } catch {
        // ignore and continue
      }
    }
    if (typeof maybeWithToNumber.valueOf === 'function') {
      const raw = maybeWithToNumber.valueOf();
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'bigint') {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      if (typeof raw === 'string' && raw.trim().length > 0) {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return undefined;
}

function nonNegativeDelta(current: number | undefined, previous: number | undefined): number | undefined {
  if (typeof current !== 'number' || typeof previous !== 'number') return undefined;
  const delta = current - previous;
  return delta >= 0 ? delta : 0;
}

function resolveTargetUri(legacyUri?: string): string | undefined {
  return env.TARGET_MONGODB_URI ?? legacyUri;
}

async function commandWithError<T>(fn: () => Promise<T>): Promise<{ value: T | null; error?: string }> {
  try {
    const value = await fn();
    return { value };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Command failed';
    return { value: null, error: sanitizeErrorMessage(message) };
  }
}

export async function checkMongoUri(uri: string, timeoutMs = 8000): Promise<MonitorCheckResult> {
  if (!isMongoUri(uri)) {
    return { ok: false, latencyMs: 0, error: 'URI must start with mongodb:// or mongodb+srv://' };
  }

  const startedAt = Date.now();
  const dbName = extractDatabaseName(uri);

  try {
    const conn = await mongoose
      .createConnection(uri, {
        serverSelectionTimeoutMS: timeoutMs,
        maxPoolSize: 1,
        minPoolSize: 0,
      })
      .asPromise();

    try {
      await conn.db.admin().command({ ping: 1 });

      const [buildInfoRes, serverStatusRes, replStatusRes, dbStatsRes] = await Promise.all([
        commandWithError(() => conn.db.admin().command({ buildInfo: 1 })),
        commandWithError(() => conn.db.admin().command({ serverStatus: 1 })),
        commandWithError(() => conn.db.admin().command({ replSetGetStatus: 1 })),
        dbName
          ? commandWithError(() => conn.useDb(dbName).db.stats())
          : Promise.resolve({ value: null as null, error: 'No database name in URI path' }),
      ]);

      const buildInfo = buildInfoRes.value;
      const serverStatus = serverStatusRes.value;
      const replStatus = replStatusRes.value;
      const dbStats = dbStatsRes.value;

      const wtCache = serverStatus?.wiredTiger?.cache;
      const globalLock = serverStatus?.globalLock;

      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        serverVersion: buildInfo?.version,
        host: serverStatus?.host,
        replSetName: replStatus?.set,
        replState: replStatus?.myState
          ? ({ 1: 'PRIMARY', 2: 'SECONDARY', 3: 'RECOVERING', 5: 'STARTUP2', 7: 'ARBITER', 10: 'REMOVED' }[
              replStatus.myState as number
            ] ?? `STATE_${replStatus.myState}`)
          : undefined,
        dbName,
        dbCollections: toFiniteNumber(dbStats?.collections),
        dbObjects: toFiniteNumber(dbStats?.objects),
        dbDataSizeBytes: toFiniteNumber(dbStats?.dataSize),
        dbStorageSizeBytes: toFiniteNumber(dbStats?.storageSize),
        dbIndexSizeBytes: toFiniteNumber(dbStats?.indexSize),
        connectionsCurrent: toFiniteNumber(serverStatus?.connections?.current),
        connectionsAvailable: toFiniteNumber(serverStatus?.connections?.available),
        connectionsTotalCreated: toFiniteNumber(serverStatus?.connections?.totalCreated),
        opQuery: toFiniteNumber(serverStatus?.opcounters?.query),
        opInsert: toFiniteNumber(serverStatus?.opcounters?.insert),
        opUpdate: toFiniteNumber(serverStatus?.opcounters?.update),
        opDelete: toFiniteNumber(serverStatus?.opcounters?.delete),
        opGetMore: toFiniteNumber(serverStatus?.opcounters?.getmore),
        opCommand: toFiniteNumber(serverStatus?.opcounters?.command),
        netBytesIn: toFiniteNumber(serverStatus?.network?.bytesIn),
        netBytesOut: toFiniteNumber(serverStatus?.network?.bytesOut),
        netNumRequests: toFiniteNumber(serverStatus?.network?.numRequests),
        wtCacheBytes: toFiniteNumber(wtCache?.['bytes currently in the cache']),
        wtDirtyBytes: toFiniteNumber(wtCache?.['tracked dirty bytes in the cache']),
        queueTotal: toFiniteNumber(globalLock?.currentQueue?.total),
        queueReaders: toFiniteNumber(globalLock?.currentQueue?.readers),
        queueWriters: toFiniteNumber(globalLock?.currentQueue?.writers),
        serverStatusError: serverStatusRes.error,
        replSetStatusError: replStatusRes.error,
        dbStatsError: dbStatsRes.error,
      };
    } finally {
      await conn.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: sanitizeErrorMessage(message),
      dbName,
    };
  }
}

export async function runMongoMonitorCheck(monitorId: string): Promise<void> {
  await connectDB();
  const monitor = await MongoMonitor.findById(monitorId);
  if (!monitor || !monitor.enabled) return;

  const targetUri = resolveTargetUri(monitor.uri);
  if (!targetUri) {
    const now = new Date();
    monitor.lastCheckedAt = now;
    monitor.lastError = 'Missing TARGET_MONGODB_URI in environment';
    monitor.lastLatencyMs = 0;
    await MongoMonitorMetric.create({ monitorId, ts: now, ok: false, latencyMs: 0, error: monitor.lastError });
    await monitor.save();
    return;
  }

  const now = new Date();
  const result = await checkMongoUri(targetUri, monitor.timeoutMs);

  monitor.lastCheckedAt = now;
  monitor.lastLatencyMs = result.latencyMs;
  monitor.serverVersion = result.serverVersion;

  if (result.ok) {
    monitor.lastSuccessAt = now;
    monitor.lastError = undefined;
  } else {
    monitor.lastError = result.error ?? 'Unknown error';
  }

  const prev = await MongoMonitorMetric.findOne({ monitorId }).sort({ ts: -1 }).lean();

  const opTotal =
    (result.opQuery ?? 0) +
    (result.opInsert ?? 0) +
    (result.opUpdate ?? 0) +
    (result.opDelete ?? 0) +
    (result.opGetMore ?? 0) +
    (result.opCommand ?? 0);

  const prevOpTotal = prev
    ? (prev.opQuery ?? 0) +
      (prev.opInsert ?? 0) +
      (prev.opUpdate ?? 0) +
      (prev.opDelete ?? 0) +
      (prev.opGetMore ?? 0) +
      (prev.opCommand ?? 0)
    : undefined;

  const elapsedSec = prev ? Math.max(1, (now.getTime() - new Date(prev.ts).getTime()) / 1000) : 1;

  const opDelta = nonNegativeDelta(opTotal, prevOpTotal);
  const netInDelta = nonNegativeDelta(result.netBytesIn, prev?.netBytesIn);
  const netOutDelta = nonNegativeDelta(result.netBytesOut, prev?.netBytesOut);

  const opsPerSec = typeof opDelta === 'number' ? opDelta / elapsedSec : undefined;
  const netInBps = typeof netInDelta === 'number' ? netInDelta / elapsedSec : undefined;
  const netOutBps = typeof netOutDelta === 'number' ? netOutDelta / elapsedSec : undefined;

  await MongoMonitorMetric.create({
    monitorId,
    ts: now,
    ok: result.ok,
    latencyMs: result.latencyMs,
    error: result.error,
    serverVersion: result.serverVersion,
    host: result.host,
    replSetName: result.replSetName,
    replState: result.replState,
    dbName: result.dbName,
    dbCollections: result.dbCollections,
    dbObjects: result.dbObjects,
    dbDataSizeBytes: result.dbDataSizeBytes,
    dbStorageSizeBytes: result.dbStorageSizeBytes,
    dbIndexSizeBytes: result.dbIndexSizeBytes,
    connectionsCurrent: result.connectionsCurrent,
    connectionsAvailable: result.connectionsAvailable,
    connectionsTotalCreated: result.connectionsTotalCreated,
    opQuery: result.opQuery,
    opInsert: result.opInsert,
    opUpdate: result.opUpdate,
    opDelete: result.opDelete,
    opGetMore: result.opGetMore,
    opCommand: result.opCommand,
    opsPerSec,
    netBytesIn: result.netBytesIn,
    netBytesOut: result.netBytesOut,
    netNumRequests: result.netNumRequests,
    netInBps,
    netOutBps,
    wtCacheBytes: result.wtCacheBytes,
    wtDirtyBytes: result.wtDirtyBytes,
    queueTotal: result.queueTotal,
    queueReaders: result.queueReaders,
    queueWriters: result.queueWriters,
    serverStatusError: result.serverStatusError,
    replSetStatusError: result.replSetStatusError,
    dbStatsError: result.dbStatsError,
  });

  await monitor.save();
}

declare global {
  // eslint-disable-next-line no-var
  var __mongoMonitorServiceStarted: boolean | undefined;
}

export function startMongoMonitorService(): void {
  if (global.__mongoMonitorServiceStarted) return;
  global.__mongoMonitorServiceStarted = true;

  setInterval(async () => {
    try {
      await connectDB();
      const now = Date.now();
      const monitors = await MongoMonitor.find({ enabled: true }).select('_id intervalSeconds lastCheckedAt');

      const due = monitors.filter((m) => {
        if (!m.lastCheckedAt) return true;
        const elapsedMs = now - new Date(m.lastCheckedAt).getTime();
        return elapsedMs >= m.intervalSeconds * 1000;
      });

      await Promise.allSettled(due.map((m) => runMongoMonitorCheck(String(m._id))));

      const retentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await MongoMonitorMetric.deleteMany({ ts: { $lt: retentionCutoff } });
    } catch (error) {
      console.error('[mongo-monitor-service] tick failed', error);
    }
  }, 15000).unref();
}
