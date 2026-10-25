// V3 adds collectible state; the numerical solid-body physics stays in v2.
import * as base from './elevated-engine.js';
import {measureRouteSeparation} from './route-separation.js';
export const PHYSICS=Object.freeze({...base.PHYSICS,id:'cube-proxy-v3-coins',coinRadius:.35});
export const COIN_ONLY_REQUIREMENTS=Object.freeze({minCoins:1,minCoinDetourJumps:0,minBranchSpan:0});
export const EXTRA_REQUIREMENTS=Object.freeze({...base.EXTRA_REQUIREMENTS,...COIN_ONLY_REQUIREMENTS});
export const DEFAULT_REQUIREMENTS=Object.freeze({...base.DEFAULT_REQUIREMENTS,...COIN_ONLY_REQUIREMENTS});
export const LEVEL_SCHEMA={...base.LEVEL_SCHEMA,properties:{...base.LEVEL_SCHEMA.properties,version:{type:'integer',const:3},objects:{...base.LEVEL_SCHEMA.properties.objects,items:{...base.LEVEL_SCHEMA.properties.objects.items,properties:{...base.LEVEL_SCHEMA.properties.objects.items.properties,type:{type:'string',enum:['block','spike','spike_down','coin']}}}}}};
const issue=(code,message,extra={})=>({code,message,...extra});
const cache=new WeakMap();
function compiled(level){
  if(!cache.has(level))cache.set(level,{solids:{...level,version:2,objects:level.objects.filter(o=>o.type!=='coin')},coins:level.objects.filter(o=>o.type==='coin').sort((a,b)=>a.x-b.x||a.y-b.y)});
  return cache.get(level);
}
export const coinObjects=level=>compiled(level).coins;
export const coinCount=mask=>{let count=0;for(let n=mask;n;n>>>=1)count+=n&1;return count;};
export function checkRequirements(input=DEFAULT_REQUIREMENTS){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Требования должны быть объектом.');
  const {minCoins=1,minCoinDetourJumps=0,minBranchSpan=0,...rest}=input;
  if(!Number.isInteger(minCoins)||minCoins<0||minCoins>3)throw new Error('minCoins: целое от 0 до 3.');
  if(!Number.isInteger(minCoinDetourJumps)||minCoinDetourJumps<0||minCoinDetourJumps>100)throw new Error('minCoinDetourJumps: целое от 0 до 100.');
  if(!Number.isInteger(minBranchSpan)||minBranchSpan<0||minBranchSpan>100)throw new Error('minBranchSpan: целое от 0 до 100.');
  return{...base.checkRequirements(rest),minCoins,minCoinDetourJumps,minBranchSpan};
}
export function schemaErrors(level){
  if(!level||typeof level!=='object'||Array.isArray(level))return[issue('SCHEMA','Ожидается JSON-объект уровня.')];
  const errors=[];
  if(level.version!==3)errors.push(issue('SCHEMA','Для монет нужен JSON version=3.'));
  if(!Array.isArray(level.objects)||level.objects.length>100)return[...errors,issue('SCHEMA','objects: массив до 100 объектов.')];
  // The v2 validator enforces all common bounds and unknown-field constraints.
  const proxy={...level,version:2,objects:level.objects.map(o=>o?.type==='coin'?{...o,type:'spike'}:o)};
  const common=base.schemaErrors(proxy).filter(e=>e.code!=='OVERLAP'&&e.code!=='MERGEABLE_BLOCKS');
  errors.push(...common);
  const coins=level.objects.filter(o=>o?.type==='coin');
  if(coins.length>3)errors.push(issue('COIN_LIMIT','В уровне разрешено не больше трёх монет.'));
  for(const [i,o]of level.objects.entries())if(o?.type==='coin'&&(o.w!==1||o.h!==1))errors.push(issue('SCHEMA',`objects[${i}]: монета занимает w=1,h=1.`,{object:i}));
  if(errors.length)return errors;
  // Coins may touch a supporting surface, but cannot be embedded in geometry.
  for(let i=0;i<level.objects.length;i++)for(let j=i+1;j<level.objects.length;j++){
    const a=level.objects[i],b=level.objects[j];
    if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)
      errors.push(issue('OVERLAP',`Объекты ${i} и ${j} пересекаются по x и y.`,{objects:[i,j],x:Math.max(a.x,b.x)}));
  }
  errors.push(...base.schemaErrors({...level,version:2,objects:level.objects.filter(o=>o.type!=='coin')}).filter(e=>e.code==='MERGEABLE_BLOCKS'));
  return errors;
}
export const initialState=()=>({...base.initialState(),coinMask:0});
export function step(level,state,press=false){
  const {solids,coins}=compiled(level),s=base.step(solids,state,press);
  let mask=state.coinMask??0;
  if(!s.dead)for(const [i,c]of coins.entries()){
    if(mask&(1<<i))continue;
    const cx=(c.x+.5)*PHYSICS.tile,cy=(c.y+.5)*PHYSICS.tile,r=PHYSICS.coinRadius*PHYSICS.tile;
    const dx=cx-Math.max(s.x,Math.min(s.x+PHYSICS.width,cx)),dy=cy-Math.max(s.y,Math.min(s.y+PHYSICS.height,cy));
    if(dx*dx+dy*dy<r*r)mask|=1<<i;
  }
  return{...s,coinMask:mask};
}
export function replay(level,jumpTicks){
  const inputs=new Set(jumpTicks),states=[initialState()],total=Math.ceil(level.length*PHYSICS.tile/PHYSICS.dx);
  for(let tick=0;tick<total;tick++){const s=step(level,states.at(-1),inputs.has(tick));states.push(s);if(s.dead)break;}
  const last=states.at(-1),passed=!last.dead&&last.x>=level.length*PHYSICS.tile,totalCoins=coinObjects(level).length;
  return{passed,allCoins:passed&&last.coinMask===(1<<totalCoins)-1,collectedCoins:coinCount(last.coinMask),totalCoins,states};
}
function describePath(level,result,goal){
  if(!result.passed)return{...result,goal};
  const trace=replay(level,result.jumpTicks);
  return{...result,goal,collectedCoins:trace.collectedCoins,coinMask:trace.states.at(-1).coinMask};
}
export function solve(level,{goal='finish',maxStates=600000,objective='jumps'}={}){
  if(!['finish','all-coins'].includes(goal))throw new Error('Цель: finish или all-coins.');
  if(!['jumps','elevatedLandings'].includes(objective))throw new Error('Неизвестная цель стоимости поиска.');
  const errors=schemaErrors(level);
  if(errors.length)return{status:'invalid',passed:false,errors,visited:0,jumpTicks:[],maxX:0,goal};
  if(goal==='finish')return describePath(level,base.solve(compiled(level).solids,{maxStates,objective}),goal);
  const coins=coinObjects(level),allMask=(1<<coins.length)-1,p=PHYSICS;
  let frontier=[{...initialState(),parent:null,input:false}],visited=1,maxX=0;
  const total=Math.ceil(level.length*p.tile/p.dx);
  const better=(a,b)=>a[objective]<b[objective]||(a[objective]===b[objective]&&a.jumps<b.jumps);
  for(let tick=0;tick<total;tick++){
    const next=new Map();
    for(const state of frontier)for(const press of state.grounded?[false,true]:[false]){
      const s=step(level,state,press);visited++;
      if(visited>maxStates)return{status:'inconclusive',passed:false,visited,maxX,jumpTicks:[],goal,errors:[issue('SEARCH_BUDGET','Лимит поиска монет исчерпан; исход неизвестен.')]};
      if(s.dead)continue;maxX=Math.max(maxX,s.x/p.tile);
      // X only increases: a missed coin whose pickup circle is already behind
      // the player can never be collected later in this classic-cube model.
      if(coins.some((c,i)=>!(s.coinMask&(1<<i))&&(c.x+.5+p.coinRadius)*p.tile<s.x))continue;
      const key=`${s.y}:${s.vy}:${Number(s.grounded)}:${s.coinMask}`,old=next.get(key);
      if(!old||better(s,old))next.set(key,{...s,parent:state,input:press});
    }
    frontier=[...next.values()];
    if(!frontier.length)return{status:'unreachable',passed:false,visited,maxX,jumpTicks:[],goal,errors:[issue('NO_COIN_PATH',`Не найден единый проход со всеми монетами; поиск остановился около x=${maxX.toFixed(2)}.`,{x:+maxX.toFixed(2)})]};
  }
  const successful=frontier.filter(s=>s.coinMask===allMask);
  if(!successful.length)return{status:'unreachable',passed:false,visited,maxX,jumpTicks:[],goal,errors:[issue('NO_COIN_PATH','Финиш достижим, но ни один путь не собрал все монеты.')]};
  let best=successful.reduce((a,b)=>better(b,a)?b:a);
  const jumps=best.jumps,elevatedLandings=best.elevatedLandings,jumpTicks=[];
  while(best.parent){if(best.input)jumpTicks.push(best.tick-1);best=best.parent;}jumpTicks.reverse();
  if(!replay(level,jumpTicks).allCoins)throw new Error('Coin solver/replay mismatch');
  return describePath(level,{status:'reachable',passed:true,visited,maxX,jumpTicks,objective,pathJumps:jumps,pathElevatedLandings:elevatedLandings,
    ...(objective==='jumps'?{minJumps:jumps}:{minElevatedLandings:elevatedLandings}),errors:[]},goal);
}
export function validate(level,requirements=DEFAULT_REQUIREMENTS,options={}){
  const r=checkRequirements(requirements),errors=schemaErrors(level);
  if(errors.length)return{schemaValid:false,passed:false,playable:false,coinsPlayable:false,rules:[],errors,solver:{status:'invalid',jumpTicks:[]},coinSolver:{status:'invalid',jumpTicks:[]},physics:PHYSICS.id};
  const {minCoins,minCoinDetourJumps,minBranchSpan,...ordinaryRequirements}=r;
  const report=base.validate(compiled(level).solids,ordinaryRequirements,options);
  report.physics=PHYSICS.id;report.solver=describePath(level,report.solver,'finish');
  const coins=coinObjects(level),first=Math.min(level.length,...level.objects.map(o=>o.x)),last=Math.max(0,...level.objects.map(o=>o.x+o.w));
  for(const rule of report.rules){
    if(rule.code==='SAFE_START'){rule.passed=first>=r.safeStart;rule.message=`Безопасный старт: ${first} / ≥${r.safeStart}`;}
    if(rule.code==='SAFE_FINISH'){rule.passed=level.length-last>=r.safeFinish;rule.message=`Безопасный финиш: ${level.length-last} / ≥${r.safeFinish}`;}
  }
  report.coinSolver=report.solver.status==='unreachable'?{...report.solver,goal:'all-coins'}:solve(level,{...options,goal:'all-coins'});
  report.coinsPlayable=report.coinSolver.passed;
  report.stats={...report.stats,coins:coins.length};
  report.rules.push({code:'COINS',passed:coins.length>=minCoins,message:`Монеты: ${coins.length} / ≥${minCoins}`},
    {code:'ALL_COINS',passed:report.coinSolver.status==='inconclusive'?null:report.coinSolver.passed,message:report.coinSolver.passed?`Все монеты за один проход: ${coins.length} / ${coins.length}`:report.coinSolver.status==='inconclusive'?'Проход со всеми монетами: результат неизвестен':'Проход со всеми монетами не найден'});
  if(minCoinDetourJumps>0){const delta=report.solver.passed&&report.coinSolver.passed?report.coinSolver.minJumps-report.solver.minJumps:null;report.rules.push({code:'COIN_DETOUR',passed:delta===null?null:delta>=minCoinDetourJumps,message:`Дополнительные прыжки за всеми монетами: ${delta??'?'} / ≥${minCoinDetourJumps}`});}
  report.routeSeparation=report.solver.passed&&report.coinSolver.passed
    ?measureRouteSeparation(level,report.solver.jumpTicks,report.coinSolver.jumpTicks,{replay,physics:PHYSICS})
    :{status:'unavailable',spanTiles:null};
  if(minBranchSpan>0){const span=report.routeSeparation.spanTiles;report.rules.push({code:'BRANCH_SPAN',passed:span===null?null:span>=minBranchSpan,message:`Непрерывное разделение найденных путей по высоте ≥2 клеток: ${span===null?'?':span.toFixed(1)} / ≥${minBranchSpan} клеток`});}
  report.passed=report.playable&&report.rules.every(rule=>rule.passed===true);
  report.errors=[...report.solver.errors,...(report.coinSolver.passed?[]:report.coinSolver.errors),...report.rules.filter(rule=>rule.passed===false).map(rule=>issue(rule.code,rule.message))];
  return report;
}
