import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as v1 from '../public/engine.js';
import * as v2 from '../public/elevated-engine.js';
import * as geometry from '../public/geometry.js';
import {exportGdlvl,inspectExport,levelHash} from '../src/gd-export.js';
import {generateElevated,PROMPT_VERSION} from '../src/elevated-llm.js';
const empty={version:2,name:'Elevated',length:40,objects:[]};
const base={length:40,minSpikes:0,minBlocks:0,minDoubleSpikes:0,minJumps:0,safeStart:0,safeFinish:0};
const bridge={...empty,objects:[{type:'block',x:8,y:0,w:3,h:1},{type:'block',x:13,y:1,w:4,h:1},{type:'spike',x:13,y:0,w:6,h:1},{type:'block',x:19,y:1,w:4,h:1},{type:'spike',x:19,y:0,w:4,h:1}]};

test('vertical overlap and contact rules allow spikes on platforms and reject intersecting interiors',()=>{
  assert.deepEqual(v2.schemaErrors(bridge),[]);
  const above={...empty,objects:[{type:'block',x:8,y:2,w:3,h:1},{type:'spike',x:8,y:3,w:2,h:1}]};
  assert.deepEqual(v2.schemaErrors(above),[]);
  assert.ok(v2.schemaErrors({...above,objects:[above.objects[0],{...above.objects[1],y:2}]}).some(e=>e.code==='OVERLAP'));
  assert.ok(v2.schemaErrors({...empty,objects:[{type:'block',x:8,y:8,w:2,h:4}]}).some(e=>e.code==='BOUNDS'));
  assert.ok(v2.schemaErrors({...empty,objects:[{type:'spike_down',x:8,y:0,w:1,h:1}]}).length);
  assert.ok(v1.schemaErrors({...above,version:1}).length);
});
test('floating blocks can be walked under; undersides and sides collide, while top landing is safe',()=>{
  const level={...empty,objects:[{type:'block',x:6,y:2,w:4,h:1}]},T=v2.PHYSICS.tile;
  assert.equal(v2.replay(level,[]).passed,true);
  const state={...v2.initialState(),tick:70,x:70*v2.PHYSICS.dx,y:1.2*T,vy:0,grounded:false};
  assert.equal(v2.step(level,state).dead,true);
  const landing=v2.step(level,{...state,y:3.02*T,vy:-10000});
  assert.equal(landing.dead,false);assert.equal(landing.y,3*T);assert.equal(landing.grounded,true);assert.equal(landing.elevatedLandings,1);
  assert.equal(v2.step(level,landing).elevatedLandings,1);
});
test('upward and downward spikes collide on their actual vertical intervals',()=>{
  const level={...empty,objects:[{type:'spike_down',x:6,y:2,w:2,h:1}]},T=v2.PHYSICS.tile;
  assert.equal(v2.replay(level,[]).passed,true);
  const state={...v2.initialState(),tick:73,x:73*v2.PHYSICS.dx,y:1.5*T,vy:0,grounded:false};
  assert.equal(v2.step(level,state).dead,true);
  assert.equal(v2.step({...level,objects:[{...level.objects[0],type:'spike',y:3}]},state).dead,false);
});
test('required elevated landings are minimized over all successful paths, not counted decorative platforms',()=>{
  const decoration={...empty,objects:[{type:'block',x:8,y:3,w:4,h:1}]};
  const bypass=v2.validate(decoration,{...base,minRaisedBlocks:1,minElevatedLandings:1});
  assert.equal(bypass.playable,true);assert.equal(bypass.landingSearch.minElevatedLandings,0);assert.equal(bypass.passed,false);
  const report=v2.validate(bridge,{...base,minElevatedLandings:2});
  assert.equal(report.passed,true);assert.equal(report.landingSearch.minElevatedLandings,2);
  assert.equal(v2.replay(bridge,report.solver.jumpTicks).passed,true);
  assert.equal(v2.replay(bridge,report.landingSearch.jumpTicks).passed,true);
  const limited=v2.validate(bridge,{...base,minElevatedLandings:2},{maxStates:1});
  assert.equal(limited.rules.find(r=>r.code==='ELEVATED_LANDINGS').passed,null);
});
test('native export preserves elevation and rotates downward spikes; identity tracks y',()=>{
  const level={...empty,objects:[{type:'block',x:8,y:2,w:2,h:1},{type:'spike_down',x:16,y:3,w:1,h:1}]};
  const file=inspectExport(exportGdlvl(level));
  assert.deepEqual(file.objects[0],{'1':'1','2':'255','3':'75'});
  assert.deepEqual(file.objects[2],{'1':'8','2':'495','3':'105','6':'180'});
  assert.equal(file.binaryVersion,51);assert.match(file.xml,/<k>k14<\/k><f\/>/);
  assert.notEqual(levelHash(level),levelHash({...level,objects:level.objects.map(o=>({...o,y:o.y+1}))}));
  assert.equal(levelHash(level),levelHash({...level,objects:[...level.objects].reverse()}));
});
test('v1 dispatch retains old physics and rejects unmet v2 requests instead of silently dropping them',()=>{
  const level=v1.makeDemo(42);
  assert.deepEqual(geometry.solve(level),v1.solve(level));
  assert.deepEqual(geometry.validate(level),v1.validate(level));
  const report=geometry.validate(level,{...v1.DEFAULT_REQUIREMENTS,minRaisedBlocks:1});
  assert.equal(report.passed,false);assert.ok(report.errors.some(e=>e.code==='ELEVATED_VERSION'));
});
test('elevated generator uses the v2 schema and keeps validator output out of the critic',async()=>{
  const calls=[];
  const fake=async(messages,options)=>{calls.push({messages,options});return{raw:options.schema?JSON.stringify(bridge):'Проверьте места приземления.',elapsedMs:0,promptVersion:'adapter'};};
  const report=await generateElevated({prompt:'Platforms',requirements:{...base,minElevatedLandings:2},previous:JSON.stringify(empty),mode:'hybrid'},fake);
  assert.equal(calls.length,2);assert.equal(calls[1].options.schema.properties.version.const,2);
  assert.ok(!JSON.stringify(calls[0].messages).includes('Exact proxy validator output:'));
  assert.ok(JSON.stringify(calls[1].messages).includes('ELEVATED_LANDINGS'));
  assert.equal(report.report.passed,true);assert.equal(report.promptVersion,PROMPT_VERSION);
});

