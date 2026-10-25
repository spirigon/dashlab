import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=resolve(process.argv[2]||'results/retained-plans-2026-10-24'),partial=process.argv.includes('--partial');
const load=async n=>JSON.parse(await readFile(join(out,n),'utf8'));
const lines=async n=>(await readFile(join(out,n),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const hash=x=>createHash('sha256').update(x).digest('hex');
const metadata=await load('metadata.json'),progress=await load('progress.json'),cases=await load('cases.json'),jobs=await load('jobs.json'),bindings=await load('model-bindings.json');
assert.equal(progress.active,false);if(!partial)assert.equal(progress.completed,288);
for(const[f,expected]of Object.entries(metadata.sourceHashes))assert.equal(hash(await readFile(join(out,'sources',f))),expected,f);
for(const[n,expected]of [['cases.json',metadata.caseBankHash],['jobs.json',metadata.jobHash],['hidden-feasibility.json',metadata.witnessHash]])assert.equal(hash(JSON.stringify(await load(n))),expected,n);
const frozen=f=>import(pathToFileURL(join(out,'sources',f)).href);
const {runRetainedChain,retainedCases,RETAINED_MODELS,RETAINED_ARMS}=await frozen('src/retained-plans.js');
const {retainedWitness,summarizeRetained}=await frozen('src/retained-study.js');
const {passedChecks}=await frozen('src/safe-feedback.js');
const tasks=JSON.parse(await readFile(join(out,'sources/examples/briefs-retained.json'),'utf8'));assert.deepEqual(retainedCases(tasks),cases);assert.deepEqual(tasks.map(retainedWitness),await load('hidden-feasibility.json'));
const rows=await lines('runs.jsonl'),journal=await lines('calls.jsonl');assert.equal(rows.length,progress.completed);assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);
const requests=journal.filter(e=>e.event==='request'),responses=journal.filter(e=>e.event==='response'),errors=journal.filter(e=>e.event==='error');
assert.equal(new Set(responses.map(e=>e.requestHash)).size,responses.length);
const byHash=new Map(responses.map(e=>[e.requestHash,e])),errorByHash=new Map(errors.map(e=>[e.requestHash,e])),used=new Set(),usedErrors=new Set();
let logicalCalls=0,randomProposals=0,localReplacements=0;
for(const request of requests){assert.equal(request.requestHash,hash(JSON.stringify({messages:request.messages,options:request.options,model:request.model})));assert.ok(bindings[request.model]);assert.ok(request.at>=bindings[request.model].boundAt);}
for(const row of rows){
  const job=jobs.find(j=>j.key===row.key);assert.ok(job);for(const k of Object.keys(job))assert.equal(row[k],job[k]);
  const item=cases.find(c=>c.id===row.caseId),result=await runRetainedChain(item,row.arm,async(messages,options,local)=>{
    logicalCalls++;const requestHash=hash(JSON.stringify({messages,options,model:row.model}));
    if(errorByHash.has(requestHash)){usedErrors.add(requestHash);throw new Error(errorByHash.get(requestHash).message);}
    const response=byHash.get(requestHash);assert.ok(response,'Missing response:'+row.key);used.add(response.callId);
    const request=requests.find(r=>r.callId===response.callId);assert.deepEqual(request.messages,messages);assert.deepEqual(request.options,options);
    assert.equal(request.context.caseId,item.id);assert.equal(request.context.kind,local.kind);assert.equal(request.context.attempt,local.attempt);
    const body=response.result.request;assert.equal(body.model,row.model);assert.equal(body.think,false);assert.deepEqual(body.messages,messages);assert.deepEqual(body.format,options.schema);
    assert.deepEqual(body.options,{seed:options.seed,temperature:.65,num_predict:4096,num_ctx:8192});
    return{...response.result,journalCallId:response.callId,cacheReused:response.context.key!==`${row.key}__${local.kind}__${local.attempt}`};
  });
  assert.deepEqual(result,row.result,'Chain replay differs:'+row.key);assert.ok(result.repairs<=3);
  if(result.initialPassed)assert.equal(result.repairs,0);
  let state=result.initial;
  for(const h of result.history){
    if(h.decision.accepted){for(const check of passedChecks(state.report))assert.ok(passedChecks(h.candidate.report).has(check));assert.deepEqual(h.effective,h.candidate);}else assert.deepEqual(h.effective,state);
    if(result.scope==='local'&&h.candidate.plan){for(let s=0;s<4;s++)if(s!==h.target.index)assert.deepEqual(h.candidate.plan['s'+(s+1)],state.plan['s'+(s+1)]);localReplacements++;}
    state=h.effective;if(result.condition==='random')randomProposals++;
  }
  assert.deepEqual(state,result.state);assert.equal(result.passed,!result.error&&Boolean(state?.report.passed));
}
assert.equal(used.size,responses.length);assert.equal(usedErrors.size,errorByHash.size);
let sharedInitialGroups=0;
for(const model of RETAINED_MODELS)for(const item of cases){const group=rows.filter(r=>r.model===model&&r.caseId===item.id);if(group.length!==RETAINED_ARMS.length)continue;const first=group.map(r=>r.result.initial);if(first.every(Boolean)){first.forEach(r=>{assert.equal(r.raw,first[0].raw);assert.equal(r.journalCallId,first[0].journalCallId);});sharedInitialGroups++;}}
const ended=new Set([...responses,...errors].map(e=>e.callId)),analysis=summarizeRetained(rows,cases);
analysis.audit={verifiedRows:rows.length,plannedRows:288,partial:rows.length!==288,frozenFiles:Object.keys(metadata.sourceHashes).length,
  actualRequests:requests.length,completedResponses:responses.length,apiErrors:errors.length,logicalModelProposals:logicalCalls,randomRepairProposals:randomProposals,
  sharedInitialGroups,literalLocalReplacementsVerified:localReplacements,explicitCacheUses:journal.filter(e=>e.event==='cache-use').length,
  interruptedRequestIds:requests.filter(e=>!ended.has(e.callId)).map(e=>e.callId),outputCapHits:responses.filter(e=>e.result.doneReason==='length'||e.result.tokensOut>=4096).length,
  actualTokensIn:responses.reduce((s,e)=>s+(e.result.tokensIn||0),0),actualTokensOut:responses.reduce((s,e)=>s+(e.result.tokensOut||0),0),
  modelBindings:bindings,allAvailableChainsReplayed:true,noCallsAfterSuccess:true,guardAndRejectionsReproduced:true,
  hiddenWitnessesNotInputs:'Messages reconstructed from actual Qwen initial plan, requirements, current measurements, common controller target and previous literal proposals only.'};
const suffix=partial?'-partial':'';await writeFile(join(out,'analysis'+suffix+'.json'),JSON.stringify(analysis,null,2)+'\n');
const fields=Object.keys(analysis.summary[0]);await writeFile(join(out,'metrics'+suffix+'.csv'),fields.join(',')+'\n'+analysis.summary.map(s=>fields.map(k=>s[k]).join(',')).join('\n')+'\n');
console.log(JSON.stringify(analysis,null,2));
