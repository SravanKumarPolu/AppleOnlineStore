import mongoose from 'mongoose';

const revokedSessionSchema = new mongoose.Schema(
  {
    tokenId: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

revokedSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.revokedSession ||
  mongoose.model('revokedSession', revokedSessionSchema);
