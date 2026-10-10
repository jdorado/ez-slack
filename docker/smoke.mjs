// Run only on the exact committed PR candidate. No Slack account or real sends.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, chmod, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec=promisify(execFile);
const source=resolve(fileURLToPath(new URL('..',import.meta.url)));
const bin=process.env.EZ_SLACK_TEST_MANAGER;
if(!bin)throw Error('Set EZ_SLACK_TEST_MANAGER to a reviewed Ez beta.50+ manager entrypoint');
const root=await mkdtemp(join(tmpdir(),'ez-slack-manager-'));
const home=join(root,'tools'), mind=join(root,'mind');
const call=async(...args)=>JSON.parse((await exec(process.execPath,[bin,'--home',home,...args],{maxBuffer:4*1024*1024})).stdout);
let record, setup;
try {
  await mkdir(mind);await writeFile(join(mind,'AGENTS.md'),'Synthetic owner context.\n');
  JSON.parse((await exec(process.execPath,[bin,'init','--home',home,'--workspace',mind])).stdout);
  // Host-private snapshots retain owner-only permissions in Docker build input.
  const privateSource=join(root,'source');
  await cp(source,privateSource,{recursive:true,filter:file=>!file.split('/').some(part=>part==='node_modules'||part==='.git')});
  const privateModes=async directory=>{
    await chmod(directory,0o700);
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const file=join(directory,entry.name);
      if(entry.isDirectory())await privateModes(file);
      else if(entry.isFile())await chmod(file,0o600|((await stat(file)).mode&0o100));
    }
  };
  await privateModes(privateSource);
  const inspected=await call('plugins','inspect','slack','--source',privateSource);
  const installed=await call('plugins','install','slack','--source',privateSource,'--revision',inspected.revision);
  assert.equal(installed.started,false);
  record=JSON.parse(await readFile(join(home,'registry.json'))).plugins.slack;
  await call('plugins','start','slack');
  assert.equal((await call('slack','health')).data.issue,'setup_required');
  assert.match((await call('slack','--help')).notes,/Channel controls/);
  await call('plugins','stop','slack');await call('plugins','start','slack');
  assert.equal((await call('slack','health')).data.healthy,true);
  // Crash recovery removes the stale Unix socket, without resubmitting a turn.
  await exec('docker',['kill',`${record.project}-slack-1`]);await call('plugins','start','slack');
  assert.equal((await call('slack','health')).data.healthy,true);
  await call('plugins','uninstall','slack');
  const volumes=(await exec('docker',['volume','ls','--filter',`label=com.docker.compose.project=${record.project}`,'--format','{{.Name}}'])).stdout.trim();assert(volumes);
  assert((await readFile(join(mind,'AGENTS.md'),'utf8')).startsWith('Synthetic owner context.\n'));
  console.log(JSON.stringify({passed:true,proof:['manager install from inspected hash','registered CLI in container from owner-only source files','inert before credentials','stop/start','crash restart','data-preserving uninstall','outside-footer preservation'],liveSlack:false}));
} finally {
  setup?.kill('SIGTERM');
  if(record){await exec('docker',['compose','-p',record.project,'-f',record.compose,'down','--volumes']).catch(()=>{});await exec('docker',['image','rm',`${record.project}-slack:${record.revision.slice(7,23)}`]).catch(()=>{});}
  await rm(root,{recursive:true,force:true});
}
