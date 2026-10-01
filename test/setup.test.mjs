import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from '../src/setup.mjs';
import { saveConnection, saveSlack, validateConnection, validateSlack } from '../src/config.mjs';
import { Slack } from '../src/slack.mjs';
import { serve } from '../src/server.mjs';
import { rpc } from '../src/ipc.mjs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const config={teamId:'T123456',appId:'A123456',botToken:'xoxb-synthetic-private-bot',appToken:'xapp-synthetic-private-app'};
async function dir(t){const d=await mkdtemp(join(tmpdir(),'ez-slack-setup-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('credentials validate scheme, fields, workspace and authenticated bot identity',async t=>{
  const d=await dir(t);
  assert.throws(()=>validateConnection({url:'http://public.example',token:'a'.repeat(43)}));
  assert.throws(()=>validateConnection({url:'https://u:p@agent',token:'a'.repeat(43)}));
  assert.throws(()=>validateConnection({url:'https://agent',token:'a'.repeat(43),extra:true}));
  assert.throws(()=>validateSlack({...config,teamId:'../bad'}));
  await assert.rejects(saveSlack(d,config,{call:async()=>({team_id:'T654321',user_id:'U123456',bot_id:'B123456'})}),/different workspace/);
  const result=await saveSlack(d,config,{call:async m=>m==='auth.test'?{team_id:'T123456',user_id:'U123456',bot_id:'B123456'}:{url:'wss://private-token'}});
  assert.equal(result.botUserId,'U123456');assert(!JSON.stringify(result).includes('synthetic-private'));
  assert.equal((await stat(join(d,'slack.json'))).mode&0o777,0o600);
  let providerCalled = false;
  await assert.rejects(saveSlack(d,{...config,appId:'A654321'},{call:async()=>{providerCalled=true;}}),/different Slack app/);
  assert.equal(providerCalled,false);
  assert.equal(JSON.parse(await readFile(join(d,'slack.json'))).appId,config.appId);
});
for (const command of ['configure','configure-slack']) test(`${command}: malformed credential input never exposes JSON excerpts`,async()=>{
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[new URL('../bin/ez-slack.mjs',import.meta.url).pathname,command],{stdio:['pipe','pipe','pipe']});let output='';
    child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.end('{"token":SYNTHETIC_PRIVATE_TOKEN}');
  });
  assert.equal(result.code,1);assert(result.output.includes('Invalid JSON input'));assert(!result.output.includes('SYNTHETIC'));
});
test('setup is local and same-origin with CSRF, no secret readback',async t=>{
  const d=await dir(t);await saveConnection(d,{url:'https://agent.example',token:'a'.repeat(43)});
  let writes=0;
  const server=await setup(d,{port:0,teamId:'T123456',name:'ANNIe',coreCall:async()=>({bindingId:'b'}),slack:{call:async m=>{writes++;return m==='auth.test'?{team_id:'T123456',user_id:'U123456',bot_id:'B123456'}:{url:'wss://private-token'};}}});
  t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}`;
  const html=await (await fetch(url)).text();const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  assert(html.includes('ANNIe'));assert(html.includes('type="password"'));
  const body=new URLSearchParams({csrf,appId:config.appId,botToken:config.botToken,appToken:config.appToken});
  const request=(origin,token=csrf)=>fetch(`${url}/configure`,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...Object.fromEntries(body),csrf:token})});
  assert.equal((await request('https://evil.example')).status,403);assert.equal((await request(url,'bad')).status,400);assert.equal(writes,0);
  const saved=await request(url);assert.equal(saved.status,200);assert(!(await saved.text()).includes(config.botToken));assert.equal(writes,2);
  const badHost = await new Promise((resolve,reject)=>{const r=http.get(url,{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});
  assert.equal(badHost,403);
  const m=await (await fetch(`${url}/manifest`)).json();assert.equal(m.features.bot_user.display_name,'ANNIe');
  assert.deepEqual(m.settings.event_subscriptions.bot_events,['message.channels','message.groups']);
});
test('Slack sends are literal, receipt-bound and never retried on transport uncertainty',async()=>{
  let calls=0;const s=new Slack('private',async(url,args)=>{calls++;const body=JSON.parse(args.body);assert.equal(body.mrkdwn,false);assert.equal(body.unfurl_links,false);return Response.json({ok:true,channel:'C123456',ts:'123.456'});});
  assert.equal((await s.send('C123456','@channel <script>','key')).state,'accepted');assert.equal(calls,1);
  const lost=new Slack('private',async()=>{calls++;throw Error('Lost response');});await assert.rejects(lost.send('C123456','x','key'),e=>e.uncertain===true);assert.equal(calls,2);
  const wrong=new Slack('private',async()=>Response.json({ok:true,channel:'C654321',ts:'123.456'}));await assert.rejects(wrong.send('C123456','x','key'),e=>e.uncertain===true);
});
test('thread replies send the root timestamp and require a matching provider thread receipt',async()=>{
  const root='1234567.111111';let calls=0;
  const s=new Slack('synthetic',async(url,args)=>{calls++;const body=JSON.parse(args.body);assert.equal(body.thread_ts,root);assert.equal(body.reply_broadcast,undefined);return Response.json({ok:true,channel:'C123456',ts:'1234567.999999',message:{thread_ts:root}});});
  assert.deepEqual(await s.send('C123456','Reply','key',root),{channel:'C123456',ts:'1234567.999999',state:'accepted',threadTs:root});
  await assert.rejects(s.send('C123456','Reply','key','../bad'),/Invalid Slack thread/);assert.equal(calls,1);
  for(const threadTs of [undefined,'1234567.222222']) {
    let wrongCalls=0;
    const wrong=new Slack('synthetic',async()=>{wrongCalls++;return Response.json({ok:true,channel:'C123456',ts:'1234567.999999',message:{thread_ts:threadTs}});});
    await assert.rejects(wrong.send('C123456','Reply','key',root),e=>e.uncertain===true);assert.equal(wrongCalls,1);
  }
});
test('settings CLI and service read the canonical thread scope without changing channel settings',async t=>{
  const d=await dir(t), paths=[];
  const core=http.createServer((req,res)=>{paths.push(req.url);res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/v1/registration'?{bindingId:'synthetic'}:{activeSessionId:new URL(req.url,'http://core').searchParams.get('scope')}));});
  await new Promise(resolve=>core.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>core.close(resolve)));
  await saveConnection(d,{url:`http://127.0.0.1:${core.address().port}`,token:'a'.repeat(43),privateHttp:true});
  await saveSlack(d,config,{call:async m=>m==='auth.test'?{team_id:config.teamId,user_id:'U123456',bot_id:'B123456'}:{url:'wss://synthetic'}});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,args)=>String(url)==='https://slack.com/api/auth.test'?Response.json({ok:true,team_id:config.teamId,user_id:'U123456',bot_id:'B123456'}):originalFetch(url,args);
  t.after(()=>{globalThis.fetch=originalFetch;});
  const socket=new EventEmitter();socket.start=async()=>socket.emit('connected');socket.disconnect=async()=>{};
  const service=await serve(d,{createSocket:()=>socket});t.after(()=>service.close());
  assert.equal((await rpc(d,'settings',{channel:'C123456'})).activeSessionId,'slack:T123456:C123456');
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[new URL('../bin/ez-slack.mjs',import.meta.url).pathname,'settings','--channel','C123456','--thread','1234567.111111'],{env:{...process.env,EZ_SLACK_STATE:d},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).data.activeSessionId,'slack:T123456:C123456:thread:1234567.111111');
  const calls=paths.length;await assert.rejects(rpc(d,'settings',{channel:'C123456',threadTs:'../invalid'}));assert.equal(paths.length,calls);
});
test('unconfigured service is inert, rejects a second service and restarts without stale locks',async t=>{
  const d=await dir(t);let created=0;const s=await serve(d,{createSocket:()=>{created++;throw Error('No provider before setup');}});
  assert.equal((await rpc(d,'health')).issue,'setup_required');assert.equal(created,0);await assert.rejects(serve(d),/already running/);
  await s.close();const restarted=await serve(d);assert.equal((await rpc(d,'health')).healthy,true);await restarted.close();
});
