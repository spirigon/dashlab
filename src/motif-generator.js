import { checkRequirements, validate, parseLevel } from '../public/engine.js';
import { ollamaChat } from './llm.js';

export const MOTIF_VERSION='llm-motif-plan-v1';
export const MOTIFS=Object.freeze({
  triple_pair:[{type:'spike',x:0,w:3,h:1},{type:'spike',x:5,w:3,h:1}],
  stairs:[{type:'block',x:0,w:2,h:1},{type:'block',x:4,w:2,h:2}],
  tower_triple:[{type:'block',x:0,w:2,h:2},{type:'spike',x:3,w:3,h:1}],
});
export function planSchema(requirements){
  const r=checkRequirements(requirements),slots=Math.max(1,Math.ceil(r.minJumps/2),r.minTightGaps);
  if(slots>16)throw new Error('План поддерживает до 16 связок.');
  return {type:'object',additionalProperties:false,required:['name','motifs'],properties:{name:{type:'string',minLength:1,maxLength:40},
    motifs:{type:'array',minItems:slots,maxItems:slots,items:{type:'string',enum:Object.keys(MOTIFS)}}}};
}
export function compilePlan(plan,requirements){
  const r=checkRequirements(requirements),schema=planSchema(r);
  if(!plan||typeof plan.name!=='string'||plan.name.length<1||plan.name.length>40||!Array.isArray(plan.motifs)||
    Object.keys(plan).some(k=>!['name','motifs'].includes(k))||plan.motifs.length!==schema.properties.motifs.minItems||plan.motifs.some(k=>!Object.hasOwn(MOTIFS,k))){
    throw new Error('Нужны name и motifs: заданное число элементов triple_pair|stairs|tower_triple.');
  }
  let x=Math.max(9,r.safeStart);const objects=[];
  for(const id of plan.motifs){const motif=MOTIFS[id];objects.push(...motif.map(o=>({...o,x:x+o.x})));x+=Math.max(...motif.map(o=>o.x+o.w))+5;}
  const end=x-5;
  if(end>r.length-r.safeFinish)throw new Error(`План заканчивается в x=${end}, требуется не позже ${r.length-r.safeFinish}; triple_pair шире других связок.`);
  return {version:1,name:plan.name,length:r.length,objects};
}
export async function generateMotif({prompt,requirements,seed=900,previous,signal},chat=ollamaChat){
  const r=checkRequirements(requirements),schema=planSchema(r),slots=schema.properties.motifs.minItems;
  const messages=[{role:'system',content:`Design a Geometry Dash cube level by composing a library of fixed motifs. Return ONLY the JSON plan matching the schema.
triple_pair = two triple-spike groups (6 spikes, 0 blocks, 2 triples), width 8 tiles.
stairs = two blocks of heights 1 and 2 (0 spikes, 2 blocks, 1 tall block), width 6 tiles.
tower_triple = a height-2 block then a triple spike (3 spikes, 1 block, 1 tall block, 1 triple), width 6 tiles.
Each motif contains one 1-2 tile internal gap. The compiler places motifs in your chosen order, beginning at x=max(9,safeStart), with 5 empty tiles between motifs. It never adds or deletes motifs to fix your counts. Each motif is intended to need two jumps; the actual proxy search checks this.
Double-spike group requirement counts all groups of width>=2, including triples. Match all requested minimum counts and fit the requested length. Use at least two DIFFERENT motif types and vary their order. The compiler has no fallback layout; the level is exactly your composition.
This is a separate composition method, not free coordinate generation. Geometry and playability are checked after expansion.`},
    {role:'user',content:`Brief: ${prompt}\nRequirements: ${JSON.stringify(r)}\nUse exactly ${slots} motifs. Return name and motifs.`}];
  if(previous)messages.push({role:'user',content:`Previous plan and execution evidence:\n${JSON.stringify(previous)}\nReturn a complete revised plan. Preserve the original challenge requirements.`});
  const response=await chat(messages,{seed,schema,temperature:0.65,signal});
  const call={...response,adapterPromptVersion:response.promptVersion??null,promptVersion:MOTIF_VERSION};
  let plan,level,report,sections=[];
  try{
    plan=parseLevel(call.raw);level=compilePlan(plan,r);report=validate(level,r);
    let offset=0;
    sections=plan.motifs.map((type,index)=>{
      const objects=level.objects.slice(offset,offset+MOTIFS[type].length);offset+=MOTIFS[type].length;
      return {slot:index+1,type,startX:Math.min(...objects.map(o=>o.x)),endX:Math.max(...objects.map(o=>o.x+o.w))};
    });
    const varied=new Set(plan.motifs).size>=2;
    report.rules.push({code:'MOTIF_VARIETY',passed:varied,message:`Типов связок: ${new Set(plan.motifs).size} / ≥2`});
    if(!varied){report.passed=false;report.errors.push({code:'MOTIF_VARIETY',message:'Нужно минимум два типа связок.'});}
  }catch(error){report={schemaValid:false,passed:false,playable:false,rules:[],errors:[{code:'PLAN_COMPILE',message:error.message}],solver:{status:'invalid'}};}
  return {method:MOTIF_VERSION,rawPlan:call.raw,plan:plan??null,level:level??null,sections,report,call};
}
