'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Cpu,
  HardDrive,
  Loader2,
  Logs,
  MemoryStick,
  Network,
  Pencil,
  RefreshCw,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusDot } from '@/components/StatusDot';
import { OsBadge } from '@/components/OsBadge';
import { UsageBar } from '@/components/UsageBar';
import { MetricChart } from '@/components/MetricChart';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RenameServerDialog } from '@/components/RenameServerDialog';
import { ModalFrame } from '@/components/ModalFrame';
import { formatBps, formatBytes, formatUptime, percent, timeAgo } from '@/lib/utils';

interface AgentDetail {
  agentId: string;
  hostname: string;
  label?: string;
  os: string;
  osVersion: string;
  kernel: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  totalDiskBytes: number;
  publicIp?: string;
  privateIp?: string;
  tags: string[];
  online: boolean;
  lastSeenAt?: string;
  registeredAt: string;
  latest: {
    cpuPercent: number;
    memUsedBytes: number;
    memTotalBytes: number;
    swapUsedBytes: number;
    swapTotalBytes: number;
    diskUsedBytes: number;
    diskTotalBytes: number;
    netRxBps: number;
    netTxBps: number;
    uptimeSeconds: number;
    processCount: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
  } | null;
}

interface MetricPoint {
  ts: string;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  netRxBps: number;
  netTxBps: number;
  loadAvg1: number;
}

interface DockerContainer {
  containerId: string;
  name: string;
  image: string;
  state: string;
  status: string;
  cpuPercent?: number;
  memUsage?: string;
  memPercent?: number;
  netIO?: string;
  blockIO?: string;
  pids?: number;
  ts: string;
}

