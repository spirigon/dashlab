import {readFile} from 'node:fs/promises';
import {sectionPlan} from './sectioned-generator.js';
import {planSectionSchema, geometricCounts} from './section-plan-generator.js';
import {librarySection} from './sectioned-study.js';
import {EXTRAS} from './section-plan-generator.js';
import {finalWitness} from './section-final-study.js';
import {evaluateGlobal, COUNTERS} from './feedback-sweep.js';
import {RETAINED_VERSION, RETAINED_ARMS, RETAINED_MODELS} from './retained-plans.js';
import {passedChecks} from './safe-feedback.js';
import {diversity} from '../public/engine.js';

function tuples(values,n){return n?tuples(values,n-1).flatMap(p=>values.map(v=>[...p,v])):[[]];}
export function retainedWitness(task) {
  try {
    const source=finalWitness(task),raw=JSON.stringify(Object.fromEntries(source.stages.map((s,i)=>['s'+(i+1),JSON.parse(s.raw)]))),result=evaluateGlobal(raw,task.requirements);
    if(result.accepted)return {task:task.id,raw,...result,hiddenFromModel:true,source:'greedy-feasibility-only-NOT-LLM'};
  } catch {}
  const slots=sectionPlan(task.requirements),r=task.requirements;
  const choices=slots.map(slot=>{
    const schema=planSectionSchema(slot,r),p=schema.properties;
    return tuples(p.pairs.items.enum,p.pairs.minItems).flatMap(pairs=>p.extra.enum.map(extra=>{
      const objects=JSON.parse(librarySection(pairs,extra==='none'?null:EXTRAS[extra])).objects;
      return {plan:{pairs,extra},objects};
    })).filter(o=>o.objects.every(x=>x.x+x.w<=slot.localRightEdge));
  });
  let leaves=0,checked=0,found=null;
  function walk(depth,plan,objects) {
    if(found)return;
    if(depth===4) {
      leaves++;const counts=geometricCounts(objects);
      if(Object.entries(COUNTERS).some(([key,stat])=>counts[stat]<r[key]))return;
      checked++;const raw=JSON.stringify(plan),result=evaluateGlobal(raw,r);
      if(result.accepted)found={task:task.id,raw,...result,hiddenFromModel:true,source:'exhaustive-static-count-filtered-feasibility-only-NOT-LLM'};
      return;
    }
    const slot=slots[depth];
    const ordered=choices[depth].map(choice=>{
      const next=[...objects,...choice.objects.map(o=>({...o,x:o.x+slot.origin}))],counts=geometricCounts(next);
      const cost=Object.entries(COUNTERS).reduce((s,[key,stat])=>s+Math.abs(counts[stat]-r[key]*(depth+1)/4)/Math.max(1,r[key]),0);
      return {choice,next,cost};
    }).sort((a,b)=>a.cost-b.cost);
    for(const {choice,next} of ordered) {
      const counts=geometricCounts(next), remaining=slots.slice(depth+1);
      const upper=Object.fromEntries(Object.values(COUNTERS).map(stat=>[stat,counts[stat]]));
      for(const rem of remaining) {
        const p=planSectionSchema(rem,r).properties,n=p.pairs.minItems,e=Number(p.extra.enum[0]!=='none');
        for(const [stat,max] of Object.entries({spikes:6*n+3*e,blocks:2*n+e,doubleSpikes:2*n+e,tripleSpikes:2*n+e,tallBlocks:n+e,tightGaps:n+1}))upper[stat]+=max;
      }
      if(Object.entries(COUNTERS).some(([key,stat])=>upper[stat]<r[key]))continue;
      walk(depth+1,{...plan,['s'+(depth+1)]:choice.plan},next);if(found)return;
    }
  }
  walk(0,{},[]);
  if(!found)throw new Error(`No global feasibility witness found for ${task.id}; leaves=${leaves}, tested=${checked}`);
  return {...found,leaves,checked};
}
function signP(values) {
  const observed=values.reduce((s,x)=>s+x,0);let n=0;
  for(let mask=0;mask<2**values.length;mask++) {
    const value=values.reduce((s,x,i)=>s+(mask&2**i?x:-x),0);
    if(Math.abs(value)>=Math.abs(observed))n++;
  }
  return n/2**values.length;
}
export function summarizeRetained(rows,cases) {
  const summary=RETAINED_MODELS.flatMap(model=>RETAINED_ARMS.map(arm=>{
    const group=rows.filter(row=>row.model===model&&row.arm===arm), successes=group.filter(r=>r.result.passed);
    const histories=group.flatMap(r=>r.result.history), generations=group.map(r=>r.result.initial).filter(Boolean);
    const all=[...generations,...histories], initialPassed=group.filter(r=>r.result.initialPassed).length;
    const regressions=group.filter(row=>row.result.initial&&row.result.state&&[...passedChecks(row.result.initial.report)].some(c=>!passedChecks(row.result.state.report).has(c))).length;
    return {model,arm,planned:cases.length,completed:group.length,initialPassed,successes:successes.length,
      initiallyFailed:group.length-initialPassed,recovered:successes.length-initialPassed,finalRegressions:regressions,
      repairProposals:histories.length,acceptedStrict:histories.filter(h=>h.decision.strict).length,acceptedNeutral:histories.filter(h=>h.decision.neutral).length,
      rejected:histories.filter(h=>!h.decision.accepted).length,noops:histories.filter(h=>h.decision.reason==='unchanged').length,
      invalidProposals:histories.filter(h=>h.candidate.outputError).length,infrastructureErrors:group.filter(r=>r.result.error).length,
      uniqueSuccessfulGeometry:new Set(successes.map(r=>JSON.stringify(r.result.state.level.objects))).size,
      diversitySuccessful:diversity(successes.map(r=>r.result.state.level)),
      maxSolvedJumps:successes.length?Math.max(...successes.map(r=>r.result.state.report.solver.minJumps)):null,
      logicalTokensIn:all.reduce((s,a)=>s+(a.tokensIn||0),0),logicalTokensOut:all.reduce((s,a)=>s+(a.tokensOut||0),0),
      logicalResponseMs:all.reduce((s,a)=>s+(a.elapsedMs||0),0)};
  }));
  const comparisons=RETAINED_MODELS.flatMap(model=>[['local_feedback','local_none'],['whole_feedback','whole_none'],['local_feedback','whole_feedback'],['local_feedback','local_random'],['whole_feedback','whole_random']].map(([a,b])=>{
    let both=0,aOnly=0,bOnly=0,neither=0,matched=0;
    const differences=Object.fromEntries([...new Set(cases.map(c=>c.task))].map(t=>[t,0]));
    for(const item of cases) {
      const ar=rows.find(r=>r.model===model&&r.caseId===item.id&&r.arm===a),br=rows.find(r=>r.model===model&&r.caseId===item.id&&r.arm===b);
      if(!ar||!br)continue;matched++;const ap=ar.result.passed,bp=br.result.passed;
      differences[item.task]+=Number(ap)-Number(bp);if(ap&&bp)both++;else if(ap)aOnly++;else if(bp)bOnly++;else neither++;
    }
    const families=Object.fromEntries([...new Set(cases.map(c=>c.family))].map(f=>[f,0]));
    for(const [task,value]of Object.entries(differences))families[cases.find(c=>c.task===task).family]+=value;
    return {model,a,b,primary:model===RETAINED_MODELS[0]&&a==='local_feedback'&&b==='local_none',matched,both,aOnly,bOnly,neither,
      differences,familyDifferences:families,briefClusterP:matched===cases.length?signP(Object.values(differences)):null,
      familySensitivityP:matched===cases.length?signP(Object.values(families)):null};
  }));
  return {studyVersion:RETAINED_VERSION,completed:rows.length,planned:cases.length*RETAINED_MODELS.length*RETAINED_ARMS.length,
    summary,comparisons,endpoint:'Initial Qwen whole plan plus up to three literal repair proposals; complete original requirements and full unchanged proxy path; retained state after common nonregression filter.',
    limitations:'Exploratory new numeric configurations in the SAME six task families/library. Twelve briefs with two seeds, shared initial response across all six arms within model/case. 4B local feedback vs local none is the sole primary contrast; 9B and remaining contrasts are secondary. Brief-cluster sign test is conditional; six-family sensitivity is conservative. Local target selection is shared implicit feedback, not an absence-of-all-feedback control. Random means random repair of a Qwen initial plan. Guard/controller effects are not LLM reasoning gains. Models run in serial batches. No native-game pass evidence.'};
}
