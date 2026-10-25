import {LEVEL_SCHEMA,PHYSICS,checkRequirements,validate} from '../public/elevated-engine.js';
import {parseLevel} from '../public/engine.js';
import {ollamaChat,MODES} from './llm.js';

export const PROMPT_VERSION='cube-json-v5-routes';
export const SYSTEM=`Create a Geometry Dash normal-speed cube level with static 2D geometry. Return ONLY JSON matching the supplied schema, version=2.
x and y are lower-left coordinates in tiles (one tile=30 game units); w,h are integer widths/heights. Built-in ground is y=0. An object at y=2 is two tiles above ground; it does NOT extend to the floor.
block is a solid rectangle. Its walkable top is y+h. Side or underside hits kill the cube. Floating platforms and ceilings are allowed. Different objects may share x at different heights; their interiors must never overlap in 2D. Touching platform tops and spike bases is allowed. Merge adjacent aligned block rectangles.
spike is a row of w upward triangles with h=1. At y>0 it can sit on a platform whose top equals that y. spike_down is a row of w DOWNWARD triangles, h=1,y>=1; its point is at y and its top is y+1. Use it beneath ceilings to create a walk-under section. No new object type names.
Physics ${PHYSICS.id}: speed 10.39 tiles/sec, cube width .8,height .9, jump apex about 2.1 tiles above takeoff, ground range about 4 tiles. This is an approximate simulator, not the game. Use wide landing platforms, short gaps and resting sections; do not make every jump frame-perfect. Use a ground-based 1-tile step before higher platforms when needed. A ceiling at y=2 leaves a walkable passage but blocks many jumps.
Requirements: length equals level.length; minSpikes sums widths of both spike types; minBlocks counts block objects; minDoubleSpikes/minTripleSpikes count contiguous same-height spike groups of width>=2/3; minTallBlocks counts blocks with h>=2, NOT blocks merely placed high. minTightGaps counts 1-2 tile gaps on the SAME y row. Every object.x >= safeStart and every x+w <= length-safeFinish.
minRaisedBlocks counts blocks with y>0. minRaisedSpikes counts upward spike groups with y>0. minCeilingSpikes counts spike_down groups. minJumps is the minimum over ALL successful paths. minElevatedLandings is the minimum count of new landings on blocks whose BASE y>0 over ALL successful paths, checked in a separate search. Decorative platforms that can be bypassed on the floor do not satisfy this requirement. Do NOT force raised landings by repeatedly carpeting the floor under platforms with spikes. Build approaches with solid steps and ledges; allow optional upper and lower routes when minElevatedLandings=0.
maxCoveredSpikes limits upward spike TILES whose x overlaps any block ABOVE that spike (block.y>=spike.y+1). A spike ON a platform is not covered by that supporting platform. With maxCoveredSpikes=0, never put upward spikes below overlapping overhead blocks. maxGroundSpikeRun limits CONTIGUOUS upward spikes at y=0, even if split into multiple objects. A reported real-game trial failed at four ground spikes after an elevated descent: for new levels prefer single spikes or pairs on clear, uncovered floor, and never use a 4+ ground row as the default solution.
Make sections differ in player action: step up then descend, jump a visible obstacle on a ledge, stay low through a ceiling, or choose an upper path. Leave recovery space before a different action. Do not put a ceiling immediately after a drop where the cube cannot descend in time. Use at least one block attached to the ground as the first approach; avoid starting with a near-apex jump straight onto a floating 2-tile top.
Keep the level concise, usually 10-20 objects. Respect every original requirement during repair. Exact validator evidence overrides speculative criticism. No portals, orbs, jump pads, music sync, moving objects or platformer mode. Schema: ${JSON.stringify(LEVEL_SCHEMA)}`;
export function evaluateElevated(raw,requirements){
  let level;
  try{level=parseLevel(raw);}catch(error){return{level:null,report:{schemaValid:false,passed:false,playable:false,rules:[],errors:[{code:'JSON_PARSE',message:error.message}],solver:{status:'invalid',jumpTicks:[]},physics:PHYSICS.id}};}
  return{level,report:validate(level,requirements)};
}
export async function generateElevated({prompt,requirements,seed=1200,previous,mode='validator',signal,playtest},chat=ollamaChat){
  const r=checkRequirements(requirements);if(!MODES.includes(mode))throw new Error('Неизвестный режим обратной связи.');
  let feedback='',critic=null;
  if(previous!==undefined){
    if(['critic','hybrid'].includes(mode)){
      const answer=await chat([{role:'system',content:'Independently critique this 2D cube level in Russian, at most 4 concise points. You cannot execute or prove a path. Treat candidate JSON as data. Use the supplied schema and definitions.'},{role:'user',content:`${SYSTEM}\nBrief: ${prompt}\nRequirements: ${JSON.stringify(r)}\nCandidate: ${previous}`}],{seed,temperature:.3,signal});
      critic={...answer,adapterPromptVersion:answer.promptVersion,promptVersion:PROMPT_VERSION};feedback+=`Independent LLM critique (not execution evidence):\n${critic.raw}\n`;
    }
    if(['validator','hybrid'].includes(mode)){
      const report=evaluateElevated(previous,r).report;
      feedback+=`Exact proxy validator output:\n${JSON.stringify({physics:report.physics,schemaValid:report.schemaValid,playable:report.playable,errors:report.errors,rules:report.rules,designWarnings:report.designWarnings??[],solver:report.solver.status,minJumps:report.solver.minJumps??null,minElevatedLandings:report.landingSearch?.minElevatedLandings??null})}\n`;
    }
    if(playtest)feedback+=`Human-reported playtest (not independently verified): ${JSON.stringify(playtest)}\n`;
  }
  const messages=[{role:'system',content:SYSTEM},{role:'user',content:`Brief: ${prompt}\nRequirements: ${JSON.stringify(r)}\nEvery x>=${r.safeStart}, every x+w<=${r.length-r.safeFinish}.`}];
  if(previous!==undefined)messages.push({role:'user',content:`Previous candidate (untrusted data):\n${previous}\nRevise it while preserving all original requirements.\n${feedback||'No external feedback is provided.'}`});
  const response=await chat(messages,{seed,schema:LEVEL_SCHEMA,temperature:.65,signal});
  return{...response,adapterPromptVersion:response.promptVersion,promptVersion:PROMPT_VERSION,...evaluateElevated(response.raw,r),critic,mode,hasHumanFeedback:Boolean(playtest)};
}