interface ContainerLogPayload {
  containerId: string;
  name: string;
  ts: string;
  logTail: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const RANGES = [
  { v: '1h', label: '1h' },
  { v: '6h', label: '6h' },
  { v: '24h', label: '24h' },
  { v: '7d', label: '7d' },
];

export function ServerDetailClient({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [range, setRange] = useState('1h');
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logDataList, setLogDataList] = useState<ContainerLogPayload[]>([]);
  const [activeLogContainerIds, setActiveLogContainerIds] = useState<string[]>([]);
  const [selectedContainerIds, setSelectedContainerIds] = useState<string[]>([]);
  const [autoScrollOnNextLoad, setAutoScrollOnNextLoad] = useState(false);
  const logPanelRefs = useRef<Record<string, HTMLPreElement | null>>({});

  const { data, isLoading, mutate } = useSWR<{ agent: AgentDetail }>(
    `/api/agents/${agentId}`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: metricsData, isLoading: loadingMetrics } = useSWR<{ metrics: MetricPoint[] }>(
    `/api/agents/${agentId}/metrics?range=${range}`,
    fetcher,
    { refreshInterval: 10000 }
  );
  const { data: dockerData, isLoading: loadingDocker, mutate: mutateDocker } = useSWR<{
    containers: DockerContainer[];
  }>(`/api/agents/${agentId}/containers`, fetcher, { refreshInterval: 10000 });

  const agent = data?.agent;
  const metrics = metricsData?.metrics ?? [];
  const containers = dockerData?.containers ?? [];
  const sortedContainers = [...containers].sort((a, b) => {
    const ar = a.state === 'running' ? 0 : 1;
    const br = b.state === 'running' ? 0 : 1;
    if (ar !== br) return ar - br;
    const an = (a.name || '').toLowerCase();
    const bn = (b.name || '').toLowerCase();
    const byName = an.localeCompare(bn);
    if (byName !== 0) return byName;
    return a.containerId.localeCompare(b.containerId);
  });

  const fetchLogsForContainers = async (containerIds: string[]) => {
    const uniqueIds = Array.from(new Set(containerIds));
    if (!uniqueIds.length) return;
    const results = await Promise.all(
      uniqueIds.map(async (containerId) => {
        const res = await fetch(`/api/agents/${agentId}/containers/${containerId}/logs`);
        if (!res.ok) throw new Error(`Failed to load logs for ${containerId.slice(0, 12)}`);
        return (await res.json()) as ContainerLogPayload;
      })
    );
    const order = new Map(uniqueIds.map((id, idx) => [id, idx]));
    return results.sort(
      (a, b) => (order.get(a.containerId) ?? 0) - (order.get(b.containerId) ?? 0)
    );
  };

  const loadLogs = async (containerIds: string[]) => {
    const uniqueIds = Array.from(new Set(containerIds));
    if (!uniqueIds.length) return;
    setLogLoading(true);
    setLogOpen(true);
    setLogSearch('');
    setLogDataList([]);
    setAutoScrollOnNextLoad(true);
    setActiveLogContainerIds(uniqueIds);
    try {
      const results = await fetchLogsForContainers(uniqueIds);
      if (!results) throw new Error('No logs loaded');
      setLogDataList(results);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load logs');
      setLogOpen(false);
    } finally {
      setLogLoading(false);
    }
  };

  const scrollAllLogsToBottom = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const item of logDataList) {
          const el = logPanelRefs.current[item.containerId];
          if (el) el.scrollTop = el.scrollHeight;
        }
      });
    });
  };

  useEffect(() => {
    if (!autoScrollOnNextLoad || !logDataList.length) return;
    scrollAllLogsToBottom();
    setAutoScrollOnNextLoad(false);
  }, [autoScrollOnNextLoad, logDataList]);

  useEffect(() => {
    if (!logOpen || !activeLogContainerIds.length) return;
    const timer = setInterval(async () => {
      try {
        const results = await fetchLogsForContainers(activeLogContainerIds);
        if (results) setLogDataList(results);
      } catch {
        // Keep last rendered logs; user can still manually refresh page.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [logOpen, activeLogContainerIds]);

  const openLogs = async (containerId: string) => {
    await loadLogs([containerId]);
  };

  const openSelectedLogs = async () => {
    if (!selectedContainerIds.length) {
      toast.error('Select at least one container');
      return;
    }
    await loadLogs(selectedContainerIds);
  };

  const toggleContainer = (containerId: string) => {
    setSelectedContainerIds((prev) =>
      prev.includes(containerId) ? prev.filter((x) => x !== containerId) : [...prev, containerId]
    );
  };

  const toggleAllContainers = () => {
    setSelectedContainerIds((prev) =>
      prev.length === sortedContainers.length ? [] : sortedContainers.map((c) => c.containerId)
    );
  };

  const performDelete = async () => {
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Failed to delete');
      throw new Error('delete failed');
    }
    toast.success('Server removed');
    router.push('/servers');
  };

  const saveRename = async (trimmed: string) => {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: trimmed }),
    });
    if (!res.ok) {
      toast.error('Failed to update');
      throw new Error('rename failed');
    }
    toast.success('Updated');
    mutate();
  };

  const getFilteredLog = (raw: string): string => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return raw;
    const lines = raw.split('\n');
    const matched = lines.filter((line) => line.toLowerCase().includes(q));
    return matched.length ? matched.join('\n') : '(no matching lines)';
  };

  if (isLoading && !agent) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading server…
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="card card-pad text-center">
        <p className="text-ink-muted">Server not found.</p>
        <Link href="/servers" className="btn-secondary mt-4">
          Back to servers
        </Link>
      </div>
    );
  }

  const latest = agent.latest;
  const memPct = percent(latest?.memUsedBytes ?? 0, latest?.memTotalBytes ?? agent.totalMemoryBytes);
  const diskPct = percent(
    latest?.diskUsedBytes ?? 0,
    latest?.diskTotalBytes ?? agent.totalDiskBytes
  );
  const swapPct = percent(latest?.swapUsedBytes ?? 0, latest?.swapTotalBytes ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <Link
            href="/servers"
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            All servers
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusDot online={agent.online} className="h-3 w-3" />
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {agent.label || agent.hostname}
            </h1>
            <button
              type="button"
              onClick={() => setRenameOpen(true)}
              className="rounded-md p-1.5 text-ink-soft hover:bg-bg-muted hover:text-ink"
              title="Edit label"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <span
              className={`chip ${agent.online ? 'chip-success' : 'chip-muted'} text-[10px]`}
            >
              {agent.online ? 'Online' : `Last seen ${timeAgo(agent.lastSeenAt)}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            <span className="font-mono">{agent.agentId}</span>
            {agent.publicIp && (
              <>
                {' · '}
                <span className="font-mono">{agent.publicIp}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              mutate();
              mutateDocker();
            }}
            className="btn-secondary"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" onClick={() => setDeleteOpen(true)} className="btn-danger">
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GaugeCard
          icon={Cpu}
          label="CPU"
          value={`${(latest?.cpuPercent ?? 0).toFixed(1)}%`}
          sub={`${agent.cpuCores} cores · load ${(latest?.loadAvg1 ?? 0).toFixed(2)}`}
          pct={latest?.cpuPercent ?? 0}
        />
        <GaugeCard
          icon={MemoryStick}
          label="Memory"
          value={`${memPct.toFixed(1)}%`}
          sub={`${formatBytes(latest?.memUsedBytes ?? 0)} / ${formatBytes(
            latest?.memTotalBytes ?? agent.totalMemoryBytes
          )}`}
          pct={memPct}
        />
        <GaugeCard
          icon={HardDrive}
          label="Disk"
          value={`${diskPct.toFixed(1)}%`}
          sub={`${formatBytes(latest?.diskUsedBytes ?? 0)} / ${formatBytes(
            latest?.diskTotalBytes ?? agent.totalDiskBytes
          )}`}
          pct={diskPct}
        />
        <GaugeCard
          icon={Network}
          label="Network"
          value={`↓ ${formatBps(latest?.netRxBps ?? 0)}`}
          sub={`↑ ${formatBps(latest?.netTxBps ?? 0)}`}
          pct={Math.min(100, ((latest?.netRxBps ?? 0) + (latest?.netTxBps ?? 0)) / 10_000_000)}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Docker containers</h2>
            <p className="text-xs text-ink-soft">
              {loadingDocker ? 'Loading…' : `${containers.length} container${containers.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button
            className="btn-secondary"
            onClick={openSelectedLogs}
            disabled={!selectedContainerIds.length}
          >
            <Logs className="h-4 w-4" />
            View selected logs ({selectedContainerIds.length})
          </button>
        </div>
        {loadingDocker ? (
          <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 w-full" />)}</div>
        ) : containers.length === 0 ? (
          <div className="px-6 py-10 text-sm text-ink-muted">
            No container stats received yet. Ensure Docker is installed and wait for next heartbeat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg-soft/40 text-left text-[11px] uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-3 py-3 font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={
                        sortedContainers.length > 0 &&
                        selectedContainerIds.length === sortedContainers.length
                      }
                      onChange={toggleAllContainers}
                      aria-label="Select all containers"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">Container</th>
                  <th className="px-3 py-3 font-medium">State</th>
                  <th className="px-3 py-3 font-medium">CPU</th>
                  <th className="px-3 py-3 font-medium">Memory</th>
                  <th className="px-3 py-3 font-medium">Net I/O</th>
                  <th className="px-3 py-3 font-medium">Block I/O</th>
                  <th className="px-3 py-3 font-medium">PIDs</th>
                  <th className="px-3 py-3 font-medium">Updated</th>
                  <th className="px-3 py-3 font-medium text-right">Logs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedContainers.map((c) => (
                  <tr key={c.containerId} className="hover:bg-bg-soft/30">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedContainerIds.includes(c.containerId)}
                        onChange={() => toggleContainer(c.containerId)}
                        aria-label={`Select ${c.name || c.containerId.slice(0, 12)}`}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink">{c.name || c.containerId.slice(0, 12)}</div>
                      <div className="text-xs text-ink-soft">{c.image}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`chip text-[10px] ${c.state === 'running' ? 'chip-success' : 'chip-muted'}`}>
                        {c.state || 'unknown'}
                      </span>
                      <div className="mt-1 text-[11px] text-ink-soft">{c.status}</div>
                    </td>
                    <td className="px-3 py-3">{typeof c.cpuPercent === 'number' ? `${c.cpuPercent.toFixed(2)}%` : 'n/a'}</td>
                    <td className="px-3 py-3">{c.memUsage || 'n/a'}{typeof c.memPercent === 'number' ? ` (${c.memPercent.toFixed(1)}%)` : ''}</td>
                    <td className="px-3 py-3">{c.netIO || 'n/a'}</td>
                    <td className="px-3 py-3">{c.blockIO || 'n/a'}</td>
                    <td className="px-3 py-3">{typeof c.pids === 'number' ? c.pids : 'n/a'}</td>
                    <td className="px-3 py-3 text-xs text-ink-muted">{timeAgo(c.ts)}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <button className="btn-secondary" onClick={() => openLogs(c.containerId)}>
                          <Logs className="h-4 w-4" />View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Performance</h2>
            <p className="text-xs text-ink-soft">
              {loadingMetrics ? 'Loading…' : `${metrics.length} data points`}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-bg-muted p-1 text-xs">
            {RANGES.map((r) => (
              <button
                key={r.v}
                onClick={() => setRange(r.v)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  range === r.v
                    ? 'bg-bg-card text-ink shadow'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
          <ChartCard title="CPU usage" hint="%">
            <MetricChart
              data={metrics}
              series={[{ key: 'cpuPercent', label: 'CPU', color: '#a1a1aa' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Memory usage" hint={formatBytes(agent.totalMemoryBytes)}>
            <MetricChart
              data={metrics.map((m) => ({
                ...m,
                memPct: m.memTotalBytes ? (m.memUsedBytes / m.memTotalBytes) * 100 : 0,
              }))}
              series={[{ key: 'memPct', label: 'Memory', color: '#71717a' }]}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              domain={[0, 100]}
            />
          </ChartCard>

          <ChartCard title="Network throughput" hint="bytes/sec">
            <MetricChart
              data={metrics}
              series={[
                {
                  key: 'netRxBps',
                  label: 'Download',
                  color: '#a1a1aa',
                  formatter: (v) => formatBps(v),
                },
                {
                  key: 'netTxBps',
                  label: 'Upload',
                  color: '#52525b',
                  formatter: (v) => formatBps(v),
                },
              ]}
              yFormatter={(v) => formatBytes(v)}
            />
          </ChartCard>

          <ChartCard title="Load average" hint="1 minute">
            <MetricChart
              data={metrics}
              series={[{ key: 'loadAvg1', label: 'Load (1m)', color: '#d4d4d8' }]}
              yFormatter={(v) => v.toFixed(2)}
            />
          </ChartCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <h3 className="mb-4 text-base font-semibold text-ink">System info</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Hostname" value={agent.hostname} mono />
            <Row label="Operating system" value={<OsBadge os={agent.os} version={agent.osVersion} />} />
            <Row label="Kernel" value={agent.kernel} mono />
            <Row label="Architecture" value={agent.arch} mono />
            <Row label="CPU" value={agent.cpuModel || '—'} />
            <Row label="Cores" value={String(agent.cpuCores)} />
            <Row label="Memory" value={formatBytes(agent.totalMemoryBytes)} />
            <Row label="Disk" value={formatBytes(agent.totalDiskBytes)} />
            <Row label="Public IP" value={agent.publicIp ?? '—'} mono />
            <Row label="Private IP" value={agent.privateIp ?? '—'} mono />
            <Row label="Uptime" value={formatUptime(latest?.uptimeSeconds ?? 0)} />
            <Row label="Processes" value={String(latest?.processCount ?? 0)} />
            <Row label="Registered" value={timeAgo(agent.registeredAt)} />
            <Row label="Last seen" value={timeAgo(agent.lastSeenAt)} />
          </dl>
        </div>

        <div className="card card-pad">
          <h3 className="mb-4 text-base font-semibold text-ink">Resource breakdown</h3>
          <div className="space-y-4">
            <UsageBar
              value={latest?.cpuPercent ?? 0}
              label="CPU"
              hint={`${(latest?.cpuPercent ?? 0).toFixed(1)}%`}
            />
            <UsageBar
              value={memPct}
              label="Memory"
              hint={`${formatBytes(latest?.memUsedBytes ?? 0)} / ${formatBytes(
                latest?.memTotalBytes ?? agent.totalMemoryBytes
              )}`}
            />
            <UsageBar
              value={swapPct}
              label="Swap"
              hint={`${formatBytes(latest?.swapUsedBytes ?? 0)} / ${formatBytes(
                latest?.swapTotalBytes ?? 0
              )}`}
            />
            <UsageBar
              value={diskPct}
              label="Disk (/)"
              hint={`${formatBytes(latest?.diskUsedBytes ?? 0)} / ${formatBytes(
                latest?.diskTotalBytes ?? agent.totalDiskBytes
              )}`}
            />
          </div>

          <div className="mt-6 rounded-xl border border-border bg-bg-soft/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ServerIcon className="h-4 w-4 text-ink-muted" />
              Load average
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              {(['loadAvg1', 'loadAvg5', 'loadAvg15'] as const).map((k, i) => (
                <div key={k} className="rounded-lg bg-bg-muted/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-soft">
                    {['1 min', '5 min', '15 min'][i]}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-ink">
                    {(latest?.[k] ?? 0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <RenameServerDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        label={agent.label}
        hostname={agent.hostname}
        onSave={saveRename}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete server?"
        description={
          <>
            Remove <span className="font-semibold text-ink">{agent.label || agent.hostname}</span> and
            all metrics. <span className="text-danger">This cannot be undone.</span>
          </>
        }
        cancelLabel="Cancel"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={performDelete}
      />
      <ModalFrame
        open={logOpen}
        onClose={() => {
          setLogOpen(false);
          setActiveLogContainerIds([]);
          setLogDataList([]);
        }}
        contentClassName="max-w-[min(98vw,1800px)]"
      >
        <div className="card mx-auto flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold text-ink">
              Container logs ({logDataList.length})
            </h3>
            <div className="flex items-center gap-2">
              <input
                className="input h-9 w-64 text-sm"
                placeholder="Search in logs…"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
              />
              <button
                className="btn-secondary"
                onClick={async () => {
                  if (!activeLogContainerIds.length) return;
                  setAutoScrollOnNextLoad(true);
                  setLogLoading(true);
                  try {
                    const results = await fetchLogsForContainers(activeLogContainerIds);
                    if (results) {
                      setLogDataList(results);
                      requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                          for (const item of results) {
                            const el = logPanelRefs.current[item.containerId];
                            if (el) el.scrollTop = el.scrollHeight;
                          }
                        });
                      });
                    }
                  } catch {
                    toast.error('Failed to refresh logs');
                  } finally {
                    setLogLoading(false);
                  }
                }}
                disabled={logLoading || !activeLogContainerIds.length}
              >
                <RefreshCw className="h-4 w-4" />
                Fetch now
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setLogOpen(false);
                  setActiveLogContainerIds([]);
                  setLogDataList([]);
                }}
              >
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-auto p-4">
            {logLoading ? (
              <div className="text-sm text-ink-muted">Loading logs…</div>
            ) : (
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                {logDataList.map((log) => (
                  <div key={log.containerId} className="rounded-lg border border-border bg-bg-soft/30">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          {log.name || log.containerId.slice(0, 12)}
                        </p>
                        <p className="text-[11px] text-ink-soft">Snapshot {timeAgo(log.ts)}</p>
                      </div>
                      <a
                        className="btn-secondary"
                        href={`/api/agents/${agentId}/containers/${log.containerId}/logs?download=1`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download
                      </a>
                    </div>
                    <pre
                      ref={(el) => {
                        logPanelRefs.current[log.containerId] = el;
                      }}
                      className="max-h-[56vh] overflow-auto p-3 text-xs leading-relaxed text-ink-muted"
                    >
                      {getFilteredLog(log.logTail || '(no logs)')}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ModalFrame>
    </div>
  );
}

function GaugeCard({
  icon: Icon,
  label,
  value,
  sub,
  pct,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub: string;
  pct: number;
}) {
  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2 text-ink-soft">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{sub}</div>
      <div className="mt-3">
        <UsageBar value={pct} />
      </div>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
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

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className={`mt-0.5 text-ink ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
