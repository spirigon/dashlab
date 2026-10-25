// Version 2 adds vertical geometry; v1 and its measured results stay in engine.js.
import {PHYSICS as BASE,DEFAULT_REQUIREMENTS as GROUND_REQUIREMENTS,checkRequirements as checkGroundRequirements,initialState as groundState} from './engine.js';

export const PHYSICS=Object.freeze({...BASE,id:'cube-proxy-v2-elevated'});
export const EXTRA_REQUIREMENTS=Object.freeze({minRaisedBlocks:0,minRaisedSpikes:0,minCeilingSpikes:0,minElevatedLandings:0,maxCoveredSpikes:100,maxGroundSpikeRun:100});
export const DEFAULT_REQUIREMENTS=Object.freeze({...GROUND_REQUIREMENTS,...EXTRA_REQUIREMENTS});
export const LEVEL_SCHEMA={type:'object',additionalProperties:false,required:['version','name','length','objects'],properties:{
  version:{type:'integer',const:2},name:{type:'string',minLength:1,maxLength:40},length:{type:'integer',minimum:24,maximum:180},
  objects:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,required:['type','x','y','w','h'],properties:{
    type:{type:'string',enum:['block','spike','spike_down']},x:{type:'integer',minimum:1,maximum:179},y:{type:'integer',minimum:0,maximum:8},w:{type:'integer',minimum:1,maximum:6},h:{type:'integer',minimum:1,maximum:6},
  }}},
}};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const issue=(code,message,extra={})=>({code,message,...extra});
export function checkRequirements(input){
  if(!obj(input))throw new Error('Требования должны быть объектом.');
  for(const key of Object.keys(input))if(!Object.hasOwn(DEFAULT_REQUIREMENTS,key))throw new Error(`Неизвестное требование: ${key}`);
  const ground=Object.fromEntries(Object.entries(input).filter(([key])=>Object.hasOwn(GROUND_REQUIREMENTS,key)));
  const result={...checkGroundRequirements(ground),...EXTRA_REQUIREMENTS};
  for(const key of Object.keys(EXTRA_REQUIREMENTS)){
    result[key]=input[key]??EXTRA_REQUIREMENTS[key];if(!integer(result[key],0,100))throw new Error(`Требование ${key}: ожидается целое 0…100.`);
  }
  return result;
}
export function schemaErrors(level){
  if(!obj(level))return[issue('SCHEMA','Ожидается JSON-объект уровня.')];
  const errors=[];
  if(level.version!==2)errors.push(issue('SCHEMA','Для вертикальной геометрии version=2.'));
  if(typeof level.name!=='string'||level.name.length<1||level.name.length>40)errors.push(issue('SCHEMA','name: от 1 до 40 символов.'));
  if(!integer(level.length,24,180))errors.push(issue('SCHEMA','length: целое от 24 до 180.'));
  if(Object.keys(level).some(k=>!['version','name','length','objects'].includes(k)))errors.push(issue('SCHEMA','Неизвестное поле уровня.'));
  if(!Array.isArray(level.objects)||level.objects.length>100)return[...errors,issue('SCHEMA','objects: массив до 100 объектов.')];
  level.objects.forEach((o,index)=>{
    if(!obj(o)||!['block','spike','spike_down'].includes(o.type)||!integer(o.x,1,179)||!integer(o.y,0,8)||!integer(o.w,1,6)||!integer(o.h,1,6)||Object.keys(o).some(k=>!['type','x','y','w','h'].includes(k))){
      errors.push(issue('SCHEMA',`objects[${index}]: нужны type, x, y, w, h в пределах схемы.`,{object:index}));return;
    }
    if(o.type!=='block'&&o.h!==1)errors.push(issue('SCHEMA',`objects[${index}]: h шипов должен быть 1.`,{object:index}));
    if(o.type==='spike_down'&&o.y===0)errors.push(issue('SCHEMA',`objects[${index}]: потолочные шипы должны быть выше земли (y≥1).`,{object:index}));
    if(o.x+o.w>level.length||o.y+o.h>10)errors.push(issue('BOUNDS',`objects[${index}]: выходит за длину или высоту 10 клеток.`,{object:index,x:o.x}));
  });
  if(errors.length)return errors;
  for(let i=0;i<level.objects.length;i++)for(let j=i+1;j<level.objects.length;j++){
    const a=level.objects[i],b=level.objects[j];
    if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)
      errors.push(issue('OVERLAP',`Объекты ${i} и ${j} пересекаются по x и y.`,{objects:[i,j],x:Math.max(a.x,b.x)}));
    if(a.type==='block'&&b.type==='block'&&((a.y===b.y&&a.h===b.h&&(a.x+a.w===b.x||b.x+b.w===a.x))||(a.x===b.x&&a.w===b.w&&(a.y+a.h===b.y||b.y+b.h===a.y))))
      errors.push(issue('MERGEABLE_BLOCKS',`Объедините соприкасающиеся прямоугольники ${i} и ${j}; разбиение не увеличивает число платформ.`,{objects:[i,j],x:b.x}));
  }
  return errors;
}
export const initialState=()=>({...groundState(),elevatedLandings:0});
export function step(level,state,press=false){
  if(state.dead)return{...state};
  const p=PHYSICS,T=p.tile,didJump=press&&state.grounded;
  let vy=(didJump?p.jump:state.vy)-p.gravity,y=state.y+vy;
  const x=(state.tick+1)*p.dx;
  let landing=y<=0&&state.y>=0&&vy<=0?0:null,raisedLanding=false;
  for(const o of level.objects)if(o.type==='block'&&x+p.width>o.x*T&&x<(o.x+o.w)*T){
    const top=(o.y+o.h)*T;
    if(vy<=0&&state.y>=top&&y<=top&&top>=(landing??-1)){
      if(top>(landing??-1))raisedLanding=o.y>0;else raisedLanding=raisedLanding||o.y>0;
      landing=top;
    }
  }
  if(landing!==null){y=landing;vy=0;}
  let dead=false;
  for(const o of level.objects){
    if(x+p.width<=o.x*T||x>=(o.x+o.w)*T)continue;
    const bottom=o.y*T,top=(o.y+o.h)*T;
    if(o.type==='block'){if(y<top&&y+p.height>bottom)dead=true;}
    else for(let j=0;j<o.w;j++){
      const left=(o.x+j)*T,lo=Math.max(x,left),hi=Math.min(x+p.width,left+T);
      if(hi<=lo)continue;
      const centre=left+T/2,nearest=Math.max(lo,Math.min(hi,centre)),slope=2*Math.abs(nearest-centre);
      if(o.type==='spike'&&y<bottom+T-slope&&y+p.height>bottom)dead=true;
      if(o.type==='spike_down'&&y<bottom+T&&y+p.height>bottom+slope)dead=true;
    }
  }
  const newLanding=landing!==null&&(!state.grounded||state.y!==landing);
  return{tick:state.tick+1,x,y,vy,grounded:landing!==null,dead,jumps:state.jumps+Number(didJump),
    elevatedLandings:(state.elevatedLandings??0)+Number(newLanding&&raisedLanding)};
}
export function replay(level,jumpTicks){
  const inputs=new Set(jumpTicks),states=[initialState()],total=Math.ceil(level.length*PHYSICS.tile/PHYSICS.dx);
  for(let tick=0;tick<total;tick++){const s=step(level,states.at(-1),inputs.has(tick));states.push(s);if(s.dead)break;}
  return{passed:!states.at(-1).dead&&states.at(-1).x>=level.length*PHYSICS.tile,states};
}
export function solve(level,{maxStates=600000,objective='jumps'}={}){
  if(!['jumps','elevatedLandings'].includes(objective))throw new Error('Неизвестная цель поиска.');
  const errors=schemaErrors(level);
  if(errors.length)return{status:'invalid',passed:false,errors,visited:0,jumpTicks:[],maxX:0};
  let frontier=[{...initialState(),parent:null,input:false}],visited=1,maxX=0;
  const total=Math.ceil(level.length*PHYSICS.tile/PHYSICS.dx);
  const better=(a,b)=>a[objective]<b[objective]||(a[objective]===b[objective]&&a.jumps<b.jumps);
  for(let tick=0;tick<total;tick++){
    const next=new Map();
    for(const state of frontier)for(const press of state.grounded?[false,true]:[false]){
      const s=step(level,state,press);visited++;
      if(visited>maxStates)return{status:'inconclusive',passed:false,visited,maxX,jumpTicks:[],errors:[issue('SEARCH_BUDGET','Лимит поиска исчерпан; исход неизвестен.')]};
      if(s.dead)continue;maxX=Math.max(maxX,s.x/PHYSICS.tile);
      const key=`${s.y}:${s.vy}:${Number(s.grounded)}`,old=next.get(key);
      if(!old||better(s,old))next.set(key,{...s,parent:state,input:press});
    }
    frontier=[...next.values()];
    if(!frontier.length)return{status:'unreachable',passed:false,visited,maxX,jumpTicks:[],errors:[issue('NO_PATH',`Все траектории погибают около x=${maxX.toFixed(2)}.`,{x:+maxX.toFixed(2)})]};
  }
  let best=frontier.reduce((a,b)=>better(b,a)?b:a);
  const jumps=best.jumps,elevatedLandings=best.elevatedLandings,jumpTicks=[];
  while(best.parent){if(best.input)jumpTicks.push(best.tick-1);best=best.parent;}jumpTicks.reverse();
  if(!replay(level,jumpTicks).passed)throw new Error('Solver/replay mismatch');
  return{status:'reachable',passed:true,visited,maxX,jumpTicks,objective,pathJumps:jumps,pathElevatedLandings:elevatedLandings,
    ...(objective==='jumps'?{minJumps:jumps}:{minElevatedLandings:elevatedLandings}),errors:[]};
}
function spikeGroups(objects){
  const result=[];
  for(const o of objects.filter(o=>o.type!=='block').sort((a,b)=>a.type.localeCompare(b.type)||a.y-b.y||a.x-b.x)){
    const previous=result.at(-1);
    if(previous&&previous.type===o.type&&previous.y===o.y&&previous.x+previous.w===o.x)previous.w+=o.w;else result.push({...o});
  }
  return result;
}
export function validate(level,requirements=DEFAULT_REQUIREMENTS,options){
  const r=checkRequirements(requirements),errors=schemaErrors(level);
  if(errors.length)return{schemaValid:false,passed:false,playable:false,rules:[],errors,solver:{status:'invalid',jumpTicks:[]},physics:PHYSICS.id};
  const solver=solve(level,options),blocks=level.objects.filter(o=>o.type==='block'),spikes=spikeGroups(level.objects);
  const rows=new Map();for(const o of level.objects){const row=rows.get(o.y)||[];row.push(o);rows.set(o.y,row);}
  const tightGaps=[...rows.values()].reduce((n,row)=>{row.sort((a,b)=>a.x-b.x);return n+row.slice(1).filter((o,i)=>o.x-(row[i].x+row[i].w)>=1&&o.x-(row[i].x+row[i].w)<=2).length;},0);
  const stats={spikes:spikes.reduce((n,o)=>n+o.w,0),blocks:blocks.length,doubleSpikes:spikes.filter(o=>o.w>=2).length,tripleSpikes:spikes.filter(o=>o.w>=3).length,
    tallBlocks:blocks.filter(o=>o.h>=2).length,tightGaps,raisedBlocks:blocks.filter(o=>o.y>0).length,raisedSpikes:spikes.filter(o=>o.type==='spike'&&o.y>0).length,ceilingSpikes:spikes.filter(o=>o.type==='spike_down').length,
    coveredSpikes:spikes.filter(o=>o.type==='spike').reduce((n,o)=>n+Array.from({length:o.w},(_,j)=>blocks.some(b=>b.y>=o.y+1&&b.x<o.x+j+1&&b.x+b.w>o.x+j)).filter(Boolean).length,0),
    groundSpikeRun:Math.max(0,...spikes.filter(o=>o.type==='spike'&&o.y===0).map(o=>o.w))};
  const first=Math.min(level.length,...level.objects.map(o=>o.x)),last=Math.max(0,...level.objects.map(o=>o.x+o.w));
  const rules=[['LENGTH',level.length===r.length,`Длина: ${level.length} / ${r.length}`],['SPIKES',stats.spikes>=r.minSpikes,`Шипы: ${stats.spikes} / ≥${r.minSpikes}`],
    ['BLOCKS',stats.blocks>=r.minBlocks,`Группы блоков: ${stats.blocks} / ≥${r.minBlocks}`],['DOUBLE_SPIKES',stats.doubleSpikes>=r.minDoubleSpikes,`Группы из ≥2 шипов: ${stats.doubleSpikes} / ≥${r.minDoubleSpikes}`],
    ['SAFE_START',first>=r.safeStart,`Безопасный старт: ${first} / ≥${r.safeStart}`],['SAFE_FINISH',level.length-last>=r.safeFinish,`Безопасный финиш: ${level.length-last} / ≥${r.safeFinish}`],
    ['MIN_JUMPS',solver.passed?solver.minJumps>=r.minJumps:null,`Обязательные прыжки: ${solver.minJumps??'?'} / ≥${r.minJumps}`]].map(([code,passed,message])=>({code,passed,message}));
  for(const [key,stat,code,label]of [
    ['minTripleSpikes','tripleSpikes','TRIPLE_SPIKES','Группы из ≥3 шипов'],['minTallBlocks','tallBlocks','TALL_BLOCKS','Блоки высотой ≥2'],['minTightGaps','tightGaps','TIGHT_GAPS','Промежутки 1–2 клетки на одной высоте'],
    ['minRaisedBlocks','raisedBlocks','RAISED_BLOCKS','Блоки на высоте'],['minRaisedSpikes','raisedSpikes','RAISED_SPIKES','Группы шипов над землёй'],['minCeilingSpikes','ceilingSpikes','CEILING_SPIKES','Группы потолочных шипов'],
  ])if(r[key]>0)rules.push({code,passed:stats[stat]>=r[key],message:`${label}: ${stats[stat]} / ≥${r[key]}`});
  if(r.maxCoveredSpikes<100)rules.push({code:'COVERED_SPIKES',passed:stats.coveredSpikes<=r.maxCoveredSpikes,message:`Шипы под блоками: ${stats.coveredSpikes} / ≤${r.maxCoveredSpikes}`});
  if(r.maxGroundSpikeRun<100)rules.push({code:'GROUND_SPIKE_RUN',passed:stats.groundSpikeRun<=r.maxGroundSpikeRun,message:`Самый длинный ряд наземных шипов: ${stats.groundSpikeRun} / ≤${r.maxGroundSpikeRun}`});
  const designWarnings=[];
  if(stats.coveredSpikes>0&&r.maxCoveredSpikes===100)designWarnings.push({code:'COVERED_SPIKES',message:`Шипов под блоками: ${stats.coveredSpikes}. Проверьте, нужен ли этот повторяющийся приём.`});
  if(stats.groundSpikeRun>=4&&r.maxGroundSpikeRun===100)designWarnings.push({code:'GROUND_SPIKE_RUN',message:`Ряд из ${stats.groundSpikeRun} наземных шипов. Такой переход не подтверждён прохождением в игре; рекомендуется укоротить.`});
  let landingSearch=null;
  if(r.minElevatedLandings>0){
    if(solver.passed)landingSearch=solve(level,{...options,objective:'elevatedLandings'});
    const minimum=landingSearch?.minElevatedLandings;
    rules.push({code:'ELEVATED_LANDINGS',passed:Number.isInteger(minimum)?minimum>=r.minElevatedLandings:null,message:`Обязательные приземления на поднятые платформы: ${minimum??'?'} / ≥${r.minElevatedLandings}`});
  }
  return{schemaValid:true,passed:solver.passed&&rules.every(rule=>rule.passed===true),playable:solver.passed,physics:PHYSICS.id,rules,stats,solver,landingSearch,designWarnings,
    errors:[...solver.errors,...(landingSearch?.status==='inconclusive'?landingSearch.errors:[]),...rules.filter(rule=>rule.passed===false).map(rule=>issue(rule.code,rule.message))]};
}
