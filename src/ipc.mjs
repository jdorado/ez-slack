import http from 'node:http';
import { join } from 'node:path';
export async function rpc(directory, command, args = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: join(directory, 'slack.sock'), path: '/', method: 'POST', headers: {'content-type': 'application/json'} }, response => {
      const chunks = []; let size = 0;
      response.on('data', c => { size += c.length; if (size > 262144) { response.destroy(); reject(Error('Response too large')); } else chunks.push(c); });
      response.on('end', () => {
        try { const v = JSON.parse(Buffer.concat(chunks)); if (!v.ok) throw Error(v.error || 'Slack service unavailable'); resolve(v.data); }
        catch (e) { reject(e); }
      });
      response.on('error', reject);
    });
    request.setTimeout(20000, () => request.destroy(Error('Slack service timeout')));
    request.on('error', reject);
    request.end(JSON.stringify({ command, args }));
  });
}
export async function jsonBody(request, max = 16384) {
  let bytes = 0; const parts = [];
  for await (const part of request) { bytes += part.length; if (bytes > max) throw Error('Request too large'); parts.push(part); }
  let v;
  try { v = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Error('Invalid JSON input'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Expected JSON object');
  return v;
}
