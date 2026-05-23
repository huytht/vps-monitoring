import mongoose, { Model, Schema } from 'mongoose';

export interface IMongoMonitor {
  name: string;
  /** @deprecated Legacy field from old versions. New checks use env TARGET_MONGODB_URI. */
  uri?: string;
  intervalSeconds: number;
  timeoutMs: number;
  enabled: boolean;
  lastCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string;
  lastLatencyMs?: number;
  serverVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MongoMonitorSchema = new Schema<IMongoMonitor>(
  {
    name: { type: String, required: true, trim: true, maxlength: 128 },
    uri: { type: String, trim: true, maxlength: 2048 },
    intervalSeconds: { type: Number, default: 60, min: 10, max: 3600 },
    timeoutMs: { type: Number, default: 8000, min: 1000, max: 60000 },
    enabled: { type: Boolean, default: true },
    lastCheckedAt: { type: Date },
    lastSuccessAt: { type: Date },
    lastError: { type: String, maxlength: 512 },
    lastLatencyMs: { type: Number, min: 0 },
    serverVersion: { type: String, maxlength: 64 },
  },
  { timestamps: true }
);

export const MongoMonitor: Model<IMongoMonitor> =
  mongoose.models.MongoMonitor || mongoose.model<IMongoMonitor>('MongoMonitor', MongoMonitorSchema);
