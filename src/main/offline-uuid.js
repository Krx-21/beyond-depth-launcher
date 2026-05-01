// Generate Minecraft offline-mode UUID from username
// Same algorithm as vanilla server: UUID v3 of "OfflinePlayer:<name>" (MD5 namespace)
const crypto = require('crypto');

function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  // Set version (3) and variant bits per UUID v3 spec
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

module.exports = { offlineUUID };
