// Dispatch by the level's explicit version. The measured v1 engine is unchanged.
import * as ground from './engine.js';
import * as elevated from './elevated-engine.js';
import * as coins from './coin-engine.js';
export const PHYSICS=ground.PHYSICS;
export const DEFAULT_REQUIREMENTS=ground.DEFAULT_REQUIREMENTS;
export const DEFAULT_ELEVATED_REQUIREMENTS=elevated.DEFAULT_REQUIREMENTS;
export const EXTRA_REQUIREMENTS=elevated.EXTRA_REQUIREMENTS;
export const ELEVATED_SCHEMA=elevated.LEVEL_SCHEMA;
export const ELEVATED_PHYSICS=elevated.PHYSICS;
export const COIN_SCHEMA=coins.LEVEL_SCHEMA;
export const COIN_PHYSICS=coins.PHYSICS;
export const DEFAULT_COIN_REQUIREMENTS=coins.DEFAULT_REQUIREMENTS;
export const COIN_ONLY_REQUIREMENTS=coins.COIN_ONLY_REQUIREMENTS;
export const checkCoinRequirements=coins.checkRequirements;
export const coinObjects=level=>level?.version===3?coins.coinObjects(level):[];
export const coinCount=coins.coinCount;
export const checkRequirements=ground.checkRequirements;
export const checkElevatedRequirements=elevated.checkRequirements;
export const makeDemo=ground.makeDemo;
export const parseLevel=ground.parseLevel;
export const initialState=ground.initialState;
const engine=level=>level?.version===3?coins:level?.version===2?elevated:ground;
export const schemaErrors=level=>engine(level).schemaErrors(level);
export const step=(level,state,press)=>engine(level).step(level,state,press);
export const replay=(level,ticks)=>engine(level).replay(level,ticks);
export const solve=(level,options)=>engine(level).solve(level,options);
export function validate(level,requirements,options){
  if(level?.version===3)return coins.validate(level,requirements,options);
  if(requirements&&Object.keys(coins.COIN_ONLY_REQUIREMENTS).some(k=>Object.hasOwn(requirements,k))){
    const {minCoins=0,minCoinDetourJumps=0,minBranchSpan=0,...rest}=requirements;
    coins.checkRequirements({...rest,minCoins,minCoinDetourJumps,minBranchSpan});
    const report=validate(level,rest,options);
    if(minCoins>0||minCoinDetourJumps>0||minBranchSpan>0){const rule={code:'COIN_VERSION',passed:false,message:'Для требований к монетам и разделению маршрутов нужен JSON version=3.'};report.rules.push(rule);report.errors.push({code:rule.code,message:rule.message});report.passed=false;}
    return report;
  }
  if(level?.version!==2&&requirements&&Object.keys(EXTRA_REQUIREMENTS).some(k=>Object.hasOwn(requirements,k))){
    const all=elevated.checkRequirements(requirements),base=Object.fromEntries(Object.entries(all).filter(([key])=>!Object.hasOwn(EXTRA_REQUIREMENTS,key)));
    const report=ground.validate(level,base,options);
    if(Object.keys(EXTRA_REQUIREMENTS).some(key=>key.startsWith('max')?all[key]<EXTRA_REQUIREMENTS[key]:all[key]>0)){
      const rule={code:'ELEVATED_VERSION',passed:false,message:'Для требований к поднятым платформам нужен JSON version=2.'};
      report.rules.push(rule);report.errors.push({code:rule.code,message:rule.message});report.passed=false;
    }
    return report;
  }
  return engine(level).validate(level,requirements,options);
}
export function evaluateRaw(raw,requirements){
  let level;
  try{level=parseLevel(raw);}catch(error){return{level:null,report:{schemaValid:false,passed:false,playable:false,physics:'unknown',rules:[],solver:{status:'invalid',jumpTicks:[]},errors:[{code:'JSON_PARSE',message:error.message}]}};}
  return{level,report:validate(level,requirements)};
}
