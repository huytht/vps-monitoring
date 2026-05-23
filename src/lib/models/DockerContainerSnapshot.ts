import mongoose, { Model, Schema } from 'mongoose';

export interface IDockerContainerSnapshot {
  agentId: string;
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
  ts: Date;
}

const DockerContainerSnapshotSchema = new Schema<IDockerContainerSnapshot>(
  {
    agentId: { type: String, required: true, index: true },
    containerId: { type: String, required: true },
    name: { type: String, default: '' },
    image: { type: String, default: '' },
    state: { type: String, default: '' },
    status: { type: String, default: '' },
    cpuPercent: { type: Number, min: 0 },
    memUsage: { type: String, default: '' },
    memPercent: { type: Number, min: 0 },
    netIO: { type: String, default: '' },
    blockIO: { type: String, default: '' },
    pids: { type: Number, min: 0 },
    ts: { type: Date, required: true, index: true },
  },
  { timestamps: false }
);

DockerContainerSnapshotSchema.index({ agentId: 1, containerId: 1 }, { unique: true });
DockerContainerSnapshotSchema.index({ agentId: 1, ts: -1 });

export const DockerContainerSnapshot: Model<IDockerContainerSnapshot> =
  mongoose.models.DockerContainerSnapshot ||
  mongoose.model<IDockerContainerSnapshot>('DockerContainerSnapshot', DockerContainerSnapshotSchema);
