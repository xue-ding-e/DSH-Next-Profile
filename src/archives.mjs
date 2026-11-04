import { createHash } from 'node:crypto';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export function archiveUrl(value, initial = true) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || (initial && (url.search || !url.pathname.endsWith('.tgz')))) {
    throw new Error('Archive URL must be a public HTTPS .tgz URL without credentials, query or fragment.');
  }
  return url.href;
}

/** Download public locked artifacts without account credentials or lifecycle execution. */
export async function downloadArchive(plugin, request = fetch) {
  let url = archiveUrl(plugin.url);
  const signal = AbortSignal.timeout(120_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await request(url, { redirect: 'manual', credentials: 'omit', signal,
      headers: { 'User-Agent': 'dsh-next-profile-installer', Accept: 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 5) throw new Error(`Archive redirect limit/target invalid: ${plugin.name}`);
      url = archiveUrl(new URL(location, url).href, false);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Public archive download failed (${response.status}): ${plugin.name}`);
    }
    if (Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES) {
      await response.body?.cancel();
      throw new Error(`Archive exceeds download size limit: ${plugin.name}`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) throw new Error(`Archive exceeds download size limit: ${plugin.name}`);
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex') !== plugin.sha256) {
      throw new Error(`Archive SHA-256 mismatch: ${plugin.name}`);
    }
    return bytes;
  }
  throw new Error(`Archive could not be downloaded: ${plugin.name}`);
}
