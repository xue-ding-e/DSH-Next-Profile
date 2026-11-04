import { readFileSync } from 'node:fs';

/** An optional private JSON array adds exact deny values without saving them in this repository. */
export function privateDenyValues(environment = process.env) {
  if (!environment.DSH_PROFILE_DENY_SECRETS_FILE) return [];
  let value;
  try { value = JSON.parse(readFileSync(environment.DSH_PROFILE_DENY_SECRETS_FILE, 'utf8')); }
  catch { throw new Error('Cannot read the private deny file as a JSON array. Its contents are omitted from diagnostics.'); }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length < 8)) {
    throw new Error('The private deny file must be a JSON array of secret strings, at least eight characters each.');
  }
  return value;
}

export function assertNoSecrets(name, bytes, denied = privateDenyValues()) {
  if (denied.some(secret => bytes.includes(Buffer.from(secret)))) {
    throw new Error(`A protected secret was found in ${name}; release creation refused.`);
  }
  const text = bytes.toString('utf8');
  if (/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|pt-[A-Za-z0-9_-]{16,}|GOCSPX-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u.test(text)
    || /(?:^|[^A-Za-z0-9_])1\/\/[A-Za-z0-9_-]{20,}/u.test(text)
    || /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/u.test(text)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)
    || /\b(?:Bearer|Basic)\s+[A-Za-z0-9_+/.=-]{24,}/u.test(text)) {
    throw new Error(`A credential was found in ${name}; release creation refused.`);
  }
}
