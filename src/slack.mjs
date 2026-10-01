import { setTimeout as delay } from 'node:timers/promises';
import { validThreadTs } from './channel.mjs';
export class Slack {
  constructor(token, fetchImpl = fetch) { this.token = token; this.fetch = fetchImpl; this.sending = new Map(); this.lastSent = new Map(); }
  async call(method, body = {}, token = this.token) {
    if (!['auth.test', 'apps.connections.open', 'chat.postMessage', 'conversations.info', 'conversations.members'].includes(method)) throw Error('Unsupported Slack operation');
    const reading = method.startsWith('conversations.');
    const url = new URL(`https://slack.com/api/${method}`);
    if (reading) url.search = new URLSearchParams(body).toString();
    let response;
    try { response = await this.fetch(url.toString(), {
      method: reading ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(!reading ? {'content-type':'application/json'} : {}) },
      ...(!reading ? {body:JSON.stringify(body)} : {}), redirect: 'error', signal: AbortSignal.timeout(15000),
    }); } catch { throw Object.assign(Error('Slack transport unavailable'), { uncertain: method === 'chat.postMessage' }); }
    let data;
    try { data = await response.json(); } catch { throw Object.assign(Error('Invalid Slack response'), { uncertain: method === 'chat.postMessage' }); }
    if (!response.ok || !data.ok) {
      const code = /^[a-z_]{1,80}$/.test(data.error ?? '') ? data.error : `http_${response.status}`;
      throw Object.assign(Error(`Slack: ${code}`), { providerCode:code, uncertain: method === 'chat.postMessage' && (response.status >= 500 || response.status === 408 || !data.error) });
    }
    return data;
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
