import revokedSessionModel from '../models/revokedSessionModel.js';

export async function isSessionRevoked(tokenId) {
  if (!tokenId) return false;
  return Boolean(
    await revokedSessionModel.exists({
      tokenId,
      expiresAt: { $gt: new Date() },
    })
  );
}

export async function revokeSession(tokenId, expiresAt) {
  if (typeof tokenId !== 'string' || tokenId.trim() === '') {
    throw new TypeError('A token id is required to revoke a session');
  }
  const expiration = new Date(Number(expiresAt) * 1000);
  if (!Number.isFinite(expiration.getTime()) || expiration <= new Date()) {
    throw new TypeError('A valid future token expiration is required');
  }

  await revokedSessionModel.updateOne(
    { tokenId },
    { $setOnInsert: { expiresAt: expiration } },
    { upsert: true }
  );
}
