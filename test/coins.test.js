import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as engine from '../public/coin-engine.js';
import * as facade from '../public/geometry.js';
import {exportGdlvl,inspectExport,levelHash} from '../src/gd-export.js';
const coin=(x,y)=>({type:'coin',x,y,w:1,h:1});
const empty={version:3,name:'Coins',length:40,objects:[]};
const req={length:40,minSpikes:0,minBlocks:0,minDoubleSpikes:0,minJumps:0,safeStart:0,safeFinish:0,minCoins:1};
const branch=async()=>({...JSON.parse(await readFile(new URL('../examples/routes/R03.json',import.meta.url),'utf8')),version:3});

test('collectibles are bounded single tiles, outside solid interiors, and limited to three',()=>{
 assert.deepEqual(engine.schemaErrors({...empty,objects:[coin(8,1)]}),[]);
 assert.ok(engine.schemaErrors({...empty,objects:[{...coin(8,1),w:2}]}).some(e=>e.code==='SCHEMA'));
 assert.ok(engine.schemaErrors({...empty,objects:[coin(8,1),coin(8,1)]}).some(e=>e.code==='OVERLAP'));
 assert.ok(engine.schemaErrors({...empty,objects:[coin(8,1),{type:'block',x:8,y:1,w:2,h:1}]}).some(e=>e.code==='OVERLAP'));
 assert.ok(engine.schemaErrors({...empty,objects:[2,4,6,8].map(x=>coin(x,1))}).some(e=>e.code==='COIN_LIMIT'));
});
test('pickup sets a persistent bit, does not collide, and cannot be collected from the floor when high',()=>{
 const level={...empty,objects:[coin(8,0),coin(16,5)]};
 const trace=engine.replay(level,[]);
 assert.equal(trace.passed,true);assert.equal(trace.allCoins,false);assert.equal(trace.collectedCoins,1);assert.equal(trace.states.at(-1).coinMask,1);
 assert.ok(trace.states.filter(s=>s.x/engine.PHYSICS.tile>10).every(s=>(s.coinMask&1)===1));
});
test('upper reward requires a different complete path; collected mask survives path merging',async()=>{
 const level=await branch();level.objects.push(coin(20,3));
 const ordinary=engine.solve(level),reward=engine.solve(level,{goal:'all-coins'});
 assert.equal(ordinary.passed,true);assert.equal(ordinary.minJumps,6);assert.equal(ordinary.collectedCoins,0);
 assert.equal(reward.passed,true);assert.equal(reward.minJumps,8);assert.equal(reward.collectedCoins,1);
 assert.equal(engine.replay(level,reward.jumpTicks).allCoins,true);
 assert.ok(reward.coinMask>0);
 assert.equal(engine.validate(level,{...req,length:70,minCoinDetourJumps:2}).passed,true);
 assert.equal(engine.validate(level,{...req,length:70,minCoinDetourJumps:3}).passed,false);
});
test('individually reachable coins on exclusive branches are not mistaken for one all-coin run',async()=>{
 const base=await branch();
 assert.equal(engine.solve({...base,objects:[...base.objects,coin(20,0)]},{goal:'all-coins'}).passed,true);
 assert.equal(engine.solve({...base,objects:[...base.objects,coin(20,3)]},{goal:'all-coins'}).passed,true);
 const level={...base,objects:[...base.objects,coin(20,0),coin(20,3)]},report=engine.validate(level,{...req,length:70,minCoins:2});
 assert.equal(report.playable,true);assert.equal(report.coinsPlayable,false);assert.equal(report.passed,false);
 assert.ok(report.errors.some(e=>e.code==='NO_COIN_PATH'));
 const limited=engine.solve(level,{goal:'all-coins',maxStates:1});assert.equal(limited.status,'inconclusive');
});
test('native coins use user-coin ID, unique stable indices, declared count and no fake verification',()=>{
 const level={...empty,objects:[coin(16,3),coin(8,0)]},native=inspectExport(exportGdlvl(level));
 const coins=native.objects.filter(o=>o['1']==='1329');assert.equal(coins.length,2);
 assert.deepEqual(coins.map(o=>o['12']),['2','1']);assert.deepEqual(coins.map(o=>o['3']),['105','15']);
 assert.match(native.xml,/<k>k64<\/k><i>2<\/i>/);assert.match(native.xml,/<k>k65<\/k><f\/>/);assert.match(native.xml,/<k>k14<\/k><f\/>/);
 assert.equal(levelHash(level),levelHash({...level,objects:[...level.objects].reverse()}));
 assert.notEqual(levelHash(level),levelHash({...level,objects:[coin(17,3),coin(8,0)]}));
});
test('coin requirements cannot silently apply to v1/v2; v3 reports both goals separately',()=>{
 const report=facade.validate({...empty,version:2,objects:[]},req);assert.equal(report.passed,false);assert.ok(report.errors.some(e=>e.code==='COIN_VERSION'));
 const good=facade.validate({...empty,objects:[coin(8,0)]},req);assert.equal(good.passed,true);assert.equal(good.coinsPlayable,true);assert.equal(good.stats.coins,1);
 assert.equal(good.solver.goal,'finish');assert.equal(good.coinSolver.goal,'all-coins');
});
