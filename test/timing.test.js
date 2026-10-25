import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {solve,replay} from '../public/geometry.js';
import {analyzeTiming,timingRule} from '../public/timing.js';
import {generateCoins} from '../src/coin-llm.js';
import {server} from '../src/server.js';
const fixture=async id=>JSON.parse(await readFile(new URL(`../examples/accuracy/${id}.json`,import.meta.url),'utf8'));

test('local window agrees with exhaustive single-jump replay and centered input stays valid',()=>{
 const level={version:2,name:'Window',length:40,objects:[{type:'spike',x:12,y:0,w:1,h:1}]},path=solve(level);
 const feasible=[];for(let t=0;t<200;t++)if(replay(level,[t]).passed)feasible.push(t);
 const report=analyzeTiming(level,path.jumpTicks,{replay,samples:32});
 assert.equal(report.status,'measured');assert.equal(report.windows[0].earliestTick,feasible[0]);assert.equal(report.windows[0].latestTick,feasible.at(-1));
 assert.equal(report.minimumWindowExact,true);assert.equal(report.minimumWindowMs,(feasible.at(-1)-feasible[0])*1000/120);
 assert.equal(replay(level,report.recommendedJumpTicks).passed,true);
 assert.ok(report.worstSymmetricMarginMs>0);
 assert.deepEqual(report,analyzeTiming(level,path.jumpTicks,{replay,samples:32}));
});
test('four-jump coin routes differ in timing sensitivity, not merely number of jumps',async()=>{
 const rows=[];
 for(const id of ['T01','T02','T03']){
  const level=await fixture(id),path=solve(level,{goal:'all-coins'}),report=analyzeTiming(level,path.jumpTicks,{replay,goal:'all-coins'});
  assert.equal(path.minJumps,4);assert.equal(replay(level,report.recommendedJumpTicks).allCoins,true);rows.push(report);
 }
 assert.deepEqual(rows.map(r=>r.profileObserved),['wide','balanced','tight']);
 assert.ok(rows[0].minimumWindowMs>rows[1].minimumWindowMs&&rows[1].minimumWindowMs>rows[2].minimumWindowMs);
 assert.ok(rows[2].jointJitter.survived<rows[0].jointJitter.survived);
 assert.equal(timingRule(rows[2],'wide').passed,false);assert.equal(timingRule(rows[2],'tight').passed,true);
});
test('finite scan bounds remain censored; ineffective inputs and zero-jump paths are explicit',()=>{
 const level={version:2,name:'Censor',length:40,objects:[{type:'spike',x:12,y:0,w:1,h:1}]},path=solve(level);
 const truncated=analyzeTiming(level,[116],{replay,maxShiftTicks:1,center:false,samples:0});
 assert.equal(truncated.windows[0].censored,true);assert.equal(truncated.minimumWindowExact,false);assert.equal(truncated.minimumWindowUpperMs,null);assert.equal(truncated.profileObserved,'uncertain');
 assert.equal(analyzeTiming(level,[...path.jumpTicks,9000],{replay}).status,'invalid-path');
 const empty={...level,objects:[]},automatic=analyzeTiming(empty,[],{replay});assert.equal(automatic.status,'auto');assert.equal(timingRule(automatic,'wide').passed,false);
});
test('generator receives timing target and exact mismatch only in validator feedback, no fallback',async()=>{
 const level=await fixture('T01'),requirements={length:52,minSpikes:0,minBlocks:0,minDoubleSpikes:0,minJumps:0,safeStart:0,safeFinish:0,minCoins:1};
 const calls=[],fake=async(messages,options)=>{calls.push({messages,options});return{raw:options.schema?JSON.stringify(level):'Уточните момент второго прыжка.',promptVersion:'adapter'};};
 const result=await generateCoins({prompt:'Coin route',requirements,previous:JSON.stringify(level),mode:'hybrid',timingProfile:'tight'},fake);
 assert.equal(calls.length,2);assert.equal(calls[1].options.schema.properties.version.const,3);
 assert.ok(!JSON.stringify(calls[0].messages).includes('Exact proxy validator output:'));
 assert.ok(JSON.stringify(calls[1].messages).includes('TIMING_PROFILE'));
 assert.ok(JSON.stringify(calls[1].messages).includes('Timing target: tight'));
 assert.equal(result.report.playable,true);assert.equal(result.report.passed,false);
 assert.equal(result.timingAnalysis.profileObserved,'wide');
});
test('HTTP timing endpoint preserves goal and identity and rejects invalid goal/version',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const origin=`http://127.0.0.1:${server.address().port}`,level=await fixture('T03');
  const post=body=>fetch(origin+'/api/timing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post({level,goal:'all-coins',profile:'tight'});assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.goal,'all-coins');assert.equal(data.analysis.profileObserved,'tight');assert.equal(data.rule.passed,true);assert.equal(data.levelHash.length,64);
  const old={version:2,name:'Old',length:40,objects:[]};assert.equal((await post({level:old,goal:'all-coins'})).status,400);
  assert.equal((await post({level,profile:'invalid'})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
