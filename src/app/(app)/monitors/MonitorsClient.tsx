'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Activity, PlusCircle, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatBps, timeAgo } from '@/lib/utils';

interface MongoMonitorLatest {
  ts: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  serverVersion?: string;
  connectionsCurrent?: number;
  opsPerSec?: number;
  netInBps?: number;
  netOutBps?: number;
}

interface MongoMonitor {
  _id: string;
  name: string;
  intervalSeconds: number;
  timeoutMs: number;
  enabled: boolean;
  latest: MongoMonitorLatest | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function monitorHealthy(m: MongoMonitor): boolean {
  return Boolean(m.enabled && m.latest?.ok);
}

export function MonitorsClient() {
  const { data, isLoading, mutate } = useSWR<{
    monitors: MongoMonitor[];
    targetMongoConfigured: boolean;
  }>('/api/monitors/mongodb', fetcher, {
    refreshInterval: 10000,
  });

  const [name, setName] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [timeoutMs, setTimeoutMs] = useState(8000);
  const [submitting, setSubmitting] = useState(false);

  const monitors = data?.monitors ?? [];
  const targetMongoConfigured = data?.targetMongoConfigured ?? false;

  const summary = useMemo(() => {
    const enabled = monitors.filter((m) => m.enabled).length;
    const healthy = monitors.filter((m) => monitorHealthy(m)).length;
    return { total: monitors.length, enabled, healthy };
  }, [monitors]);

  const createMonitor = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/monitors/mongodb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, intervalSeconds, timeoutMs, enabled: true }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? 'Create failed');
      }
      setName('');
      setIntervalSeconds(60);
      setTimeoutMs(8000);
      toast.success('Monitor added');
      mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  const runCheck = async (id: string) => {
    const res = await fetch(`/api/monitors/mongodb/${id}/check`, { method: 'POST' });
    if (!res.ok) {
      toast.error('Check failed');
      return;
    }
    const json = await res.json().catch(() => null);
    const err = json?.monitor?.lastError;
    toast[err ? 'error' : 'success'](err ? 'Check failed' : 'Check completed');
    mutate();
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/monitors/mongodb/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Delete failed');
      return;
    }
    toast.success('Monitor removed');
    mutate();
  };

  const toggleEnabled = async (m: MongoMonitor) => {
    const res = await fetch(`/api/monitors/mongodb/${m._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !m.enabled }),
    });
    if (!res.ok) {
      toast.error('Update failed');
      return;
    }
    mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Monitors</h1>
          <p className="mt-1 text-sm text-ink-muted">Advanced MongoDB monitoring from env target URI.</p>
          <p className="mt-1 text-xs text-ink-soft">
            {summary.total} total · {summary.enabled} enabled · {summary.healthy} healthy
          </p>
        </div>
        <button onClick={() => mutate()} className="btn-secondary">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {!targetMongoConfigured && (
        <div className="card card-pad text-sm text-danger">
          `TARGET_MONGODB_URI` is not configured. Add it to `.env` and restart the app.
        </div>
      )}

      <form onSubmit={createMonitor} className="card card-pad space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prod Mongo" required />
          </div>
          <div>
            <label className="label">Interval (seconds)</label>
            <input type="number" className="input" min={10} max={3600} value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Timeout (ms)</label>
            <input type="number" className="input" min={1000} max={60000} value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Target URI source</label>
            <div className="input flex items-center text-xs text-ink-soft">Environment variable: `TARGET_MONGODB_URI`</div>
          </div>
        </div>
        <button disabled={submitting || !targetMongoConfigured} className="btn-primary" type="submit">
          <PlusCircle className="h-4 w-4" />
          Add monitor
        </button>
      </form>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-20 w-full" />)}</div>
        ) : monitors.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-ink-muted">No MongoDB monitors yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {monitors.map((m) => {
              const healthy = monitorHealthy(m);
              return (
                <div key={m._id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Activity className={`h-4 w-4 ${healthy ? 'text-success' : 'text-danger'}`} />
                      <Link className="truncate font-medium text-ink hover:underline" href={`/monitors/${m._id}`}>
                        {m.name}
                      </Link>
                      <span className={`chip text-[10px] ${m.enabled ? 'chip-success' : 'chip-muted'}`}>{m.enabled ? 'enabled' : 'paused'}</span>
                      <span className={`chip text-[10px] ${healthy ? 'chip-success' : 'chip-muted'}`}>{healthy ? 'healthy' : 'unhealthy'}</span>
                    </div>
                    <div className="mt-1 text-xs text-ink-soft">Target URI: env(`TARGET_MONGODB_URI`)</div>
                    <div className="mt-1 text-xs text-ink-muted">
                      checked {timeAgo(m.latest?.ts)} · latency {m.latest?.latencyMs ?? 0} ms · version {m.latest?.serverVersion ?? 'n/a'} · conn {m.latest?.connectionsCurrent ?? 'n/a'} · ops/s {(m.latest?.opsPerSec ?? 0).toFixed(1)} · net {formatBps((m.latest?.netInBps ?? 0) + (m.latest?.netOutBps ?? 0))}
                    </div>
                    {m.latest?.error && <div className="mt-1 text-xs text-danger">{m.latest.error}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/monitors/${m._id}`} className="btn-secondary">Details</Link>
                    <button className="btn-secondary" onClick={() => toggleEnabled(m)}>{m.enabled ? 'Pause' : 'Resume'}</button>
                    <button className="btn-secondary" onClick={() => runCheck(m._id)}>Check now</button>
                    <button className="btn-danger" onClick={() => remove(m._id)}>
                      <Trash2 className="h-4 w-4" />Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
