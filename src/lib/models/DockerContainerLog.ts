import mongoose, { Model, Schema } from 'mongoose';

export interface IDockerContainerLog {
  agentId: string;
  containerId: string;
  name: string;
  logTail: string;
  ts: Date;
}

const DockerContainerLogSchema = new Schema<IDockerContainerLog>(
  {
    agentId: { type: String, required: true, index: true },
    containerId: { type: String, required: true },
    name: { type: String, default: '' },
    logTail: { type: String, default: '' },
    ts: { type: Date, required: true, index: true },
  },
  { timestamps: false }
);

DockerContainerLogSchema.index({ agentId: 1, containerId: 1 }, { unique: true });
DockerContainerLogSchema.index({ agentId: 1, ts: -1 });

export const DockerContainerLog: Model<IDockerContainerLog> =
  mongoose.models.DockerContainerLog ||
  mongoose.model<IDockerContainerLog>('DockerContainerLog', DockerContainerLogSchema);
