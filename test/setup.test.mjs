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
test('unconfigured service is inert, rejects a second service and restarts without stale locks',async t=>{
  const d=await dir(t);let created=0;const s=await serve(d,{createSocket:()=>{created++;throw Error('No provider before setup');}});
  assert.equal((await rpc(d,'health')).issue,'setup_required');assert.equal(created,0);await assert.rejects(serve(d),/already running/);
  await s.close();const restarted=await serve(d);assert.equal((await rpc(d,'health')).healthy,true);await restarted.close();
});
