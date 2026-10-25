import {PHYSICS,replay} from './engine.js';
const $=id=>document.getElementById(id),codes={NO_PATH:'no path',SPIKES:'missing spikes',BLOCKS:'missing blocks',DOUBLE_SPIKES:'double spikes',TRIPLE_SPIKES:'triple spikes',TALL_BLOCKS:'tall blocks',TIGHT_GAPS:'tight gaps',MIN_JUMPS:'too few required jumps'};
const reasons={'progress':'Accepted: measured progress.','preparation':'Accepted as preparation; no strict measured gain yet.','unchanged':'Rejected: the same plan was repeated.','lost-check':'Rejected: a previously passed check was lost.','shorter-prefix':'Rejected: search stopped earlier.','larger-deficit':'Rejected: the requirement deficit increased.','invalid-edit':'Rejected: invalid structure or geometry.'};
let data,example,selected=0,playing=false,frame=0,lastTime=0,scenes=[];
function badge(el,state){const report=state?.report;el.className='badge '+(report?.passed?'good':!report?.playable?'bad':'');el.textContent=report?.passed?'PASS':report?.errors?.map(e=>e.code).join(' · ')||'NO DATA';}
function makeScene(snapshot,canvas,overview){
  const level=snapshot?.level, ticks=snapshot?.jumpTicks||[];return{snapshot,canvas,overview,level,states:level?replay(level,ticks).states:[],index:0};
}
function fit(canvas){const ratio=Math.min(2,devicePixelRatio||1),w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return{ctx,w,h};}
function draw(scene){
  const {ctx,w,h}=fit(scene.canvas),level=scene.level;ctx.fillStyle='#111a25';ctx.fillRect(0,0,w,h);
  if(!level){ctx.fillStyle='#9aa8b9';ctx.font='12px system-ui';ctx.fillText('No compiled geometry',18,h/2);return;}
  const state=scene.states[Math.min(scene.index,scene.states.length-1)],tile=30,ground=h-39;
  const focus=playing||scene.index?state.x/PHYSICS.tile:scene.snapshot.focusX||0;
  const camera=Math.max(0,Math.min(level.length-w/tile+2,focus-w/tile*.3));
  ctx.strokeStyle='#1c2b3a';ctx.lineWidth=1;for(let x=Math.floor(camera);x<camera+w/tile+1;x++){const px=(x-camera)*tile;ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();}
  for(let y=ground;y>0;y-=tile){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  if(scene.snapshot.targetBounds){ctx.fillStyle='#6de0d50b';ctx.fillRect((scene.snapshot.targetBounds[0]-camera)*tile,0,(scene.snapshot.targetBounds[1]-scene.snapshot.targetBounds[0])*tile,ground);}
  if(scene.states.length){ctx.strokeStyle=scene.snapshot.pathType==='representative-failure'?'#f1bc7477':'#6de0d577';ctx.lineWidth=1.5;ctx.beginPath();scene.states.forEach((s,i)=>{if(i%3&&i!==scene.states.length-1)return;const x=(s.x/PHYSICS.tile-camera+.4)*tile,y=ground-(s.y/PHYSICS.tile+.45)*tile;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  ctx.fillStyle='#1d3440';ctx.fillRect(0,ground,w,h-ground);ctx.fillStyle='#557083';ctx.fillRect(0,ground,w,2);
  for(const o of level.objects){const x=(o.x-camera)*tile;if(x+o.w*tile<0||x>w)continue;
    if(o.type==='block'){ctx.fillStyle='#55728a';ctx.fillRect(x,ground-o.h*tile,o.w*tile,o.h*tile);ctx.strokeStyle='#a3c5d5';ctx.strokeRect(x+.8,ground-o.h*tile+.8,o.w*tile-1.6,o.h*tile-1.6);}
    else{ctx.fillStyle='#e6b17b';for(let k=0;k<o.w;k++){ctx.beginPath();ctx.moveTo(x+k*tile,ground);ctx.lineTo(x+(k+.5)*tile,ground-tile);ctx.lineTo(x+(k+1)*tile,ground);ctx.fill();}}
  }
  if(state){const x=(state.x/PHYSICS.tile-camera)*tile,y=ground-state.y/PHYSICS.tile*tile;ctx.fillStyle=state.dead?'#f29b9b':'#8ce9df';ctx.fillRect(x,y-.9*tile,.8*tile,.9*tile);ctx.fillStyle='#10272b';ctx.fillRect(x+5,y-20,4,4);ctx.fillRect(x+15,y-20,4,4);}
  ctx.fillStyle='#91a6b8';ctx.font='10px ui-monospace,monospace';for(let x=Math.ceil(camera/5)*5;x<camera+w/tile;x+=5)ctx.fillText(String(x),(x-camera)*tile+3,h-14);
  const mini=fit(scene.overview),scale=(mini.w-20)/level.length,base=mini.h-13;mini.ctx.fillStyle='#101722';mini.ctx.fillRect(0,0,mini.w,mini.h);
  if(scene.snapshot.targetBounds){mini.ctx.fillStyle='#6de0d525';mini.ctx.fillRect(10+scene.snapshot.targetBounds[0]*scale,0,(scene.snapshot.targetBounds[1]-scene.snapshot.targetBounds[0])*scale,mini.h);}
  for(const o of level.objects){mini.ctx.fillStyle=o.type==='block'?'#789bb5':'#e6b17b';mini.ctx.fillRect(10+o.x*scale,base-o.h*9,Math.max(1,o.w*scale),o.h*9);}
  mini.ctx.strokeStyle='#6de0d5';mini.ctx.strokeRect(10+camera*scale,4,Math.min(mini.w-20,(w/tile)*scale),mini.h-8);
}
function values(report,key){return key==='minJumps'?report?.solver?.minJumps:report?.stats?.[key];}
function requirements(before,after){const fields=[['Spikes','minSpikes','spikes'],['Block groups','minBlocks','blocks'],['Double-spike groups','minDoubleSpikes','doubleSpikes'],['Triple-spike groups','minTripleSpikes','tripleSpikes'],['Tall blocks','minTallBlocks','tallBlocks'],['Gaps of 1–2 tiles','minTightGaps','tightGaps'],['Required jumps','minJumps','minJumps']];$('requirements').replaceChildren();for(const[label,key,stat]of fields){const tr=document.createElement('tr');for(const text of [label,example.requirements[key]]){const td=document.createElement('td');td.textContent=text;tr.append(td);}for(const r of [before,after]){const v=values(r,stat),td=document.createElement('td');td.textContent=v??'—';td.className=v==null?'unknown':v>=example.requirements[key]?'pass':'fail';tr.append(td);}$('requirements').append(tr);}}
function caption(s){if(!s.level)return'The response could not be compiled.';if(s.report.passed)return`All requirements passed. Minimum ${s.report.solver.minJumps} jumps.`;if(s.report.playable)return'A path was found; numeric requirements still fail.';if(s.pathType==='representative-failure')return`Search exhausted the frontier near x≈${s.report.solver.maxX?.toFixed(1)}. One reproducible failed trajectory is shown.`;return'No complete path has been confirmed.';}
function showStep(index){playing=false;frame=0;selected=index;$('play').textContent='▶ Replay both';const snap=example.snapshots[index],before=example.snapshots[0];
  scenes=[makeScene(before,$('before'),$('before-overview')),makeScene(snap,$('after'),$('after-overview'))];
  for(const scene of scenes)scene.snapshot={...scene.snapshot,focusX:snap.targetBounds?snap.focusX:before.focusX,targetBounds:snap.targetBounds};
  $('after-title').textContent=index===0?'Initial plan':`Proposal ${index}`;badge($('before-status'),before);badge($('after-status'),snap);
  $('before-caption').textContent=caption(before);$('after-caption').textContent=caption(snap);requirements(before.report,snap.report);
  $('decision').textContent=index===0?'Initial model response, before any repairs.':reasons[snap.decision?.reason]||'Controller decision: '+(snap.decision?.reason||'unknown');
  $('decision').classList.toggle('rejected',index>0&&!snap.decision?.accepted);
  const d=snap.diagnostic?.current;
  $('feedback').textContent=index===0?'Qwen initially receives only the brief and original requirements.':d?[...d.deficits.map(x=>`${({spikes:'Spikes',blocks:'Blocks',doubleSpikes:'Double-spike groups',tripleSpikes:'Triple-spike groups',tallBlocks:'Tall blocks',tightGaps:'Tight gaps'})[x.counter]}: ${x.actual} of ${x.required}, missing ${x.missing}.`),...(d.failure?[`Search stopped near x=${d.failure.x?.toFixed(1)??'?'}, section ${d.failure.section??'?'}.`]:[]),...(d.errors.includes('MIN_JUMPS')?[`Required jumps: ${d.jumps.actual??'—'} of ${d.jumps.required}.`]:[])].join('\n')||'Measured diagnostics were supplied; exact recorded data is below.':'No detailed diagnostic was supplied in this condition.';
  $('diagnostic').textContent=snap.diagnostic?JSON.stringify(snap.diagnostic,null,2):'No detailed report.';$('raw').textContent=snap.raw;
  [...$('steps').children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  $('play').disabled=scenes.every(s=>!s.level);$('play-status').textContent='Fixed approximate physics';scenes.forEach(draw);
}
function selectExample(id){example=data.examples.find(e=>e.id===id);$('example-title').textContent=`${example.id} · ${example.finalJumps} required jumps`;$('source').textContent=`${example.caseId} · seed ${example.seed} · ${example.scope==='local'?'one-section repair':'whole-plan repair'} · ${example.condition==='feedback'?'measured feedback':'no-report control'}`;$('model').textContent=example.model+' · '+example.modelDigest.slice(0,8);const count=example.snapshots.length-1;$('call-count').textContent=`1 initial draft · ${count} repair proposals`;
  $('steps').replaceChildren();example.snapshots.forEach((s,i)=>{const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed','false');const title=document.createElement('span');title.textContent=i===0?'Initial':`Repair ${i}${s.target==null?'':` · section ${s.target+1}`}`;const sub=document.createElement('small');sub.textContent=s.report.passed?'PASS':s.report.errors.map(e=>e.code).join(' · ');button.append(title,sub);button.addEventListener('click',()=>showStep(i));$('steps').append(button);});
  $('download').href=example.download;[...$('examples').children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)));showStep(example.snapshots.length-1);
}
function animate(now){if(playing){const dt=Math.min(.1,(now-lastTime)/1000);frame+=dt*PHYSICS.hz;for(const scene of scenes)scene.index=Math.min(Math.floor(frame),Math.max(0,scene.states.length-1));scenes.forEach(draw);if(scenes.every(s=>s.index>=s.states.length-1)){playing=false;$('play').textContent='▶ Replay again';$('play-status').textContent='Replay complete';}}lastTime=now;requestAnimationFrame(animate);}
$('play').addEventListener('click',()=>{playing=!playing;if(playing){if(scenes.every(s=>s.index>=s.states.length-1))frame=0;lastTime=performance.now();}$('play').textContent=playing?'Ⅱ Pause':'▶ Resume';});$('reset').addEventListener('click',()=>showStep(selected));
new ResizeObserver(()=>scenes.forEach(draw)).observe(document.querySelector('.stage'));
async function load(){try{const response=await fetch('/repair-demo-data.json');if(!response.ok)throw new Error(response.status===404?'Recorded chains are not available yet.':'Could not load the recorded data.');data=await response.json();if(!data.recorded||!data.examples?.length)throw new Error('No recorded example is available.');
  $('notice').hidden=true;$('content').hidden=false;
  for(const e of data.examples){const button=document.createElement('button');button.type='button';button.dataset.id=e.id;button.textContent=`${e.id} · ${e.model.includes(':4b')?'4B':'9B'} · ${e.finalJumps} jumps`;button.addEventListener('click',()=>selectExample(e.id));$('examples').append(button);}
  const labels={whole_none:'Whole plan · no diagnostic report',whole_feedback:'Whole plan · with feedback',local_none:'One section · no diagnostic report',local_feedback:'One section · with feedback',whole_random:'Random whole-plan repair',local_random:'Random one-section repair'};
  for(const[arm,label]of Object.entries(labels)){const tr=document.createElement('tr'),name=document.createElement('td');name.textContent=label;tr.append(name);for(const model of ['qwen3.5:4b','qwen3.5:9b-q4_K_M']){const cell=data.summary.find(s=>s.model===model&&s.arm===arm),td=document.createElement('td');td.textContent=cell?`${cell.successes}/${cell.completed}`:'pending';tr.append(td);}$('study-results').append(tr);}
  $('study-count').textContent=`${data.completed} / ${data.planned} chains`;$('study-note').textContent='12 numeric briefs in six known families, two seeds each. All conditions share an initial draft within each model/case and the acceptance guard. Random controls repair the same Qwen draft. The 9B result is secondary; the primary 4B comparison was inconclusive.';
  selectExample(data.examples[0].id);requestAnimationFrame(animate);
}catch(error){$('notice').hidden=false;$('notice').textContent=error.message;}}
load();
