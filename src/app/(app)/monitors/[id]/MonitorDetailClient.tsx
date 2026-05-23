'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Database, RefreshCw } from 'lucide-react';
import { MetricChart } from '@/components/MetricChart';
import { formatBps, formatBytes, timeAgo } from '@/lib/utils';

interface Monitor {
  _id: string;
  name: string;
  enabled: boolean;
}

interface MonitorMetric {
  ts: string;
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
  opsPerSec?: number;
  netInBps?: number;
  netOutBps?: number;
  wtCacheBytes?: number;
  wtDirtyBytes?: number;
  queueTotal?: number;
  queueReaders?: number;
  queueWriters?: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const RANGES = [{ v: '1h', label: '1h' }, { v: '6h', label: '6h' }, { v: '24h', label: '24h' }, { v: '7d', label: '7d' }];

export function MonitorDetailClient({ monitorId }: { monitorId: string }) {
  const [range, setRange] = useState('1h');

  const { data, mutate } = useSWR<{ monitor: Monitor; latest: MonitorMetric | null }>(`/api/monitors/mongodb/${monitorId}`, fetcher, { refreshInterval: 7000 });
  const { data: metricsData } = useSWR<{ metrics: MonitorMetric[] }>(`/api/monitors/mongodb/${monitorId}/metrics?range=${range}`, fetcher, { refreshInterval: 15000 });

  const monitor = data?.monitor;
  const latest = data?.latest;
  const metrics = metricsData?.metrics ?? [];

  if (!monitor) return <div className="py-14 text-sm text-ink-muted">Loading monitor...</div>;

  const healthy = Boolean(monitor.enabled && latest?.ok);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/monitors" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All monitors</Link>
          <div className="mt-2 flex items-center gap-2">
            <Database className={`h-5 w-5 ${healthy ? 'text-success' : 'text-danger'}`} />
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{monitor.name}</h1>
            <span className={`chip text-[10px] ${monitor.enabled ? 'chip-success' : 'chip-muted'}`}>{monitor.enabled ? 'enabled' : 'paused'}</span>
            <span className={`chip text-[10px] ${healthy ? 'chip-success' : 'chip-muted'}`}>{healthy ? 'healthy' : 'unhealthy'}</span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">Last check {timeAgo(latest?.ts)} · host {latest?.host ?? 'n/a'} · version {latest?.serverVersion ?? 'n/a'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => mutate()}><RefreshCw className="h-4 w-4" />Refresh</button>
          <Link className="btn-secondary" href="/monitors">Back</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Connections" value={`${latest?.connectionsCurrent ?? 'n/a'}`} hint={`available ${latest?.connectionsAvailable ?? 'n/a'}`} />
        <Stat label="Ops/sec" value={(latest?.opsPerSec ?? 0).toFixed(1)} hint={`queue ${latest?.queueTotal ?? 0}`} />
        <Stat label="Network in" value={formatBps(latest?.netInBps ?? 0)} hint={`out ${formatBps(latest?.netOutBps ?? 0)}`} />
        <Stat label="Latency" value={`${latest?.latencyMs ?? 0} ms`} hint={latest?.replSetName ? `${latest.replSetName} · ${latest.replState ?? 'unknown'}` : 'standalone or unknown'} />
      </div>

      <div className="card card-pad">
        <h2 className="text-base font-semibold text-ink">Database footprint</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Info label="Database" value={latest?.dbName ?? 'n/a'} />
          <Info label="Collections" value={String(latest?.dbCollections ?? 'n/a')} />
          <Info label="Objects" value={String(latest?.dbObjects ?? 'n/a')} />
          <Info label="Data / Storage / Index" value={`${formatBytes(latest?.dbDataSizeBytes ?? 0)} / ${formatBytes(latest?.dbStorageSizeBytes ?? 0)} / ${formatBytes(latest?.dbIndexSizeBytes ?? 0)}`} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Advanced metrics</h2>
            <p className="text-xs text-ink-soft">{metrics.length} data points</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-bg-muted p-1 text-xs">
            {RANGES.map((r) => (
              <button key={r.v} onClick={() => setRange(r.v)} className={`rounded-md px-3 py-1.5 transition-colors ${range === r.v ? 'bg-bg-card text-ink shadow' : 'text-ink-muted hover:text-ink'}`}>{r.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
          <ChartCard title="Connections" hint="current/available">
            <MetricChart
              data={metrics}
              series={[{ key: 'connectionsCurrent', label: 'Current', color: '#a1a1aa' }, { key: 'connectionsAvailable', label: 'Available', color: '#52525b' }]}
              yFormatter={(v) => `${v.toFixed(0)}`}
            />
          </ChartCard>

          <ChartCard title="Operations" hint="ops/sec">
            <MetricChart data={metrics} series={[{ key: 'opsPerSec', label: 'Ops/s', color: '#71717a' }]} yFormatter={(v) => v.toFixed(1)} />
          </ChartCard>

          <ChartCard title="Network throughput" hint="bytes/sec">
            <MetricChart
              data={metrics}
              series={[{ key: 'netInBps', label: 'In', color: '#d4d4d8', formatter: (v) => formatBps(v) }, { key: 'netOutBps', label: 'Out', color: '#737373', formatter: (v) => formatBps(v) }]}
              yFormatter={(v) => formatBytes(v)}
            />
          </ChartCard>

          <ChartCard title="Latency" hint="ms">
            <MetricChart data={metrics} series={[{ key: 'latencyMs', label: 'Latency', color: '#9f1239' }]} yFormatter={(v) => `${v.toFixed(0)} ms`} />
          </ChartCard>

          <ChartCard title="WiredTiger cache" hint="bytes">
            <MetricChart
              data={metrics}
              series={[{ key: 'wtCacheBytes', label: 'Cache', color: '#9ca3af', formatter: (v) => formatBytes(v) }, { key: 'wtDirtyBytes', label: 'Dirty', color: '#6b7280', formatter: (v) => formatBytes(v) }]}
              yFormatter={(v) => formatBytes(v)}
            />
          </ChartCard>

          <ChartCard title="Queue depth" hint="global lock queue">
            <MetricChart
              data={metrics}
              series={[{ key: 'queueTotal', label: 'Total', color: '#a1a1aa' }, { key: 'queueReaders', label: 'Readers', color: '#d4d4d8' }, { key: 'queueWriters', label: 'Writers', color: '#52525b' }]}
              yFormatter={(v) => `${v.toFixed(0)}`}
            />
          </ChartCard>
        </div>
      </div>

      {latest?.error && <div className="card card-pad text-sm text-danger">Latest error: {latest.error}</div>}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card card-pad">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{hint}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft/40 px-3 py-2">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-0.5 text-ink">{value}</div>
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="text-[11px] text-ink-soft">{hint}</span>
      </div>
      {children}
    </div>
  );
}
