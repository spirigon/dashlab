import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {retainedCases,retainedMessages,selectRepairSection,applyPlanProposal,runRetainedChain,RETAINED_ARMS,RETAINED_MODELS} from '../src/retained-plans.js';
import {retainedWitness,summarizeRetained} from '../src/retained-study.js';
import {evaluateGlobal} from '../src/feedback-sweep.js';
const tasks=JSON.parse(await readFile(new URL('../examples/briefs-retained.json',import.meta.url),'utf8'));
const item=retainedCases(tasks)[0],witness=retainedWitness(item);
const state={raw:witness.raw,...evaluateGlobal(witness.raw,item.requirements)};
const failedPlan=structuredClone(state.plan);for(const part of Object.values(failedPlan))part.pairs=part.pairs.map(()=>'triple_pair');
const failedRaw=JSON.stringify(failedPlan),failed={raw:failedRaw,...evaluateGlobal(failedRaw,item.requirements)};

test('new bank has twelve numerical tasks, six families,24cases and288assignments',()=>{
  assert.equal(tasks.length,12);assert.equal(new Set(tasks.map(t=>t.family)).size,6);
  const cases=retainedCases(tasks);assert.equal(cases.length,24);assert.equal(new Set(cases.map(c=>c.seed)).size,24);
  assert.equal(cases.length*RETAINED_ARMS.length*RETAINED_MODELS.length,288);assert.equal(witness.report.passed,true);
});
test('local patch preserves the other three exact plans and original requirements',()=>{
  const before=structuredClone(item.requirements),target={index:0};
  const result=applyPlanProposal(failed,JSON.stringify(state.plan.s1),item,'local',target);
  for(let i=2;i<=4;i++)assert.deepEqual(result.candidate.plan['s'+i],failed.plan['s'+i]);
  assert.deepEqual(result.candidate.plan.s1,state.plan.s1);assert.deepEqual(item.requirements,before);
});
test('invalid local proposal is rejected and retained state is identical',()=>{
  const result=applyPlanProposal(failed,'{}',item,'local',{index:0});
  assert.equal(result.decision.accepted,false);assert.equal(result.effective,failed);assert.ok(result.candidate.outputError);
});
test('a passed state is protected and receives no repair calls',async()=>{
  let calls=0;const result=await runRetainedChain(item,'local_feedback',async()=>{calls++;return{raw:witness.raw};});
  assert.equal(calls,1);assert.equal(result.initialPassed,true);assert.equal(result.passed,true);assert.equal(result.repairs,0);
  const bad=applyPlanProposal(state,failedRaw,item,'whole',null);assert.equal(bad.decision.accepted,false);assert.equal(bad.effective,state);
});
test('repair cap counts rejected edits and always preserves a valid previous plan',async()=>{
  let calls=0;const result=await runRetainedChain(item,'whole_feedback',async()=>{calls++;return{raw:calls===1?failedRaw:'{}'};});
  assert.equal(calls,4);assert.equal(result.repairs,3);assert.equal(result.passed,false);
  assert.deepEqual(result.state.plan,failed.plan);assert.ok(result.history.every(h=>!h.decision.accepted));
});
test('local target is shared information; only feedback arm receives measurements',()=>{
  const a=retainedMessages(item,failed,'local_none',0),b=retainedMessages(item,failed,'local_feedback',0);
  assert.deepEqual(a.target,b.target);assert.deepEqual(a.schema,b.schema);
  assert.deepEqual(a.messages.slice(0,2),b.messages.slice(0,2));assert.equal(a.diagnostic,null);assert.ok(b.diagnostic.current.errors.length);
  assert.ok(!a.messages.at(-1).content.includes('Measured feedback'));
});
test('target uses actual failed-path position and rejects incomplete plans',()=>{
  const blocked={...failed,report:{...failed.report,playable:false,solver:{maxX:40}}};
  const target=selectRepairSection(blocked,item.requirements,0);assert.equal(target.reason,'earliest-failed-path');assert.equal(target.index,1);
  assert.equal(selectRepairSection({...blocked,plan:null},item.requirements,0).index,null);
});
test('random repair controls still use one Qwen initial and zero model repair calls',async()=>{
  for(const arm of ['whole_random','local_random']){
    let calls=0;const result=await runRetainedChain(item,arm,async()=>{calls++;return{raw:failedRaw};});
    assert.equal(calls,1);assert.ok(result.repairs<=3);assert.equal(result.condition,'random');
    for(const h of result.history)assert.equal(h.source,'uniform-same-plan-space-repair-NOT-LLM');
  }
});
test('initial API failure is recorded in denominator; success is never invented',async()=>{
  const result=await runRetainedChain(item,'local_feedback',async()=>{throw new Error('API unavailable');});
  assert.equal(result.passed,false);assert.equal(result.error,'API unavailable');
  const summary=summarizeRetained([{model:RETAINED_MODELS[0],arm:'local_feedback',caseId:item.id,result}], [item]);
  const cell=summary.summary.find(s=>s.model===RETAINED_MODELS[0]&&s.arm==='local_feedback');assert.equal(cell.completed,1);assert.equal(cell.infrastructureErrors,1);assert.equal(cell.successes,0);
});
