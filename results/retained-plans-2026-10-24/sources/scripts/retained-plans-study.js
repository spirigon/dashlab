import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ollamaChat} from '../src/llm.js';
import {PHYSICS} from '../public/engine.js';
import {RETAINED_VERSION,RETAINED_ARMS,RETAINED_MODELS,retainedCases,runRetainedChain} from '../src/retained-plans.js';
import {retainedWitness,summarizeRetained} from '../src/retained-study.js';
const root=fileURLToPath(new URL('../',import.meta.url)),args={},argv=process.argv.slice(2);
for(let i=0;i<argv.length;i+=2){if(!['--out','--resume','--prepare'].includes(argv[i])||argv[i+1]===undefined)throw new Error('Use --out NEW --prepare true, or --resume FOLDER');args[argv[i].slice(2)]=argv[i+1];}
if(args.out&&args.resume)throw new Error('out/resume exclusive');
if(Number(process.env.LLM_CONTEXT_LENGTH||8192)!==8192)throw new Error('Fixed context8192 required');
const hash=x=>createHash('sha256').update(x).digest('hex'),out=resolve(args.resume||args.out||join(root,'results/retained-plans-2026-10-24'));
const exists=async p=>{try{await readFile(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const load=async n=>JSON.parse(await readFile(join(out,n),'utf8'));
const lines=async n=>await exists(join(out,n))?(await readFile(join(out,n),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse):[];
const tags=async()=>{const r=await fetch((process.env.OLLAMA_URL||'http://127.0.0.1:11434')+'/api/tags');if(!r.ok)throw new Error('Ollama tags unavailable');return(await r.json()).models;};
const sources=['public/engine.js','src/llm.js','src/local-feedback.js','src/repair-study.js','src/motif-generator.js','src/sectioned-generator.js','src/sectioned-study.js','src/section-plan-generator.js','src/section-plan-study.js','src/section-plan-final.js','src/section-final-study.js','src/feedback-sweep.js','src/safe-feedback.js','src/incremental-repair.js','src/retained-plans.js','src/retained-study.js','scripts/retained-plans-study.js','scripts/analyze-retained-plans.js','test/retained-plans.test.js','examples/briefs-retained.json','docs/RETAINED-PLANS-PROTOCOL.md'];
let metadata,cases,jobs,bindings;
if(!args.resume){
  await mkdir(out,{recursive:false});
  const tasks=JSON.parse(await readFile(join(root,'examples/briefs-retained.json'),'utf8')),witnesses=tasks.map(retainedWitness);cases=retainedCases(tasks);
  if(cases.length!==24)throw new Error('Expected24cases');
  jobs=RETAINED_MODELS.flatMap(model=>cases.flatMap((item,ci)=>RETAINED_ARMS.map((_,k)=>{const arm=RETAINED_ARMS[(k+ci)%RETAINED_ARMS.length];return{key:`${model}__${item.id}__${arm}`,model,caseId:item.id,arm,position:k};})));
  const sourceHashes={};for(const f of sources){const bytes=await readFile(join(root,f));sourceHashes[f]=hash(bytes);const target=join(out,'sources',f);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  metadata={studyVersion:RETAINED_VERSION,createdAt:new Date().toISOString(),sourceHashes,physics:PHYSICS,models:RETAINED_MODELS,
    caseBankHash:hash(JSON.stringify(cases)),witnessHash:hash(JSON.stringify(witnesses)),jobHash:hash(JSON.stringify(jobs)),
    cases:24,briefs:12,families:6,replicas:2,plannedRows:288,concurrency:2,maxModelProposals:624,
    settings:{temperature:.65,numCtx:8192,numPredict:4096,thinking:false,timeoutMs:Number(process.env.LLM_TIMEOUT_MS||360000)},
    primary:'4B local_feedback vs local_none; conditional twelve-brief sign test, six-family sensitivity. All remaining comparisons secondary.',
    modelBindingPolicy:'4B digest bound at preparation; 9B may still be downloading. Each model digest is bound in model-bindings.json BEFORE its first inference and never changes. Missing model leaves its assignments pending, never successful or silently excluded.',
    design:'Twelve new numeric configurations in six existing families. Shared initial Qwen full plan across six arms/model/case, up to3repairs. Common retained-state guard. Whole/local x none/actionable/random. Random arms use Qwen initial, uniform repair. Fixed protocol before inference, no outcome-driven tuning.'};
  const available=await tags();bindings={};for(const model of RETAINED_MODELS){const t=available.find(t=>t.name===model);if(t)bindings[model]={digest:t.digest,size:t.size,details:t.details,boundAt:new Date().toISOString()};}
  if(!bindings[RETAINED_MODELS[0]])throw new Error('4B not installed');
  for(const[name,value]of Object.entries({'metadata.json':metadata,'cases.json':cases,'jobs.json':jobs,'hidden-feasibility.json':witnesses,'model-bindings.json':bindings}))await writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
}else{
  metadata=await load('metadata.json');cases=await load('cases.json');jobs=await load('jobs.json');bindings=await load('model-bindings.json');
  for(const[n,expected]of [['cases.json',metadata.caseBankHash],['jobs.json',metadata.jobHash],['hidden-feasibility.json',metadata.witnessHash]])if(hash(JSON.stringify(await load(n)))!==expected)throw new Error('Frozen bank changed:'+n);
  for(const[f,expected]of Object.entries(metadata.sourceHashes))if(hash(await readFile(join(root,f)))!==expected)throw new Error('Frozen source changed:'+f);
  if(Number(process.env.LLM_TIMEOUT_MS||360000)!==metadata.settings.timeoutMs)throw new Error('Timeout changed');
  if(await exists(join(out,'progress.json'))){const p=await load('progress.json');if(p.active){try{process.kill(p.pid,0);throw new Error('Study running:'+p.pid);}catch(e){if(e.code!=='ESRCH')throw e;}}}
}
if(args.prepare==='true'){console.log(JSON.stringify({prepared:out,cases:24,jobs:288,boundModels:Object.keys(bindings)}));process.exit(0);}
const rows=await lines('runs.jsonl'),journal=await lines('calls.jsonl'),byHash=new Map(journal.filter(e=>e.event==='response').map(e=>[e.requestHash,e])),errorsByHash=new Map(journal.filter(e=>e.event==='error').map(e=>[e.requestHash,e]));
const pending=new Map(),contexts=new Map();let callId=Math.max(0,...journal.map(e=>e.callId||0)),writeQueue=Promise.resolve(),saveQueue=Promise.resolve();
const log=async e=>{journal.push(e);writeQueue=writeQueue.then(()=>appendFile(join(out,'calls.jsonl'),JSON.stringify(e)+'\n'));await writeQueue;};
const save=async(active,status)=>{saveQueue=saveQueue.then(async()=>{await writeFile(join(out,'summary.json'),JSON.stringify({...summarizeRetained(rows,cases),actualRequests:callId},null,2)+'\n');await writeFile(join(out,'progress.json'),JSON.stringify({active,status,pid:process.pid,completed:rows.length,planned:288,actualRequests:callId,contexts:[...contexts.values()],updatedAt:new Date().toISOString()},null,2)+'\n');});await saveQueue;};
async function chat(model,context,messages,options){
  contexts.set(context.jobKey,context);await save(true,'running');const requestHash=hash(JSON.stringify({messages,options,model}));
  const reuse=async source=>{const reused=source.context.key!==context.key;if(reused&&!journal.some(e=>e.event==='cache-use'&&e.context.key===context.key))await log({event:'cache-use',context,requestHash,sourceCallId:source.callId});return{...source.result,journalCallId:source.callId,cacheReused:reused};};
  if(byHash.has(requestHash))return reuse(byHash.get(requestHash));if(errorsByHash.has(requestHash))throw new Error(errorsByHash.get(requestHash).message);if(pending.has(requestHash))return reuse(await pending.get(requestHash));
  const operation=(async()=>{
    const prior=journal.filter(e=>e.event==='request'&&e.requestHash===requestHash&&!journal.some(end=>['response','error'].includes(end.event)&&end.callId===e.callId));
    if(prior.length)await log({event:'resume-incomplete-request',context,requestHash,previousCallIds:prior.map(e=>e.callId)});
    const id=++callId;await log({event:'request',model,context,callId:id,requestHash,messages,options,at:new Date().toISOString()});
    try{const result=await ollamaChat(messages,options);if(result.model!==model)throw new Error('Unexpected model');const response={event:'response',model,context,callId:id,requestHash,result,at:new Date().toISOString()};await log(response);byHash.set(requestHash,response);return response;}
    catch(error){const e={event:'error',model,context,callId:id,requestHash,message:error.message,at:new Date().toISOString()};await log(e);errorsByHash.set(requestHash,e);throw error;}
  })();pending.set(requestHash,operation);try{return await reuse(await operation);}finally{pending.delete(requestHash);}
}
await save(true,'running');let missing=false;
try{
  for(const model of RETAINED_MODELS){
    const available=await tags(),current=available.find(t=>t.name===model);
    if(!current){missing=true;console.log(JSON.stringify({waitingForModel:model}));continue;}
    if(bindings[model]&&bindings[model].digest!==current.digest)throw new Error('Model digest changed:'+model);
    if(!bindings[model]){bindings[model]={digest:current.digest,size:current.size,details:current.details,boundAt:new Date().toISOString()};await writeFile(join(out,'model-bindings.json'),JSON.stringify(bindings,null,2)+'\n');await log({event:'model-bound',model,...bindings[model]});}
    process.env.OLLAMA_MODEL=model;const batch=jobs.filter(j=>j.model===model);let index=0;
    async function worker(){while(index<batch.length){const job=batch[index++];if(rows.some(r=>r.key===job.key))continue;const item=cases.find(c=>c.id===job.caseId);
      const result=await runRetainedChain(item,job.arm,(messages,options,local)=>chat(model,{...local,...job,jobKey:job.key,key:`${job.key}__${local.kind}__${local.attempt}`},messages,options));
      const row={...job,task:item.task,family:item.family,difficulty:item.difficulty,result};rows.push(row);contexts.delete(job.key);writeQueue=writeQueue.then(()=>appendFile(join(out,'runs.jsonl'),JSON.stringify(row)+'\n'));await writeQueue;await save(true,'running');
      console.log(JSON.stringify({completed:rows.length,planned:288,model,case:item.id,arm:job.arm,initialPassed:result.initialPassed,passed:result.passed,repairs:result.repairs,error:result.error,actualRequests:callId}));
    }}
    await Promise.all([worker(),worker()]);
    await fetch((process.env.OLLAMA_URL||'http://127.0.0.1:11434')+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,keep_alive:0}),signal:AbortSignal.timeout(30000)});
  }
}finally{await save(false,rows.length===288?'completed':missing?'waiting-for-model':'incomplete');}
console.log(JSON.stringify({finished:out,completed:rows.length,planned:288,missingModels:missing}));
