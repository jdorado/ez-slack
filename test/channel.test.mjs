import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Channel, incoming, scopeFor, chunks } from '../src/channel.mjs';
import { Receipts } from '../src/storage.mjs';

const identity = {teamId:'T123456', appId:'A123456', botUserId:'U999999'};
const event = (n = 1, text = 'Hello', channel = 'C123456', threadTs) => ({type:'event_callback', team_id:identity.teamId, api_app_id:identity.appId, event_id:`Ev12345${n}`, event:{type:'message',channel,channel_type:'channel',user:'U123456',text,ts:`1234567.00000${n}`,...(threadTs === undefined ? {} : {thread_ts:threadTs})}});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ez-slack-contract-'));
  const receipts = new Receipts(directory), calls = [], sends = [], settings = new Map(), runs = new Map();
  const models = [{cli:'codex',provider:'openai',model:'model-a',efforts:['low','medium']},{cli:'codex',provider:'openai',model:'model-b',efforts:['low','medium']}];
  const call = async (path, body) => {
    calls.push({path,body});
    if (options.call) return options.call(path, body);
    if (path.startsWith('/v1/scope-control?')) {
      const scope = new URLSearchParams(path.split('?')[1]).get('scope');
      const value = settings.get(scope) ?? {activeSessionId:null,ai:{selectedId:'default',presets:[{id:'default',cli:'codex',model:'model-a',effort:'low'}]},models};
      if (body) {
        assert.equal(body.expectedSession, value.activeSessionId);
        if (body.action === 'model') {value.ai.selectedId='choice';value.ai.presets=[{id:'choice',cli:body.cli,provider:body.provider,model:body.model,effort:body.effort}];}
        if (body.action === 'new' || !value.activeSessionId) value.activeSessionId = `session-${scope}`;
        settings.set(scope, value);
      }
      return structuredClone(value);
    }
    if (path === '/v1/runs') {
      const id = `r_app_${String(runs.size + 1).padStart(64, '0')}`;
      const run = {id,scope:body.scope,status:'completed',messages:[{id:'reply',text:`Reply to ${body.text}`}],approvals:[]}; runs.set(id,run); return run;
    }
    if (path.endsWith('/cancel')) return {status:'cancelled'};
    return runs.get(path.split('/').at(-1));
  };
  const slack = {send:async(channel,text,key,threadTs)=> {sends.push({channel,text,key,threadTs}); if(options.send) return options.send(channel,text,key,threadTs); return {channel,ts:'1234567.999999',state:'accepted',...(threadTs === undefined ? {} : {threadTs})};}};
  const agent = new Channel({identity,receipts,slack,call,connection:{}});
  t.after(async () => {await settled(agent);agent.close();await receipts.serial;await rm(directory,{recursive:true,force:true});});
  return {agent,receipts,calls,sends,settings,runs,directory};
}
async function settled(agent) { for(let i=0;i<100 && agent.watching.size;i++) await new Promise(r=>setTimeout(r,10)); assert.equal(agent.watching.size,0); }

