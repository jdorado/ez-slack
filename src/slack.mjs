import { setTimeout as delay } from 'node:timers/promises';
import { validThreadTs } from './channel.mjs';
// Provider conditions that a later resend can reasonably overcome.
const transientCodes = new Set(['ratelimited', 'internal_error', 'service_unavailable', 'fatal_error', 'request_timeout']);
const transientStatus = status => status >= 500 || status === 429 || status === 408;
const transientFetchFailure = e => !/redirect/i.test(`${e?.message ?? ''} ${e?.cause?.message ?? ''}`);
// One attachment download at a time keeps worst-case memory at a single bounded file.
let downloadTail = Promise.resolve();
async function exclusive(work) {
  const turn = downloadTail.catch(() => {});
  let release; downloadTail = new Promise(resolve => { release = resolve; });
  await turn;
  try { return await work(); } finally { release(); }
}
export class Slack {
  constructor(token, fetchImpl = fetch) { this.token = token; this.fetch = fetchImpl; this.sending = new Map(); this.lastSent = new Map(); }
  async call(method, body = {}, token = this.token) {
    if (!['auth.test', 'apps.connections.open', 'chat.postMessage', 'conversations.info', 'conversations.members', 'files.info'].includes(method)) throw Error('Unsupported Slack operation');
    const reading = method.startsWith('conversations.') || method === 'files.info';
    const url = new URL(`https://slack.com/api/${method}`);
    if (reading) url.search = new URLSearchParams(body).toString();
    let response;
    try { response = await this.fetch(url.toString(), {
      method: reading ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(!reading ? {'content-type':'application/json'} : {}) },
      ...(!reading ? {body:JSON.stringify(body)} : {}), redirect: 'error', signal: AbortSignal.timeout(15000),
    }); } catch (e) { throw Object.assign(Error('Slack transport unavailable'), { uncertain: method === 'chat.postMessage', transient: transientFetchFailure(e) }); }
    const scopes = response.headers.get('x-oauth-scopes');
    if (scopes !== null) this.scopes = scopes.split(',').map(s => s.trim());
    let data;
    try { data = await response.json(); } catch { throw Object.assign(Error('Invalid Slack response'), { uncertain: method === 'chat.postMessage', transient: transientStatus(response.status) }); }
    if (!response.ok || !data.ok) {
      const code = /^[a-z_]{1,80}$/.test(data.error ?? '') ? data.error : `http_${response.status}`;
      throw Object.assign(Error(`Slack: ${code}`), { providerCode:code, transient: transientStatus(response.status) || transientCodes.has(code), uncertain: method === 'chat.postMessage' && (response.status >= 500 || response.status === 408 || !data.error) });
    }
    return data;
  }
  attachment(id) { return exclusive(() => this.#download(id)); }
  async #download(id) {
    if (!/^F[A-Z0-9]{5,40}$/.test(id ?? '')) throw Error('Invalid Slack file identity');
    const {file} = await this.call('files.info', {file:id});
    const limit = 10 * 1024 * 1024;
    if (file?.id !== id || file.mode !== 'hosted' || file.is_external ||
        typeof file.name !== 'string' || !file.name.length || file.name.length > 255 ||
        !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limit) throw Error('Unsupported Slack attachment');
    const url = new URL(file.url_private_download ?? file.url_private);
    if (url.protocol !== 'https:' || url.hostname !== 'files.slack.com' || url.port || url.username || url.password || url.hash || !url.pathname.startsWith('/files-pri/')) throw Error('Invalid Slack file URL');
    let response;
    try { response = await this.fetch(url.toString(), {headers:{authorization:`Bearer ${this.token}`}, redirect:'error', signal:AbortSignal.timeout(15000)}); }
    catch (e) { throw Object.assign(Error('Slack attachment download failed'), {transient: transientFetchFailure(e)}); }
    if (!response.ok || !response.body) throw Object.assign(Error('Slack attachment download failed'), {transient: transientStatus(response.status)});
    // Fill one buffer sized by the verified metadata; there is no chunk list to hold alongside it.
    const bytes = Buffer.allocUnsafe(file.size); let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        let part;
        try { part = await reader.read(); } catch (e) { throw Object.assign(Error('Slack attachment download interrupted'), {transient: transientFetchFailure(e)}); }
        if (part.done) break;
        const value = part.value;
        if (size + value.length > limit) throw Error('Oversized Slack attachment');
        if (size + value.length > file.size) throw Error('Slack attachment size mismatch');
        bytes.set(value, size); size += value.length;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (size !== file.size) throw Error('Slack attachment size mismatch');
    const pdf = bytes.subarray(0,5).toString() === '%PDF-';
    const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    let text = false;
    if (/\.(txt|md|markdown)$/i.test(file.name) && !bytes.includes(0)) {
      try { new TextDecoder('utf-8', {fatal:true}).decode(bytes); text = true; } catch {}
    }
    if (!(pdf || png || jpeg || webp || text)) throw Error('Unsupported Slack attachment type');
    return {name:file.name,data:bytes.toString('base64')};
  }
  async channelMember(channel, user, bot) {
    if (![user,bot].every(id => /^[UW][A-Z0-9]{5,40}$/.test(id ?? ''))) throw Error('Invalid Slack member identity');
    const info = await this.call('conversations.info', {channel});
    if (info.channel?.id !== channel || !(info.channel.is_channel === true || info.channel.is_group === true) || info.channel.is_archived || info.channel.is_im || info.channel.is_mpim) return false;
    const missing = new Set([user,bot]);
    let cursor;
    do {
      const page = await this.call('conversations.members', {channel, limit:200, ...(cursor ? {cursor} : {})});
      if (!Array.isArray(page.members)) throw Error('Invalid Slack membership response');
      for (const member of page.members) missing.delete(member);
      if (!missing.size) return true;
      cursor = page.response_metadata?.next_cursor;
    } while (cursor);
    return false;
  }
  async send(channel, text, key, threadTs) {
    if (threadTs !== undefined && !validThreadTs(threadTs)) throw Error('Invalid Slack thread timestamp');
    const previous = this.sending.get(channel) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      // Slack's per-channel pacing is provider protocol, not an agent/workflow queue.
      const wait = (this.lastSent.get(channel) ?? 0) + 1100 - Date.now();
      if (wait > 0) await delay(wait);
      this.lastSent.set(channel, Date.now());
      const data = await this.call('chat.postMessage', { channel, text, mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false, client_msg_id: key,
        ...(threadTs === undefined ? {} : {thread_ts: threadTs}) });
      if (data.channel !== channel || !/^\d+\.\d+$/.test(data.ts ?? '') ||
        (threadTs !== undefined && data.message?.thread_ts !== threadTs)) throw Object.assign(Error('Slack receipt identity mismatch'), { uncertain: true });
      return { channel: data.channel, ts: data.ts, state: 'accepted', ...(threadTs === undefined ? {} : {threadTs}) };
    });
    this.sending.set(channel, work);
    try { return await work; } finally { if (this.sending.get(channel) === work) this.sending.delete(channel); }
  }
}
