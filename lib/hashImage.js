import crypto from 'crypto';

export async function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
