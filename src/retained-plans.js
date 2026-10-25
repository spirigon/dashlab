import {parseLevel, checkRequirements} from '../public/engine.js';
import {sectionPlan} from './sectioned-generator.js';
import {planSectionSchema, geometricCounts} from './section-plan-generator.js';
import {librarySection} from './sectioned-study.js';
import {EXTRAS} from './section-plan-generator.js';
import {globalMessages, globalSchema, evaluateGlobal, COUNTERS, compactFeedback, actionHints} from './feedback-sweep.js';
import {decideEdit} from './incremental-repair.js';

export const RETAINED_VERSION = 'retained-whole-or-local-plans-v1';
export const RETAINED_ARMS = ['whole_none','whole_feedback','local_none','local_feedback','whole_random','local_random'];
export const RETAINED_MODELS = ['qwen3.5:4b','qwen3.5:9b-q4_K_M'];
export const RETAINED_REPAIRS = 3;
export function retainedCases(tasks) {
  return tasks.flatMap((task, ti) => [0,1].map(replica => ({...task, task:task.id,
    id:`${task.id}-r${replica}`,replica,seed:501000+1000*(ti*2+replica)})));
}
function contributions(plan) {
  if (!plan?.pairs) return null;
  return geometricCounts(JSON.parse(librarySection(plan.pairs,plan.extra==='none'?null:EXTRAS[plan.extra])).objects);
}
export function selectRepairSection(state, r, attempt) {
  const slots=sectionPlan(r), report=state.report;
  if (!state.plan || slots.some(s=>!state.plan['s'+(s.index+1)])) return {index:null,reason:'incomplete-plan'};
  if (!state.level) {
    // Inspect only the current plan's literal bounds. No alternative plan is tested.
    for (const slot of slots) {
      try {
        const part=state.plan['s'+(slot.index+1)];
        const objects=JSON.parse(librarySection(part.pairs,part.extra==='none'?null:EXTRAS[part.extra])).objects;
        if(objects.some(o=>o.x+o.w>slot.localRightEdge))return {index:slot.index,reason:'current-section-bounds'};
      } catch {return {index:slot.index,reason:'current-section-schema'};}
    }
    return {index:attempt%4,reason:'current-plan-invalid'};
  }
  if (!report.playable) {
    const x=report.solver.maxX??0,index=slots.find(s=>x<s.end)?.index??3;
    return {index,reason:'earliest-failed-path',x};
  }
  const missing=Object.entries(COUNTERS).filter(([key,stat])=>r[key]>report.stats[stat]);
  if (missing.length) {
    const scores=slots.map(slot=>{
      const plan=state.plan['s'+(slot.index+1)], c=contributions(plan), schema=planSectionSchema(slot,r), pairs=schema.properties.pairs.minItems;
      const extra=Number(schema.properties.extra.enum[0]!=='none');
      const maximum={spikes:6*pairs+3*extra,blocks:2*pairs+extra,doubleSpikes:2*pairs+extra,tripleSpikes:2*pairs+extra,tallBlocks:pairs+extra,tightGaps:pairs};
      const score=missing.reduce((sum,[key,stat])=>sum+(r[key]-report.stats[stat])/Math.max(1,r[key])*(1-c[stat]/Math.max(1,maximum[stat])),0);
      return {index:slot.index,score};
    });
    const best=Math.max(...scores.map(s=>s.score)), tied=scores.filter(s=>Math.abs(s.score-best)<1e-12);
    return {index:tied[attempt%tied.length].index,reason:'static-deficit-headroom'};
  }
  return {index:attempt%4,reason:'minimum-jumps-rotation'};
}
const LIBRARY=`Fixed geometry; 5 empty tiles after each pair, then optional extra. Only names/types/order are chosen. Each section's origin, bounds, pair count and extra enum are fixed.
triple_pair: spikes=6, blocks=0, doubleSpikes=2, tripleSpikes=2, tallBlocks=0, tightGaps=1, width8.
stairs: spikes=0, blocks=2, doubleSpikes=0, tripleSpikes=0, tallBlocks=1, tightGaps=1, width6.
tower_triple: spikes=3, blocks=1, doubleSpikes=1, tripleSpikes=1, tallBlocks=1, tightGaps=1, width6.
Extras single_spike:1 spike; double_spike:2 spikes,1 double; triple_spike:3 spikes,1 double,1 triple; block:1 block; tall_block:1 block,1 tall. none adds nothing. Names are literal enum values. No coordinates, portals or new types. Normal cube, built-in ground, fixed speed and gravity. Only full-level proxy search proves playability and actual minimum jumps, which is minimized over all successful paths. Pair counts alone do not prove jumps.`;
export function retainedMessages(item,state,arm,attempt,history=[]) {
  const [scope,condition]=arm.split('_');
  if(!['whole','local'].includes(scope)||!['none','feedback'].includes(condition))throw new Error('Unknown LLM repair arm');
  const r=checkRequirements(item.requirements), slots=sectionPlan(r), target=scope==='local'?selectRepairSection(state,r,attempt):null;
  if(scope==='local'&&target.index===null)throw new Error('Cannot patch an incomplete initial plan');
  const schema=scope==='local'?planSectionSchema(slots[target.index],r):globalSchema(r);
  const messages=[{role:'system',content:`Repair an existing Geometry Dash library plan. ${LIBRARY}
${scope==='local'?`Return ONLY one section plan {pairs:[...],extra:...} for s${target.index+1}; the compiler replaces exactly that section. Every other section stays byte-for-byte unchanged.`:'Return ONLY a complete {s1,s2,s3,s4} replacement plan. You may revise any section.'}
A shared controller accepts only literal proposals preserving already-confirmed checks, rejects an earlier failed-path position, and rejects a larger numeric deficit when reachability status is unchanged. A neutral preparation may be retained, but is not counted as an improvement. Rejected candidates do not replace the current retained plan. Never change the original requirements. Stop after a full success. Do not repeat rejected choices. No repaired plan is supplied.
Output schema: ${JSON.stringify(schema)}`},
    {role:'user',content:`Brief: ${item.prompt}\nOriginal requirements: ${JSON.stringify(r)}\nCurrent retained WHOLE plan: ${JSON.stringify(state.plan)}\nFixed slots: ${JSON.stringify(slots.map(s=>({section:'s'+(s.index+1),origin:s.origin,localRightEdge:s.localRightEdge,pairs:planSectionSchema(s,r).properties.pairs.minItems,extraChoices:planSectionSchema(s,r).properties.extra.enum})))}\n${scope==='local'?`Shared controller selected s${target.index+1}. This target is common controller information, not the diagnostic treatment.`:'All sections are editable.'}\nPrevious proposals and binary acceptance: ${JSON.stringify(history.map(h=>({raw:h.raw,target:h.target?.index??null,accepted:h.decision.accepted})))}`}];
  let diagnostic=null;
  if(condition==='feedback') {
    const measured=compactFeedback(state,r,slots);
    diagnostic={current:measured,editOptions:actionHints(measured),
      lastRejected:history.at(-1)&&!history.at(-1).decision.accepted?{reason:history.at(-1).decision.reason,measured:compactFeedback(history.at(-1).candidate,r,slots)}:null};
  }
  messages.push({role:'user',content:diagnostic?`Measured feedback and static, UNTESTED edit options: ${JSON.stringify(diagnostic)}`:'No diagnostic report is supplied. Return your own revised choices using the current plan, requirements, library and shared controller rules.'});
  return {messages,schema,target,diagnostic};
}
export function applyPlanProposal(state,raw,item,scope,target) {
  let candidate;
  try {
    const proposal=parseLevel(raw), plan=scope==='local'?{...structuredClone(state.plan),['s'+(target.index+1)]:proposal}:proposal;
    const completeRaw=JSON.stringify(plan);candidate={raw:completeRaw,...evaluateGlobal(completeRaw,item.requirements)};
  } catch(e) {candidate={raw,...evaluateGlobal('null',item.requirements),outputError:e.message};}
  const decision=decideEdit(state,candidate,item.requirements);
  return {candidate,decision,effective:decision.accepted?candidate:state};
}
function randomPlan(item,attempt) {
  let seed=(item.seed+17000000+attempt*997)>>>0;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const schema=globalSchema(item.requirements),plan={};
  for(const key of schema.required) {
    const p=schema.properties[key].properties, choose=values=>values[Math.floor(rand()*values.length)];
    plan[key]={pairs:Array.from({length:p.pairs.minItems},()=>choose(p.pairs.items.enum)),extra:choose(p.extra.enum)};
  }
  return plan;
}
export async function runRetainedChain(item,arm,chat) {
  if(!RETAINED_ARMS.includes(arm))throw new Error('Unknown retained-plan arm');
  const [scope,condition]=arm.split('_'),history=[];let initial=null,state=null,error=null;
  try {
    const {messages,schema}=globalMessages(item,'none',[]),response=await chat(messages,{seed:item.seed,schema,temperature:.65},{kind:'initial',attempt:0});
    initial={...response,...evaluateGlobal(response.raw,item.requirements)};state=initial;
    for(let attempt=0;attempt<RETAINED_REPAIRS&&!state.report.passed;attempt++) {
      const target=scope==='local'?selectRepairSection(state,item.requirements,attempt):null;
      if(scope==='local'&&target.index===null)break;
      let generated,diagnostic=null;
      if(condition==='random') {
        const plan=randomPlan(item,attempt),raw=JSON.stringify(scope==='local'?plan['s'+(target.index+1)]:plan);
        generated={raw,source:'uniform-same-plan-space-repair-NOT-LLM',tokensIn:0,tokensOut:0,elapsedMs:0};
      } else {
        const request=retainedMessages(item,state,arm,attempt,history);diagnostic=request.diagnostic;
        generated=await chat(request.messages,{seed:item.seed+500+attempt,schema:request.schema,temperature:.65},{kind:'repair',attempt});
      }
      const evaluated=applyPlanProposal(state,generated.raw,item,scope,target);
      history.push({...generated,...evaluated,target,diagnostic,attempt});state=evaluated.effective;
    }
  } catch(e) {error=e.message;}
  return {method:RETAINED_VERSION,arm,initial,state,history,error,passed:!error&&Boolean(state?.report.passed),
    initialPassed:Boolean(initial?.report.passed),repairs:history.length,scope,condition};
}
