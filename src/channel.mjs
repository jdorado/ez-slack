import { randomUUID } from 'node:crypto';
import { applicationCall } from '@jc_stack/ez-agents/application-client';
import { hash } from './storage.mjs';
import { controls as controlCommands, controlHelp } from './commands.mjs';

export const validThreadTs = value => typeof value === 'string' && /^\d{1,20}\.\d{1,20}$/.test(value);
export const scopeFor = (team, channel, threadTs) => `slack:${team}:${channel}${threadTs === undefined ? '' : `:thread:${threadTs}`}`;
export function incoming(payload, identity) {
  const e = payload?.event;
  if (payload?.type !== 'event_callback' || payload.team_id !== identity.teamId || payload.api_app_id !== identity.appId ||
      !/^Ev[A-Za-z0-9]{5,80}$/.test(payload.event_id ?? '') || e?.type !== 'message' || e.subtype || e.bot_id ||
      !/^[UW][A-Z0-9]{5,40}$/.test(e.user ?? '') || e.user === identity.botUserId ||
      !/^[CG][A-Z0-9]{5,40}$/.test(e.channel ?? '') || !['channel', 'group'].includes(e.channel_type) ||
      typeof e.text !== 'string' || !e.text.trim() || e.text.length > 16000 || !/^\d+\.\d+$/.test(e.ts ?? '') ||
      (e.thread_ts !== undefined && !validThreadTs(e.thread_ts))) return null;
  return { key: `${payload.team_id}:${payload.event_id}`, requestId: `${payload.team_id}:${payload.event_id}`, channel: e.channel,
    scope: scopeFor(payload.team_id, e.channel, e.thread_ts), ...(e.thread_ts === undefined ? {} : {threadTs: e.thread_ts}),
    text: e.text, inputHash: hash(e.text) };
}
export function slashIncoming(payload, identity) {
  if (!/^\/ez(?:-[a-z0-9_-]{1,32})?$/.test(payload?.command ?? '') || payload.team_id !== identity.teamId || payload.api_app_id !== identity.appId ||
      !/^[UW][A-Z0-9]{5,40}$/.test(payload.user_id ?? '') || payload.user_id === identity.botUserId ||
      !/^[CG][A-Z0-9]{5,40}$/.test(payload.channel_id ?? '') || typeof payload.text !== 'string' || payload.text.length > 15996 ||
      typeof payload.trigger_id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(payload.trigger_id)) return null;
  const key = `${payload.team_id}:slash:${hash(payload.trigger_id).slice(0,32)}`;
  const text = `!ez ${payload.text.trim()}`;
  return { key, requestId: key, channel: payload.channel_id, scope: scopeFor(payload.team_id, payload.channel_id),
    user: payload.user_id, text, nativeControl: payload.command, inputHash: hash(JSON.stringify([payload.channel_id, payload.user_id, payload.command, text])) };
}
export function chunks(text) {
  const result = []; let part = '';
  for (const char of text) { if (part.length + char.length > 3900) { result.push(part); part = ''; } part += char; }
  if (part) result.push(part);
  return result;
}
const presetText = p => p ? [p.cli, p.model, p.effort].filter(Boolean).join(' / ') : 'Default AI';
const selectedPreset = c => c.ai?.presets?.find(p => p.id === c.ai.selectedId);
export class Channel {
  constructor({ identity, connection, receipts, slack, call = applicationCall }) {
    Object.assign(this, { identity, connection, receipts, slack, call });
    this.watching = new Map(); this.accepting = new Set(); this.closed = false;
  }
  core(path, body) { return this.call(path, body, this.connection); }
  async receive(payload, ack = async () => {}) {
    const input = incoming(payload, this.identity);
    if (!input) { await ack(); return { ignored: true }; }
    return this.receiveInput(input, ack);
  }
  async receiveSlash(payload, ack = async () => {}) {
    const input = slashIncoming(payload, this.identity);
    if (!input) { await ack(); return { ignored: true }; }
    return this.receiveInput(input, () => ack({response_type:'ephemeral',text:'Ez command received. Results appear here only if you and this agent bot are channel members.'}));
  }
  async receiveInput(input, ack) {
    // A concurrent envelope must remain unacknowledged until input is durable.
    // Slack can replay it after the first admission records its receipt.
    if (this.accepting.has(input.key)) return { duplicate: true };
    this.accepting.add(input.key);
    try {
      let duplicate = false;
      const receipt = await this.receipts.change(input.key, r => {
        if (r.channel) { if (r.inputHash !== input.inputHash || r.channel !== input.channel ||
          (r.threadTs !== undefined && r.threadTs !== input.threadTs)) throw Error('Slack event ID reused'); duplicate = true; return; }
        Object.assign(r, { channel: input.channel, scope: input.scope, requestId: input.requestId, inputHash: input.inputHash,
          ...(input.threadTs === undefined ? {} : {threadTs: input.threadTs}) });
      });
      // A failed provider acknowledgement cannot discard already recorded input.
      // Slack may replay it; the receipt prevents a second native admission.
      await ack().catch(() => {});
      if (duplicate) { if (receipt.runId && !receipt.closed) this.watch(receipt); return { duplicate: true }; }
      if (input.nativeControl) {
        try { if (!await this.slack.channelMember(input.channel, input.user, this.identity.botUserId)) throw Error('Channel not authorized'); }
        catch (e) {
          await this.receipts.change(input.key, r => { r.issue = 'channel_access_unconfirmed'; if (/^[a-z_]{1,80}$/.test(e.providerCode ?? '')) r.providerIssue = e.providerCode; r.closed = true; });
          return { ignored: true };
        }
      }
      if (input.text.trim().startsWith('!ez')) {
        // Control mutations are deliberate, once-only UI operations; never replay after uncertainty.
        let text;
        try { text = await this.control(input); }
        catch { await this.receipts.change(input.key, r => { r.issue = 'control_unconfirmed'; }); text = 'Control was not confirmed. Use !ez ai to read the current settings before trying another change.'; }
        if (input.nativeControl) text = text.replaceAll('!ez', input.nativeControl);
        await this.deliver(receipt, 'control', text);
        await this.receipts.change(input.key, r => { r.closed = true; });
      } else {
        let run;
        try { run = await this.core('/v1/runs', { requestId: input.requestId, scope: input.scope, text: input.text }); }
        catch (e) {
          await this.receipts.change(input.key, r => { r.uncertain = e.admitted !== false; if (e.runId) r.runId = e.runId; r.issue = 'admission_unconfirmed'; });
          throw e;
        }
        if (!/^r_app_[a-f0-9]{64}$/.test(run.id ?? '') || run.scope !== input.scope) throw Error('Ez admission identity mismatch');
        const saved = await this.receipts.change(input.key, r => { r.runId = run.id; });
        this.watch(saved);
      }
      return { accepted: true };
    } catch (e) {
      await this.receipts.change(input.key, r => { r.issue ??= 'channel_operation_failed'; }).catch(() => {});
      throw e;
    } finally { this.accepting.delete(input.key); }
  }
  async control(input) {
    const [prefix, command = 'help', ...args] = input.text.trim().split(/\s+/);
    const place = input.threadTs === undefined ? 'channel' : 'thread';
    if (prefix !== '!ez') return 'Use !ez help for channel controls.';
    const spec = controlCommands.find(c => c.name === command);
    if (!spec || !spec.counts.includes(args.length)) return 'Unknown control. Use !ez help.';
    if (command === 'help') return controlHelp();
    if (command === 'stop') {
      if (args.length) throw Error('Use !ez stop');
      const rows = (await this.receipts.load()).filter(r => r.scope === input.scope && r.runId && !r.closed);
      for (const r of rows) await this.core(`/v1/runs/${r.runId}/cancel`, {});
      return `Cancellation requested for ${rows.length} run(s) in this ${place}.`;
    }
    const path = `/v1/scope-control?scope=${encodeURIComponent(input.scope)}`;
    const controls = await this.core(path);
    if (command === 'status' && !args.length) {
      const unresolvedSend = r => r.sends.some(s => ['uncertain', 'rejected'].includes(s.state));
      const rows = (await this.receipts.load()).filter(r => r.scope === input.scope && r.key !== input.key && (!r.closed || r.uncertain || unresolvedSend(r)));
      const runs = rows.filter(r => r.runId && !r.closed);
      const results = await Promise.allSettled(runs.map(async r => {
        const run = await this.core(`/v1/runs/${r.runId}`);
        if (run?.id !== r.runId || run.scope !== input.scope || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(run.status)) throw Error('Ez result identity mismatch');
        return run.status;
      }));
      const count = status => results.filter(r => r.status === 'fulfilled' && r.value === status).length;
      return [`This ${place}`,
        `AI: ${presetText(selectedPreset(controls))}`,
        `Conversation: ${controls.activeSessionId ?? 'new'}`,
        `Work: ${count('running')} running; ${count('queued')} queued; ${count('completed') + count('failed') + count('cancelled')} finished awaiting delivery; ${results.filter(r => r.status === 'rejected').length} unavailable`,
        `Transport: ${rows.filter(r => !r.runId && r.uncertain).length} unconfirmed inputs; ${rows.filter(r => r.uncertain || r.issue || unresolvedSend(r)).length} receipts need attention`].join('\n');
    }
    if (command === 'ai' && !args.length) {
      return [`Current: ${presetText(selectedPreset(controls))}; conversation: ${controls.activeSessionId ?? 'new'}`,
        'Presets:', ...(controls.ai?.presets ?? []).map(p => `${p.id}: ${presetText(p)}`),
        'Models:', ...(controls.models ?? []).map(m => `${m.cli} ${m.model} [${m.efforts.join(', ')}]`)].join('\n');
    }
    let action;
    if (command === 'new' && !args.length) action = { action: 'new' };
    else if (command === 'select' && args.length === 1) action = { action: 'select', presetId: args[0] };
    else if (command === 'model' && [2, 3].includes(args.length)) {
      const candidates = (controls.models ?? []).filter(m => m.cli === args[0] && m.model === args[1]);
      if (candidates.length !== 1 || (args[2] && !candidates[0].efforts.includes(args[2]))) throw Error('Choose a model and effort from !ez ai');
      const m = candidates[0]; action = { action: 'model', cli: m.cli, provider: m.provider, model: m.model, ...(args[2] ? { effort: args[2] } : {}) };
    } else return 'Unknown control. Use !ez help.';
    await this.core(path, { ...action, expectedSession: controls.activeSessionId });
    const readback = await this.core(path);
    return `This ${place}: ${presetText(selectedPreset(readback))}; conversation: ${readback.activeSessionId}`;
  }
  async deliver(receipt, messageId, text) {
    const parts = chunks(text);
    for (let i = 0; i < parts.length; i++) {
      const key = `${messageId}:${i}`, fingerprint = hash(parts[i]); let dispatch = false;
      const saved = await this.receipts.change(receipt.key, r => {
        const old = r.sends.find(s => s.key === key);
        if (old) { if (old.hash !== fingerprint) throw Error('Delivery key reused'); return; }
        r.sends.push({ key, hash: fingerprint, clientId: randomUUID(), state: 'uncertain' }); dispatch = true;
      });
      const pending = saved.sends.find(s => s.key === key);
      if (!dispatch) { if (pending.state !== 'accepted') throw Error('Slack delivery unconfirmed; not resent'); continue; }
      try {
        const sent = await this.slack.send(receipt.channel, parts[i], pending.clientId, receipt.threadTs);
        await this.receipts.change(receipt.key, r => { Object.assign(r.sends.find(s => s.key === key), sent); });
      } catch (e) {
        await this.receipts.change(receipt.key, r => { r.uncertain = Boolean(e.uncertain); r.issue = e.uncertain ? 'slack_delivery_unconfirmed' : 'slack_delivery_rejected'; r.sends.find(s => s.key === key).state = e.uncertain ? 'uncertain' : 'rejected'; });
        throw e;
      }
    }
  }
  watch(receipt) {
    if (this.closed || this.watching.has(receipt.key)) return;
    // Poll exclusively to render the existing core inbox. No turn continuation or workflow decisions.
    const holder = { timer: null };
    this.watching.set(receipt.key, holder);
    const tick = async () => {
      if (this.closed) return;
      try {
        const run = await this.core(`/v1/runs/${receipt.runId}`);
        if (run.scope !== receipt.scope || run.id !== receipt.runId) throw Error('Ez result identity mismatch');
        for (const m of run.messages ?? []) if (typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim()) await this.deliver(receipt, m.id, m.text);
        // Approval decisions are not inferred from chat. v1 explicitly stops at this unsupported surface.
        if (run.approvals?.some(a => a.state === 'pending')) {
          await this.deliver(receipt, 'approval-required', 'This run needs an explicit Ez approval. Slack approval controls are not available in this version.');
        }
        if (['completed', 'failed', 'cancelled'].includes(run.status)) {
          if (run.status !== 'completed') await this.deliver(receipt, 'terminal', `Ez run ${run.status}.`);
          await this.receipts.change(receipt.key, r => { r.closed = true; });
          this.watching.delete(receipt.key); return;
        }
        holder.timer = setTimeout(tick, 1000);
      } catch (e) {
        await this.receipts.change(receipt.key, r => { r.issue ??= 'result_or_delivery_unavailable'; }).catch(() => {});
        this.watching.delete(receipt.key);
      }
    };
    void tick();
  }
  async resumeDelivery() {
    for (const receipt of await this.receipts.load()) if (receipt.runId && !receipt.closed && !receipt.uncertain) this.watch(receipt);
  }
  close() { this.closed = true; for (const h of this.watching.values()) clearTimeout(h.timer); this.watching.clear(); }
}
