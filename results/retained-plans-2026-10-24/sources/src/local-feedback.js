import {PHYSICS as P,initialState,step,replay,evaluateRaw,checkRequirements} from '../public/engine.js';
export const FEEDBACK_VERSION='localized-repair-feedback-v1';
const round=n=>Math.round(n*1000)/1000;
const describe=s=>({tick:s.tick,x:round(s.x/P.tile),y:round(s.y/P.tile),vy:round(s.vy/P.tile),grounded:s.grounded,dead:s.dead});

// A second traversal of the SAME state graph exposes one executable failing
// witness. It neither edits geometry nor searches alternative level designs.
export function failureWitness(level,{maxStates=600000}={}){
 let frontier=[{...initialState(),parent:null,input:false}],visited=1;
 const total=Math.ceil(level.length*P.tile/P.dx);
 for(let tick=0;tick<total;tick++){
  const next=new Map(),fatal=[];
  for(const state of frontier)for(const press of state.grounded?[false,true]:[false]){
   const s=step(level,state,press);if(++visited>maxStates)return{status:'inconclusive',visited};
   const linked={...s,parent:state,input:press};
   if(s.dead){fatal.push(linked);continue;}
   const key=`${s.y}:${s.vy}:${Number(s.grounded)}`,old=next.get(key);
   if(!old||s.jumps<old.jumps)next.set(key,linked);
  }
  if(!next.size){
   // Highest surviving position is an informative representative. The failure
   // of all surviving states at this tick comes from the complete traversal.
   const end=fatal.sort((a,b)=>b.parent.y-a.parent.y||a.jumps-b.jumps)[0];
   if(!end)return{status:'unavailable',visited};
   const inputs=[];let cursor=end;
   while(cursor.parent){if(cursor.input)inputs.push(cursor.tick-1);cursor=cursor.parent;}inputs.reverse();
   const trace=replay(level,inputs);
   if(!trace.states.at(-1).dead||trace.states.at(-1).tick!==end.tick)throw new Error('Failing witness did not reproduce');
   const blockers=level.objects.map((o,index)=>({index,...o})).filter(o=>step({objects:[o]},end.parent,end.input).dead);
   const tail=trace.states.slice(-25).filter((_,i,a)=>i%4===0||i===a.length-1).map(describe);
   return{status:'unreachable',visited,lastAlive:describe(end.parent),death:describe(end),blockingObjects:blockers,
    representativeJumpTicks:inputs,recentStates:tail,
    lastTakeoffX:inputs.length?round(inputs.at(-1)*P.dx/P.tile):null,
    scope:'All surviving states die at this tick in the v1 graph. The displayed partial trajectory is ONE representative, not a uniquely required route or a full playable solution.'};
  }
  frontier=[...next.values()];
 }
 return{status:'reachable',visited};
}

function geometryContext(level,x){
 return level.objects.map((o,index)=>({index,...o})).filter(o=>o.x+o.w>=x-7&&o.x<=x+7).slice(0,9);
}
export function localizedFeedback(raw,requirements,{maxStates=600000}={}){
 const r=checkRequirements(requirements),{level,report}=evaluateRaw(raw,r);
 const stage=!report.schemaValid?'structure':!report.playable?'path':'requirements';
 const diagnostic={version:FEEDBACK_VERSION,physics:report.physics,stage,
  repairOrder:['Make JSON and object groups valid','Make the level traversable','Satisfy ALL original requirements'],
  passedRulesToPreserve:report.rules.filter(rule=>rule.passed===true).map(rule=>({code:rule.code,message:rule.message})),
  unresolvedRules:report.rules.filter(rule=>rule.passed!==true).map(rule=>({code:rule.code,message:rule.message,status:rule.passed===null?'unknown':'failed'})),
  errors:report.errors,observedCounters:report.stats??null,
  constraints:{length:r.length,everyObjectXAtLeast:r.safeStart,everyObjectRightEdgeAtMost:r.length-r.safeFinish,adjacentGroupsNeedAtLeastOneEmptyTile:true},
  priority:[],execution:null};
 const usable=level&&Array.isArray(level.objects)&&level.objects.every(o=>o&&['block','spike'].includes(o.type)&&[o.x,o.w,o.h].every(Number.isInteger));
 if(!report.schemaValid){
  const pairs=usable?[...level.objects.map((o,index)=>({index,...o}))].sort((a,b)=>a.x-b.x):[];
  for(let i=1;i<pairs.length;i++){
   const left=pairs[i-1],right=pairs[i],minimumX=left.x+left.w+1;
   if(right.x<minimumX)diagnostic.priority.push({code:right.x===minimumX-1?'ADJACENT_GROUPS':'OVERLAP',objects:[left.index,right.index],
    actualRightObjectX:right.x,minimumRightObjectXIfLeftUnchanged:minimumX,
    instruction:'Separate these groups. Moving the right group can affect its next neighbour and the safe finish; recheck the whole level.'});
  }
  if(!diagnostic.priority.length)diagnostic.priority.push(...report.errors.slice(0,5));
  diagnostic.priority=diagnostic.priority.slice(0,8);
  diagnostic.execution={status:'not-run-invalid-structure'};
 }else if(!report.playable){
  diagnostic.execution=report.solver.status==='unreachable'?failureWitness(level,{maxStates}):{status:report.solver.status};
  const x=diagnostic.execution.death?.x??report.solver.maxX??0;
  diagnostic.localObjects=geometryContext(level,x);
  diagnostic.priority=[{code:'NO_PATH',x:round(x),instruction:'Repair the neighbourhood where all trajectories stop. Use the executed blocker and available approach surfaces. Preserve required triples, tall blocks and tight gaps; deleting difficulty is not a full repair.'}];
 }else{
  const trace=replay(level,report.solver.jumpTicks);
  if(!trace.passed)throw new Error('Finish witness did not reproduce');
  diagnostic.execution={status:'reachable',minimumJumps:report.solver.minJumps,jumpXs:report.solver.jumpTicks.map(t=>round(t*P.dx/P.tile)),
   scope:'Minimum-jump witness in the proxy; do not confuse obstacle counts with required jumps.'};
  diagnostic.priority=diagnostic.unresolvedRules.filter(rule=>rule.status==='failed');
 }
 // Numerically expose count deficits instead of making the LLM recompute them.
 if(report.stats){
  const fields={minSpikes:'spikes',minBlocks:'blocks',minDoubleSpikes:'doubleSpikes',minTripleSpikes:'tripleSpikes',minTallBlocks:'tallBlocks',minTightGaps:'tightGaps'};
  diagnostic.deficits=Object.entries(fields).filter(([key,stat])=>r[key]>report.stats[stat]).map(([requirement,stat])=>({requirement,actual:report.stats[stat],required:r[requirement],missing:r[requirement]-report.stats[stat]}));
  if(report.playable&&report.solver.minJumps<r.minJumps)diagnostic.deficits.push({requirement:'minJumps',actual:report.solver.minJumps,required:r.minJumps,missing:r.minJumps-report.solver.minJumps});
 }
 diagnostic.instructions='Return your own complete replacement JSON. Start with the priority issue, then recheck all original requirements. These measurements describe the current candidate; they do not supply a corrected level. Preserve rules already passed whenever possible. All movement is approximate proxy physics.';
 return diagnostic;
}
