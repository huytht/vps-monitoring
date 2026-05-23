import mongoose, { Model, Schema } from 'mongoose';

export interface IMongoMonitorMetric {
  monitorId: string;
  ts: Date;
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
  opsPerSec?: number;
  netBytesIn?: number;
  netBytesOut?: number;
  netNumRequests?: number;
  netInBps?: number;
  netOutBps?: number;
  wtCacheBytes?: number;
  wtDirtyBytes?: number;
  queueTotal?: number;
  queueReaders?: number;
  queueWriters?: number;
  serverStatusError?: string;
  replSetStatusError?: string;
  dbStatsError?: string;
}

const MongoMonitorMetricSchema = new Schema<IMongoMonitorMetric>(
  {
    monitorId: { type: String, required: true, index: true },
    ts: { type: Date, required: true, index: true },
    ok: { type: Boolean, default: false },
    latencyMs: { type: Number, default: 0 },
    error: { type: String, maxlength: 512 },
    serverVersion: { type: String, maxlength: 64 },
    host: { type: String, maxlength: 255 },
    replSetName: { type: String, maxlength: 128 },
    replState: { type: String, maxlength: 64 },
    dbName: { type: String, maxlength: 128 },
    dbCollections: { type: Number, min: 0 },
    dbObjects: { type: Number, min: 0 },
    dbDataSizeBytes: { type: Number, min: 0 },
    dbStorageSizeBytes: { type: Number, min: 0 },
    dbIndexSizeBytes: { type: Number, min: 0 },
    connectionsCurrent: { type: Number, min: 0 },
    connectionsAvailable: { type: Number, min: 0 },
    connectionsTotalCreated: { type: Number, min: 0 },
    opQuery: { type: Number, min: 0 },
    opInsert: { type: Number, min: 0 },
    opUpdate: { type: Number, min: 0 },
    opDelete: { type: Number, min: 0 },
    opGetMore: { type: Number, min: 0 },
    opCommand: { type: Number, min: 0 },
    opsPerSec: { type: Number, min: 0 },
    netBytesIn: { type: Number, min: 0 },
    netBytesOut: { type: Number, min: 0 },
    netNumRequests: { type: Number, min: 0 },
    netInBps: { type: Number, min: 0 },
    netOutBps: { type: Number, min: 0 },
    wtCacheBytes: { type: Number, min: 0 },
    wtDirtyBytes: { type: Number, min: 0 },
    queueTotal: { type: Number, min: 0 },
    queueReaders: { type: Number, min: 0 },
    queueWriters: { type: Number, min: 0 },
    serverStatusError: { type: String, maxlength: 512 },
    replSetStatusError: { type: String, maxlength: 512 },
    dbStatsError: { type: String, maxlength: 512 },
  },
  { timestamps: false }
);

MongoMonitorMetricSchema.index({ monitorId: 1, ts: -1 });

export const MongoMonitorMetric: Model<IMongoMonitorMetric> =
  mongoose.models.MongoMonitorMetric ||
  mongoose.model<IMongoMonitorMetric>('MongoMonitorMetric', MongoMonitorMetricSchema);
