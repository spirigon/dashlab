import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validate,replay,PHYSICS,checkRequirements} from '../public/coin-engine.js';
import * as facade from '../public/geometry.js';
import {measureRouteSeparation} from '../public/route-separation.js';
import {generateCoins} from '../src/coin-llm.js';
const load=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const requirements={length:70,minSpikes:0,minBlocks:0,minDoubleSpikes:0,minJumps:0,safeStart:0,safeFinish:0,minCoins:1,minBranchSpan:35};

test('a coin detour with extra jumps does not satisfy a sustained branch requirement',async()=>{
 const level=await load('examples/coins/C01.json'),report=validate(level,{...requirements,minCoinDetourJumps:1});
 assert.equal(report.playable,true);assert.equal(report.coinsPlayable,true);
 assert.ok(report.rules.find(r=>r.code==='COIN_DETOUR').passed);
 assert.equal(report.rules.find(r=>r.code==='BRANCH_SPAN').passed,false);assert.equal(report.passed,false);
 assert.ok(report.routeSeparation.spanTiles<35);
});

test('new branches preserve two full routes and zero versus three coin pickups on the original map',async()=>{
 const {levels}=await load('examples/branch-playable/manifest.json');
 for(const saved of levels){
  const level=await load(`examples/branch-playable/${saved.id}.json`),report=validate(level,saved.requirements);
  assert.equal(report.passed,true);assert.equal(report.solver.minJumps,5);
  const lower=replay(level,report.solver.jumpTicks),upper=replay(level,report.coinSolver.jumpTicks);
  assert.equal(lower.passed,true);assert.equal(lower.collectedCoins,0);assert.equal(upper.allCoins,true);
  assert.ok(report.routeSeparation.spanTiles>=45);assert.ok(report.routeSeparation.toX<68);
  // Independently check every sample in the reported interval; no checkpoint-only shortcut.
  for(let i=0;i<lower.states.length;i++)if(lower.states[i].x/PHYSICS.tile>=report.routeSeparation.fromX&&lower.states[i].x/PHYSICS.tile<=report.routeSeparation.toX)assert.ok(upper.states[i].y-lower.states[i].y>=2*PHYSICS.tile);
  assert.ok(replay(level,saved.allCoinJumpTicks).allCoins);
  assert.ok(measureRouteSeparation(level,saved.jumpTicks,saved.allCoinJumpTicks,{replay,physics:PHYSICS}).spanTiles>=35);
  assert.equal(report.stats.coveredSpikes,0);assert.ok(report.stats.groundSpikeRun<=2);
 }
});

test('branch measurement resets at route merges; unavailable witnesses and old versions remain explicit',()=>{
 const positions=[0,1,2,3,4,5,6,7,8],trace=(ys,allCoins)=>({passed:true,allCoins,states:ys.map((y,i)=>({x:positions[i],y,tick:i}))});
 const lower=trace(positions.map(()=>0),false),upper=trace([0,2,2,2,0,2,2,2,0],true);
 const mocked=measureRouteSeparation({},[],[1],{replay:(_,ticks)=>ticks.length?upper:lower,physics:{tile:1,dx:1,hz:1}});
 assert.equal(mocked.spanTiles,2);assert.equal(mocked.intervals.length,2); // Not the sum, or first-to-last distance.
 assert.equal(measureRouteSeparation({},[],[],{replay:()=>({passed:false}),physics:PHYSICS}).spanTiles,null);
 assert.throws(()=>checkRequirements({...requirements,minBranchSpan:-1}));
 const old={version:2,name:'Old',length:70,objects:[]};
 assert.ok(facade.validate(old,{...requirements,minCoins:0}).errors.some(e=>e.code==='COIN_VERSION'));
 const level={...old,version:3,objects:[{type:'coin',x:8,y:8,w:1,h:1}]},report=validate(level,requirements,{maxStates:1});
 assert.equal(report.routeSeparation.status,'unavailable');assert.equal(report.rules.find(r=>r.code==='BRANCH_SPAN').passed,null);
});

test('branch-specific exact feedback reaches the generator but not the independent critic',async()=>{
 const level=await load('examples/coins/C01.json'),calls=[];
 const chat=async(messages,options)=>{calls.push(messages);return{raw:options.schema?JSON.stringify(level):'Нужна более длинная верхняя дорога.',promptVersion:'test-adapter'};};
 const result=await generateCoins({prompt:'Long optional upper route',requirements,previous:JSON.stringify(level),mode:'hybrid'},chat);
 assert.equal(calls.length,2);assert.ok(!JSON.stringify(calls[0]).includes('Exact proxy validator output:'));
 assert.ok(JSON.stringify(calls[1]).includes('BRANCH_SPAN'));assert.ok(JSON.stringify(calls[1]).includes('two-witness-height-span-v1'));
 assert.equal(result.promptVersion,'cube-json-v8-sustained-branches');assert.equal(result.report.passed,false);
 assert.deepEqual(result.level,level); // No procedural replacement of a failed generation.
});
