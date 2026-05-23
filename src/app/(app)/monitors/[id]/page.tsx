import { MonitorDetailClient } from './MonitorDetailClient';

interface PageProps {
  params: { id: string };
}

export const dynamic = 'force-dynamic';

export default function MonitorDetailPage({ params }: PageProps) {
  return <MonitorDetailClient monitorId={params.id} />;
}