test('only human channel messages from the pinned workspace/app enter a scope', () => {
  assert.equal(incoming(event(),identity).scope,scopeFor('T123456','C123456'));
  for(const alter of [p=>p.team_id='T999999',p=>p.api_app_id='A999999',p=>p.event.bot_id='B123456',p=>p.event.user='U999999',p=>p.event.subtype='message_changed',p=>p.event.channel_type='im',p=>p.event.channel='../bad',p=>p.event.text=' '.repeat(10),p=>p.event.text='a'.repeat(16001),p=>p.event_id='../bad']) {
    const p=event();alter(p);assert.equal(incoming(p,identity),null);
  }
  const thread=event(1,'Hello','C123456','123.456');assert.equal(incoming(thread,identity).scope,scopeFor('T123456','C123456','123.456'));
  assert.notEqual(incoming(thread,identity).scope,incoming(event(),identity).scope);
  for(const threadTs of [null,123,'','../bad','123',`${'1'.repeat(21)}.123`]) assert.equal(incoming(event(1,'Hello','C123456',threadTs),identity),null);
});
test('thread roots isolate scopes and every reply resumes its root, with durable reply destinations', async t => {
  const f=await fixture(t);
  for(const [n,root] of [[1,undefined],[2,'1234567.111111'],[3,'1234567.222222'],[4,'1234567.111111']]) await f.agent.receive(event(n,'Hello','C123456',root));
  await settled(f.agent);
  const scopes=f.calls.filter(c=>c.path==='/v1/runs').map(c=>c.body.scope);
  assert.equal(new Set(scopes.slice(0,3)).size,3);assert.equal(scopes[1],scopes[3]);
  assert.deepEqual(f.sends.map(s=>s.threadTs),[undefined,'1234567.111111','1234567.222222','1234567.111111']);
  const rows=await f.receipts.load();assert.deepEqual(rows.map(r=>r.threadTs),f.sends.map(s=>s.threadTs));
  assert(rows.every(r=>r.closed && r.sends[0].state==='accepted' && r.sends[0].threadTs===r.threadTs));
  await assert.rejects(f.agent.receive(event(2,'Hello','C123456','1234567.333333')),/event ID reused/);
  assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,4);
});
test('restart renders an existing thread run into its original thread without another admission', async t => {
  const f=await fixture(t), root='1234567.111111', id=`r_app_${'1'.padStart(64,'0')}`;
  await f.receipts.change('thread-pending',r=>Object.assign(r,{channel:'C123456',threadTs:root,scope:scopeFor(identity.teamId,'C123456',root),runId:id}));
  f.runs.set(id,{id,scope:scopeFor(identity.teamId,'C123456',root),status:'completed',messages:[{id:'reply',text:'Resumed reply'}]});
  await f.agent.resumeDelivery();await settled(f.agent);await f.agent.resumeDelivery();
  assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,0);assert.equal(f.sends.length,1);assert.equal(f.sends[0].threadTs,root);
});
test('pre-upgrade receipts retain their admitted channel scope and never replay into a new thread session', async t => {
  const f=await fixture(t), p=event(1,'Hello','C123456','1234567.111111');
  const {hash}=await import('../src/storage.mjs');
  const id=`r_app_${'1'.padStart(64,'0')}`, scope=scopeFor(identity.teamId,'C123456');
  await f.receipts.change(`${identity.teamId}:${p.event_id}`,r=>Object.assign(r,{channel:'C123456',scope,inputHash:hash(p.event.text),runId:id}));
  f.runs.set(id,{id,scope,status:'completed',messages:[{id:'reply',text:'Previously admitted reply'}]});
  await f.agent.receive(p);await settled(f.agent);
  assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,0);assert.equal(f.sends[0].threadTs,undefined);
  assert.equal((await f.receipts.load())[0].scope,scope);
});
test('stable event deduplication, two distinct scopes, provider receipts and restart delivery', async t => {
  const f=await fixture(t);let acks=0;
  await Promise.all([f.agent.receive(event(1),async()=>acks++),f.agent.receive(event(1),async()=>acks++)]);
  await f.agent.receive(event(2,'Second','C654321'));
  await settled(f.agent);
  assert.equal(acks,1);assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,2);assert.equal(f.sends.length,2);
  assert.deepEqual(f.calls.filter(c=>c.path==='/v1/runs').map(c=>c.body.scope),['slack:T123456:C123456','slack:T123456:C654321']);
  const rows=await f.receipts.load();assert(rows.every(r=>r.closed && r.sends[0].state==='accepted'));
  const stored=await readFile(join(f.directory,'receipts.json'),'utf8');assert(!stored.includes('Reply to')&&!stored.includes('"status"'));
  f.agent.close();const resumed=new Channel({identity,receipts:f.receipts,slack:{send:()=>{throw Error('Duplicate send');}},call:()=>{throw Error('Duplicate turn');}});
  t.after(()=>resumed.close());await resumed.resumeDelivery();await resumed.receive(event(1));assert.equal(resumed.watching.size,0);
});
test('a concurrent duplicate is not acknowledged before durable input, including a failed write', async t => {
  const f=await fixture(t);let acks=0,writing;
  const started=new Promise(resolve=>writing=resolve);
  let rejectWrite;
  const blocked=new Promise((_,reject)=>rejectWrite=reject);
  const change=f.receipts.change.bind(f.receipts);let first=true;
  f.receipts.change=async(...args)=>{if(first){first=false;writing();await blocked;}return change(...args);};
  const original=f.agent.receive(event(),async()=>acks++);
  const failed=assert.rejects(original,/Synthetic storage failure/);
  await started;
  const duplicate=await f.agent.receive(event(),async()=>acks++);
  assert.equal(duplicate.duplicate,true);assert.equal(acks,0);
  assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,0);
  rejectWrite(Error('Synthetic storage failure'));await failed;
  assert.equal(acks,0);
  await f.agent.receive(event(),async()=>acks++);await settled(f.agent);
  assert.equal(acks,1);assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,1);
  assert.equal(f.sends.length,1);assert.equal((await f.receipts.load())[0].closed,true);
});
test('channel-local model/effort controls use exact catalog and canonical readback', async t => {
  const f=await fixture(t);
  await f.agent.receive(event(1,'!ez model codex model-b medium'));
  await f.agent.receive(event(2,'!ez ai','C654321'));
  assert.equal(f.settings.size,1);assert.equal(f.settings.get('slack:T123456:C123456').ai.presets[0].model,'model-b');
  const writes=f.calls.filter(c=>c.body?.action);assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{action:'model',cli:'codex',provider:'openai',model:'model-b',effort:'medium',expectedSession:null});
  assert(f.sends[0].text.includes('model-b / medium'));assert(f.sends[1].text.includes('model-a / low'));
  await f.agent.receive(event(3,'!ez model codex invented ultra'));assert.equal(f.calls.filter(c=>c.body?.action).length,1);
});
test('status reads live work and AI only in the requested channel or thread without mutations', async t => {
  for (const root of [undefined, '1234567.111111']) {
    const f=await fixture(t), scope=scopeFor(identity.teamId,'C123456',root);
    f.settings.set(scope,{activeSessionId:'session-current',ai:{selectedId:'choice',presets:[{id:'choice',cli:'codex',model:'model-b',effort:'medium'}]}});
    for (const [n,status] of [[1,'running'],[2,'queued'],[3,'completed']]) {
      const id=`r_app_${String(n).padStart(64,'0')}`;
      f.runs.set(id,{id,scope,status});
      await f.receipts.change(`pending-${n}`,r=>Object.assign(r,{channel:'C123456',scope,runId:id,...(root === undefined ? {} : {threadTs:root})}));
    }
    for (const [key,otherScope] of [['other-channel',scopeFor(identity.teamId,'C654321')],['other-thread',scopeFor(identity.teamId,'C123456','1234567.222222')]]) {
      await f.receipts.change(key,r=>Object.assign(r,{channel:'C123456',scope:otherScope,runId:'unrelated',uncertain:true}));
    }
    await f.agent.receive(event(10,'!ez status','C123456',root));
    assert.match(f.sends[0].text,/AI: codex \/ model-b \/ medium\nConversation: session-current/);
    assert.match(f.sends[0].text,/Work: 1 running; 1 queued; 1 finished awaiting delivery; 0 unavailable/);
    assert.match(f.sends[0].text,/Transport: 0 unconfirmed inputs; 0 receipts need attention/);
    assert.equal(f.sends[0].threadTs,root);
    assert.equal(f.calls.length,4);assert(f.calls.every(c=>c.body === undefined));
    assert(!f.calls.some(c=>c.path.includes('unrelated')));
    const persisted=await readFile(join(f.directory,'receipts.json'),'utf8');
    assert(!persisted.includes('"status"')&&!persisted.includes('session-current')&&!persisted.includes('model-b'));
  }
});
test('status exposes unavailable or mismatched runs and uncertain input without retrying', async t => {
  const f=await fixture(t), scope=scopeFor(identity.teamId,'C123456');
  for (const [key,id] of [['missing','missing-run'],['mismatch','foreign-run']]) await f.receipts.change(key,r=>Object.assign(r,{channel:'C123456',scope,runId:id}));
  f.runs.set('foreign-run',{id:'foreign-run',scope:scopeFor(identity.teamId,'C654321'),status:'running'});
  await f.receipts.change('uncertain',r=>Object.assign(r,{channel:'C123456',scope,uncertain:true,issue:'admission_unconfirmed'}));
  for (const [key,state,closed] of [['interrupted-control','uncertain',false],['rejected-control','rejected',true]]) {
    await f.receipts.change(key,r=>{Object.assign(r,{channel:'C123456',scope,closed});r.sends.push({key:'control:0',state});});
  }
  await f.agent.receive(event(10,'!ez status'));
  assert.match(f.sends[0].text,/0 running; 0 queued; 0 finished awaiting delivery; 2 unavailable/);
  assert.match(f.sends[0].text,/1 unconfirmed inputs; 3 receipts need attention/);
  assert(f.calls.every(c=>c.body === undefined));assert.equal(f.settings.size,0);
  assert.equal((await f.receipts.load()).find(r=>r.key==='uncertain').uncertain,true);
});
test('status in an unused channel creates no native conversation and help lists it', async t => {
  const f=await fixture(t);
  await f.agent.receive(event(1,'!ez status'));await f.agent.receive(event(2,'!ez help'));
  assert.match(f.sends[0].text,/Conversation: new/);
  assert.match(f.sends[0].text,/0 running; 0 queued; 0 finished awaiting delivery; 0 unavailable/);
  assert.match(f.sends[1].text,/!ez status/);
  assert.equal(f.calls.length,1);assert.equal(f.settings.size,0);assert.equal(f.runs.size,0);
});
test('thread controls change only that thread, render there, and cancel only its pending runs', async t => {
  const f=await fixture(t), a='1234567.111111', b='1234567.222222';
  await f.agent.receive(event(1,'!ez model codex model-b medium','C123456',a));
  await f.agent.receive(event(2,'!ez ai','C123456',b));
  await f.agent.receive(event(3,'!ez ai'));
  assert.equal(f.settings.size,1);assert(f.sends[0].text.startsWith('This thread:'));assert(f.sends[0].text.includes('model-b / medium'));
  assert(f.sends.slice(1).every(s=>s.text.includes('model-a / low')));
  assert.deepEqual(f.sends.map(s=>s.threadTs),[a,b,undefined]);
  for(const [key,root,n]of [['one',a,1],['two',b,2],['three',undefined,3]]) await f.receipts.change(key,r=>Object.assign(r,{channel:'C123456',threadTs:root,scope:scopeFor(identity.teamId,'C123456',root),runId:`r_app_${String(n).padStart(64,'0')}`}));
  await f.agent.receive(event(4,'!ez stop','C123456',a));
  assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/cancel')).map(c=>c.path),[`/v1/runs/r_app_${'1'.padStart(64,'0')}/cancel`]);
  assert(f.sends.at(-1).text.endsWith('in this thread.'));assert.equal(f.sends.at(-1).threadTs,a);
});
test('uncertain admission never resubmits on replay or restart', async t => {
  const f=await fixture(t,{call:async()=>{throw Object.assign(Error('Lost admission response'),{admitted:undefined});}});
  await assert.rejects(f.agent.receive(event()),/Lost admission/);await f.agent.receive(event());await f.agent.resumeDelivery();
  assert.equal(f.calls.length,1);assert.equal((await f.receipts.load())[0].uncertain,true);
});
test('a lost Socket acknowledgement does not discard durable human input', async t => {
  const f=await fixture(t);
  await f.agent.receive(event(),async()=>{throw Error('Slack socket disconnected');});
  await settled(f.agent);await f.agent.receive(event());
  assert.equal(f.calls.filter(c=>c.path==='/v1/runs').length,1);assert.equal(f.sends.length,1);
});
test('uncertain Slack send stays unconfirmed and is not resent after restart', async t => {
  const f=await fixture(t,{send:()=>{throw Object.assign(Error('Lost provider response'),{uncertain:true});}});
  await f.agent.receive(event());await settled(f.agent);await f.agent.receive(event());await f.agent.resumeDelivery();
  assert.equal(f.sends.length,1);const row=(await f.receipts.load())[0];assert.equal(row.sends[0].state,'uncertain');assert.equal(row.uncertain,true);
});
test('partially delivered reply resumes remaining chunks without replaying accepted parts', async t => {
  const f=await fixture(t);const receipt=await f.receipts.change('delivery',r=>{r.channel='C123456';});
  await f.agent.deliver(receipt,'reply','🙂'.repeat(4000));await f.agent.deliver(receipt,'reply','🙂'.repeat(4000));
  assert.equal(f.sends.length,3);assert.deepEqual(f.sends.map(s=>s.text).join(''),'🙂'.repeat(4000));assert(f.sends.every(s=>s.text.length<=3900));
  assert(chunks('x'.repeat(8000)).every(s=>s.length<=3900));
});
test('stop cancels only known runs in the channel, not another conversation', async t => {
  const f=await fixture(t);
  for(const [key,channel,n]of [['one','C123456',1],['two','C654321',2]]) await f.receipts.change(key,r=>Object.assign(r,{channel,scope:scopeFor(identity.teamId,channel),runId:`r_app_${String(n).padStart(64,'0')}`}));
  await f.agent.receive(event(3,'!ez stop'));
  assert.deepEqual(f.calls.map(c=>c.path),[`/v1/runs/r_app_${'1'.padStart(64,'0')}/cancel`]);
});
test('mutating controls with a lost response are not repeated', async t => {
  const f=await fixture(t,{call:async(path,body)=>{if(body)throw Error('Lost control');return {activeSessionId:null,models:[],ai:{presets:[]}};}});
  await f.agent.receive(event(1,'!ez new'));await f.agent.receive(event(1,'!ez new'));
  assert.equal(f.calls.filter(c=>c.body).length,1);assert.equal(f.sends.length,1);assert(f.sends[0].text.includes('not confirmed'));
});
