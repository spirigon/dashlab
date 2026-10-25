import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {evaluateRaw,checkRequirements,PHYSICS} from '../public/engine.js';
import {generatorMessages,validatorFeedback,ollamaChat} from './llm.js';
import {localizedFeedback,FEEDBACK_VERSION} from './local-feedback.js';
export const STUDY_VERSION='one-shot-repair-study-v1';
export const CONDITIONS=['none','validator','localized'];
export const hash=text=>createHash('sha256').update(text).digest('hex');

export function makeCases(rows,tasks){
 const groups=new Map();
 for(const row of rows){
  const key=`${row.task}-${row.seed}`,previous=groups.get(key);
  if(!row.attempts?.[0])throw new Error('Missing shared initial candidate: '+key);
  if(previous&&previous.attempts[0].raw!==row.attempts[0].raw)throw new Error('Initial candidate differs across conditions: '+key);
  if(!previous)groups.set(key,row);
 }
 const sorted=[...groups.values()].sort((a,b)=>tasks.findIndex(t=>t.id===a.task)-tasks.findIndex(t=>t.id===b.task)||a.seed-b.seed),cases=[];
 for(const row of sorted){
  const task=tasks.find(t=>t.id===row.task);if(!task)throw new Error('Unknown task: '+row.task);
  const initial=row.attempts[0],evaluation=evaluateRaw(initial.raw,task.requirements);
  if(!isDeepStrictEqual(initial.report,evaluation.report))throw new Error('Initial report not reproduced: '+row.task+'-'+row.seed);
  if(evaluation.report.passed)continue;
  cases.push({id:`${row.task}-${row.seed}`,task:row.task,difficulty:row.difficulty,originalSeed:row.seed,
   repairSeed:4000+cases.length,prompt:task.prompt,requirements:checkRequirements(task.requirements),raw:initial.raw,rawHash:hash(initial.raw),initialReport:evaluation.report});
 }
 return cases;
}
export function repairMessages(item,condition){
 if(!CONDITIONS.includes(condition))throw new Error('Unknown repair condition');
 const r=checkRequirements(item.requirements),evaluated=evaluateRaw(item.raw,r);
 let feedback='',diagnostic=null;
 if(condition==='validator')feedback=`Exact proxy validator output:\n${validatorFeedback(evaluated.report)}\n`;
 if(condition==='localized'){diagnostic=localizedFeedback(item.raw,r);feedback=`Grounded local repair diagnostic (execution evidence in the approximate proxy):\n${JSON.stringify(diagnostic)}\n`;}
 return{messages:generatorMessages(item.prompt,r,item.raw,feedback),diagnostic};
}
export async function repairOnce(item,condition,chat=ollamaChat){
 const {messages,diagnostic}=repairMessages(item,condition);
 const {LEVEL_SCHEMA}=await import('../public/engine.js');
 const generated=await chat(messages,{seed:item.repairSeed,schema:LEVEL_SCHEMA,temperature:.65});
 const evaluated=evaluateRaw(generated.raw,item.requirements),before=item.initialReport.rules.filter(r=>r.passed===true);
 const state=new Map(evaluated.report.rules.map(r=>[r.code,r.passed]));
 return{...generated,...evaluated,condition,studyVersion:STUDY_VERSION,feedbackVersion:condition==='localized'?FEEDBACK_VERSION:'unchanged-v3',diagnostic,
  rulePreservation:{previouslyPassed:before.length,retained:before.filter(r=>state.get(r.code)===true).length,
   confirmedRegressions:before.filter(r=>state.get(r.code)===false).map(r=>r.code),
   notVerified:before.filter(r=>!state.has(r.code)||state.get(r.code)===null).map(r=>r.code)}};
}
export function exactPaired(aOnly,bOnly){
 const n=aOnly+bOnly;if(!n)return 1;
 let term=1,sum=1;for(let i=1;i<=Math.min(aOnly,bOnly);i++){term*=((n-i+1)/i);sum+=term;}
 return Math.min(1,2*sum/2**n);
}
export function summarizeRepair(rows,cases){
 const n=cases.length,summary=CONDITIONS.map(condition=>{
  const group=rows.filter(row=>row.condition===condition),good=group.filter(row=>!row.error&&row.result?.report.passed);
  return{condition,nPlanned:n,nCompleted:group.length,successes:good.length,successRate:group.length===n?good.length/n:null,
   schemaValid:group.filter(row=>row.result?.report.schemaValid).length,proxyPlayable:group.filter(row=>row.result?.report.playable).length,
   infrastructureErrors:group.filter(row=>row.error).length,tokensIn:group.reduce((s,r)=>s+(r.result?.tokensIn||0),0),tokensOut:group.reduce((s,r)=>s+(r.result?.tokensOut||0),0),
   responseTimeMs:group.reduce((s,r)=>s+(r.result?.elapsedMs||0),0),
   explicitRuleRegressions:group.reduce((s,r)=>s+(r.result?.rulePreservation.confirmedRegressions.length||0),0),
   previousRulesNotVerified:group.reduce((s,r)=>s+(r.result?.rulePreservation.notVerified.length||0),0)};
 });
 const paired=[];
 for(const [a,b,primary]of [['localized','validator',true],['localized','none',false],['validator','none',false]]){
  let aOnly=0,bOnly=0,both=0,neither=0,matched=0;
  for(const item of cases){const ar=rows.find(r=>r.caseId===item.id&&r.condition===a),br=rows.find(r=>r.caseId===item.id&&r.condition===b);if(!ar||!br)continue;
   matched++;const ap=!ar.error&&ar.result?.report.passed===true,bp=!br.error&&br.result?.report.passed===true;
   if(ap&&bp)both++;else if(ap)aOnly++;else if(bp)bOnly++;else neither++;
  }
  paired.push({a,b,primary,nMatched:matched,both,aOnly,bOnly,neither,exactTwoSidedP:matched===n?exactPaired(aOnly,bOnly):null});
 }
 return{studyVersion:STUDY_VERSION,physics:PHYSICS.id,caseCount:n,completed:rows.length,planned:n*CONDITIONS.length,summary,paired,
  endpoint:'Full proxy success after exactly ONE new model call on a fixed initially failing candidate; conditional repair rate, not an end-to-end generation rate.',
  limitations:'Retrospective cases from the previous six-task benchmark, not held-out task prompts. Same call/output cap, differing input token budgets. Game transfer and statistical generalization not established.'};
}