test('design limits count spike tiles below overhead blocks without confusing spikes on top',()=>{
  const level={...empty,objects:[{type:'block',x:8,y:1,w:3,h:1},{type:'spike',x:8,y:0,w:5,h:1},{type:'spike',x:9,y:2,w:1,h:1}]};
  const loose=v2.validate(level,base);
  assert.equal(loose.stats.coveredSpikes,3);assert.ok(loose.designWarnings.some(w=>w.code==='COVERED_SPIKES'));
  const strict=v2.validate(level,{...base,maxCoveredSpikes:0});
  assert.ok(strict.rules.some(r=>r.code==='COVERED_SPIKES'&&r.passed===false));
  const supported=v2.validate({...empty,objects:level.objects.filter(o=>o.y>0)},{...base,maxCoveredSpikes:0});
  assert.equal(supported.stats.coveredSpikes,0);assert.ok(supported.rules.find(r=>r.code==='COVERED_SPIKES').passed);
});
test('ground spike run limit merges split rows and stays separate from proxy reachability',()=>{
  const level={...empty,objects:[{type:'spike',x:8,y:0,w:2,h:1},{type:'spike',x:10,y:0,w:2,h:1},{type:'spike_down',x:20,y:2,w:5,h:1}]};
  const report=v2.validate(level,{...base,maxGroundSpikeRun:2});
  assert.equal(report.stats.groundSpikeRun,4);assert.equal(report.rules.find(r=>r.code==='GROUND_SPIKE_RUN').passed,false);
  assert.equal(v2.checkRequirements(base).maxCoveredSpikes,100);
  assert.equal(v2.checkRequirements(base).maxGroundSpikeRun,100);
  const zeroMinima={...v1.DEFAULT_REQUIREMENTS,...v2.EXTRA_REQUIREMENTS};
  assert.equal(geometry.validate(v1.makeDemo(42),zeroMinima).rules.some(r=>r.code==='ELEVATED_VERSION'),false);
  assert.equal(geometry.validate(v1.makeDemo(42),{...zeroMinima,maxCoveredSpikes:0}).passed,false);
});

test('revised route fixtures meet design limits; upper and lower witnesses survive on the same map',async()=>{
  const {checks}=JSON.parse(await readFile(new URL('../examples/routes/checks.json',import.meta.url),'utf8'));
  assert.equal(checks.length,3);
  for(const c of checks){
    const level=JSON.parse(await readFile(new URL(`../examples/routes/${c.id}.json`,import.meta.url),'utf8'));
    const report=v2.validate(level,c.requirements);
    assert.equal(report.passed,true,c.id);assert.equal(report.stats.coveredSpikes,0,c.id);assert.ok(report.stats.groundSpikeRun<=2,c.id);
    if(c.alternative){
      const upper=v2.replay(level,c.alternative.upperJumpTicks),lower=v2.replay(level,c.alternative.lowerJumpTicks);
      assert.equal(upper.passed,true);assert.equal(lower.passed,true);
      const at22=path=>path.states.find(s=>s.x/v2.PHYSICS.tile>=22).y/v2.PHYSICS.tile;
      assert.ok(at22(upper)>3);assert.equal(at22(lower),0);
    }
  }
});
