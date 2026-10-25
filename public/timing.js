// Timing sensitivity of one witnessed route, not a theorem about all routes.
import {PHYSICS} from './engine.js';
export const TIMING_VERSION='local-input-windows-v1';
export const TIMING_PROFILES=Object.freeze({any:'Любая точность',wide:'Широкие окна',balanced:'Средние окна',tight:'Узкие окна'});
const ms=ticks=>ticks*1000/PHYSICS.hz;
export function checkTimingOptions(profile='any',goal='finish'){
 if(!Object.hasOwn(TIMING_PROFILES,profile))throw new Error('Неизвестный профиль точности.');
 if(!['finish','all-coins'].includes(goal))throw new Error('Неизвестная цель оценки точности.');
 return{profile,goal};
}
export function analyzeTiming(level,input,{replay,goal='finish',maxShiftTicks=24,center=true,maxPasses=4,jitterTicks=3,samples=128,seed=20261023}={}){
 checkTimingOptions('any',goal);
 if(typeof replay!=='function'||!Array.isArray(input)||input.length>100||input.some((t,i)=>!Number.isInteger(t)||t<0||(i>0&&t<=input[i-1])))throw new Error('Для точности нужны replay и возрастающие целые тики прыжков.');
 if(!Number.isInteger(maxShiftTicks)||maxShiftTicks<1||maxShiftTicks>60||!Number.isInteger(maxPasses)||maxPasses<0||maxPasses>6||!Number.isInteger(samples)||samples<0||samples>512||!Number.isInteger(jitterTicks)||jitterTicks<0||jitterTicks>12)throw new Error('Некорректный бюджет оценки точности.');
 let replays=0;
 const valid=ticks=>{
  if(ticks.some((t,i)=>t<0||(i>0&&t<=ticks[i-1])))return false;
  replays++;const trace=replay(level,ticks),last=trace.states.at(-1);
  return(goal==='all-coins'?trace.allCoins===true:trace.passed===true)&&last.jumps===ticks.length;
 };
 const original=[...input];let ticks=[...input];
 const metadata={version:TIMING_VERSION,physicsHz:PHYSICS.hz,goal,horizonTicks:maxShiftTicks,tickMs:ms(1)};
 if(!valid(ticks))return{...metadata,status:'invalid-path',replays,message:'Исходный путь не выполняет цель либо содержит нажатия без прыжка.'};
 if(!ticks.length)return{...metadata,status:'auto',profileObserved:'auto',minimumWindowMs:null,minimumWindowUpperMs:null,windows:[],recommendedJumpTicks:[],replays,jointJitter:null};
 function scan(index,current){
  const allowed=[],at=current[index],left=Math.max(0,at-maxShiftTicks),right=at+maxShiftTicks;
  for(let t=left;t<=right;t++){
   const candidate=[...current];candidate[index]=t;if(valid(candidate))allowed.push(t);
  }
  const runs=[];
  for(const t of allowed){const last=runs.at(-1);if(last&&t===last.to+1)last.to=t;else runs.push({from:t,to:t});}
  return{runs,left,right};
 }
 let optimizationPasses=0;
 if(center)for(let pass=0;pass<maxPasses;pass++){
  let changed=false;
  for(let i=0;i<ticks.length;i++){
   const {runs}=scan(i,ticks);
   const best=runs.sort((a,b)=>(b.to-b.from)-(a.to-a.from)||Math.abs((a.to+a.from)/2-ticks[i])-Math.abs((b.to+b.from)/2-ticks[i]))[0];
   if(!best)throw new Error('Successful timing route lost during centering.');
   const midpoint=Math.floor((best.from+best.to)/2);
   if(midpoint!==ticks[i]){ticks[i]=midpoint;changed=true;}
  }
  optimizationPasses++;if(!changed)break;
 }
 const windows=ticks.map((at,index)=>{
  const {runs,left,right}=scan(index,ticks),run=runs.find(r=>r.from<=at&&r.to>=at);
  if(!run)throw new Error('Timing witness is not inside its own window.');
  const censored=run.from===left&&left===at-maxShiftTicks||run.to===right;
  return{jump:index+1,tick:at,x:at*PHYSICS.dx/PHYSICS.tile,earliestTick:run.from,latestTick:run.to,
   earlyTicks:at-run.from,lateTicks:run.to-at,widthTicks:run.to-run.from,feasibleTicks:run.to-run.from+1,
   earlyMs:ms(at-run.from),lateMs:ms(run.to-at),widthMs:ms(run.to-run.from),censored};
 });
 const lower=Math.min(...windows.map(w=>w.widthTicks)),exact=windows.filter(w=>!w.censored).map(w=>w.widthTicks),upper=exact.length?Math.min(...exact):null;
 const profileObserved=lower>=10?'wide':upper!==null&&upper<4?'tight':lower>=4&&upper!==null&&upper<10?'balanced':'uncertain';
 let randomState=seed>>>0;
 const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return(randomState>>>0)/4294967296;};
 let survived=0;
 for(let i=0;i<samples;i++)if(valid(ticks.map(t=>t+Math.floor(random()*(jitterTicks*2+1))-jitterTicks)))survived++;
 if(!valid(ticks))throw new Error('Centered timing path no longer satisfies goal.');
 return{...metadata,status:'measured',profileObserved,minimumWindowMs:ms(lower),minimumWindowUpperMs:upper===null?null:ms(upper),
  minimumWindowExact:upper!==null&&upper===lower,worstSymmetricMarginMs:ms(Math.min(...windows.map(w=>Math.min(w.earlyTicks,w.lateTicks)))),
  windows,originalJumpTicks:original,recommendedJumpTicks:ticks,optimizationPasses,replays,
  jointJitter:{ticks:jitterTicks,ms:ms(jitterTicks),survived,total:samples,seed},
  scope:'One jump shifted at a time with all other recommended inputs fixed; finite scan horizon. Joint jitter is a separate deterministic sample, not a guarantee or human difficulty rating.'};
}
export function timingRule(analysis,profile='any'){
 checkTimingOptions(profile,analysis?.goal||'finish');
 if(profile==='any')return null;
 const measured=analysis?.status==='measured',passed=measured?analysis.profileObserved===profile:analysis?.status==='auto'?false:null;
 return{code:'TIMING_PROFILE',passed,message:`Точность (${analysis?.goal==='all-coins'?'все монеты':'финиш'}): ${analysis?.profileObserved||'не измерена'} / ${profile}; окно ${analysis?.minimumWindowMs===undefined||analysis.minimumWindowMs===null?'?':analysis.minimumWindowMs.toFixed(1)} мс`};
}
export function applyTimingRule(report,analysis,profile='any'){
 const rule=timingRule(analysis,profile),rules=report.rules.filter(r=>r.code!=='TIMING_PROFILE'),errors=report.errors.filter(e=>e.code!=='TIMING_PROFILE');
 if(rule){rules.push(rule);if(rule.passed===false)errors.push({code:rule.code,message:rule.message});}
 return{...report,rules,errors,passed:report.playable&&rules.every(r=>r.passed===true)};
}
