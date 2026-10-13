import mongoose from 'mongoose';

// `plan` is the current format (see src/plan/types.ts). The array fields are the legacy
// format, still read so older saves can be migrated on load.
export type BuildData = {
  plan?: any;
  rooms?: any[];
  walls?: any[];
  surfaces?: any[];
  doors?: any[];
  windows?: any[];
  assets?: any[];
};

export type UserType = {
  _id: string;
  email: string;
  passwordHash: string;
  name: string;
  builds: {
    p1?: BuildData;
    p2?: BuildData;
  };
  createdAt: string;
  updatedAt: string;
};

let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

export async function connectToDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vastu-3d-visualizer';
  
  if (cached.conn && cached.uri === uri) {
    return cached.conn;
  }

  if (!cached.promise || cached.uri !== uri) {
    const opts = {
      bufferCommands: false,
    };

    cached.uri = uri;
    cached.promise = mongoose.connect(uri, opts).then((mongoose) => {
      return mongoose;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

const buildDataSchema = new mongoose.Schema({
  rooms: { type: Array, default: [] },
  walls: { type: Array, default: [] },
  surfaces: { type: Array, default: [] },
  doors: { type: Array, default: [] },
  windows: { type: Array, default: [] },
  assets: { type: Array, default: [] },
  plan: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
}, { timestamps: true });

const buildSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: String, required: true },
  data: { type: buildDataSchema, default: () => ({}) },
}, { timestamps: true });

const chatHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: String, required: true },
  messages: [{
    role: { type: String, required: true },
    content: { type: String, required: true }
  }]
}, { timestamps: true });

// What the cloud model read from an uploaded image, keyed by a hash of the image, so the same
// image is never sent (and billed) twice.
const imageReadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hash: { type: String, required: true },
  summary: { type: String, default: '' },
  rooms: { type: Array, default: [] },
}, { timestamps: true });
imageReadSchema.index({ userId: 1, hash: 1 }, { unique: true });

// Cloud model calls and tokens per user per day (UTC date, "YYYY-MM-DD"), for the daily limit.
const cloudUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true },
  calls: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
});
cloudUsageSchema.index({ userId: 1, day: 1 }, { unique: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const ImageRead = mongoose.models.ImageRead || mongoose.model('ImageRead', imageReadSchema);
export const CloudUsage = mongoose.models.CloudUsage || mongoose.model('CloudUsage', cloudUsageSchema);
export const Build = mongoose.models.Build || mongoose.model('Build', buildSchema);
export const ChatHistory = mongoose.models.ChatHistory || mongoose.model('ChatHistory', chatHistorySchema);
