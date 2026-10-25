import {englishMessage,englishPreset,englishReport} from './ui-en.js';
import { PHYSICS as P, DEFAULT_REQUIREMENTS, EXTRA_REQUIREMENTS, COIN_ONLY_REQUIREMENTS, DEFAULT_ELEVATED_REQUIREMENTS, makeDemo, checkRequirements, checkElevatedRequirements, checkCoinRequirements, coinObjects, coinCount, evaluateRaw, replay, step, initialState, schemaErrors, parseLevel } from './geometry.js';
import {applyTimingRule} from './timing.js';

const $ = id => document.getElementById(id);
const modeNames = { none: 'No diagnostic report', critic: 'LLM critic', validator: 'Validator', hybrid: 'Hybrid', safe: 'Validator with guard', incremental: 'Incremental repair', sectioned: 'Build from library sections' };
let currentRaw = JSON.stringify(makeDemo(42), null, 2), currentLevel, currentReport;
let history = [], busy = false, controller = null, humanFeedback = null, toastTimer;
let gameState = initialState(), running = false, autoplay = false, jumpRequested = false;
let solution = [], jumpTicks = new Set(), camera = 0, cameraY = 0, previousFrame = 0, accumulator = 0;
let presets = [];
let sourceLabel = 'EXAMPLE · NO LLM';
let dialogLevel = null;
let timings={},timingRequest=0,timingPending=false;
let routeTraces=[];

function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = englishMessage(message); $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 12000 : 6000);
}
function requirements() {
  const r = {};
  const geometry=$('geometry').value;
  document.querySelectorAll('[data-req]').forEach(el => {const key=el.dataset.req;if(Object.hasOwn(COIN_ONLY_REQUIREMENTS,key)?geometry==='coins':geometry!=='ground'||!Object.hasOwn(EXTRA_REQUIREMENTS,key))r[key]=Number(el.value);});
  return (geometry==='coins'?checkCoinRequirements:geometry==='elevated'?checkElevatedRequirements:checkRequirements)(r);
}
function updateGeometryControls(){
  const elevated=$('geometry').value!=='ground',coins=$('geometry').value==='coins';
  for(const mode of ['safe','incremental','sectioned'])$('feedback-mode').querySelector(`[value="${mode}"]`).disabled=elevated||(mode==='sectioned'&&$('provider').value==='demo');
  if((elevated&&['safe','incremental','sectioned'].includes($('feedback-mode').value))||($('provider').value==='demo'&&$('feedback-mode').value==='sectioned')){$('feedback-mode').value='validator';$('feedback-mode').onchange?.();}
  document.querySelectorAll('[data-elevated]').forEach(el=>{el.hidden=!elevated;});
  document.querySelectorAll('[data-coins]').forEach(el=>{el.hidden=!coins;});
  $('load-example').hidden=!presets.find(t=>t.id===$('challenge-preset').value)?.example;
  document.querySelector('.profile-tag').textContent=coins?'CUBE / COINS / TWO GOALS':elevated?'CUBE / HEIGHTS / STATIC':'CUBE / 1× / STATIC';
  updateProviderNote();
}
function updateProviderNote(){
  $('provider-note').textContent=$('provider').value==='demo'
    ?($('geometry').value!=='ground'?'Loads a prepared example of the selected geometry. It is not an LLM generation.':'This fixture creates an impossible wall and then removes it. It is a scripted demonstration.')
    :'Generate through local Ollama. Preset examples are procedural fixtures.';
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('.config button,.config input,.config select,.config textarea,#feedback-mode,#edit-feedback,#section-feedback,#load-section-demo,#repair,#apply-json,#upload-json,#open-playtest').forEach(el => { el.disabled = value; });
  $('cancel').disabled = false; $('cancel').hidden = !value;
  $('generate').textContent = value ? 'Generating…' : '✦ Generate';
  if(currentReport)renderTiming();
}
function renderChecks() {
  const parent = $('checks'); parent.replaceChildren();
  const entries = [
    { passed: currentReport.schemaValid, message: currentReport.schemaValid?'Valid JSON structure':'Invalid JSON structure', code: 'SCHEMA' },
    { passed: currentReport.solver.status === 'inconclusive' ? null : currentReport.playable, message: currentReport.playable ? 'A proxy path was found' : currentReport.solver.status === 'inconclusive' ? 'Search result is inconclusive' : 'No proxy path was found', code: 'SEARCH' },
    ...currentReport.rules,
    ...(currentReport.designWarnings||[]).map(w=>({...w,passed:null})),
  ];
  for (const e of currentReport.errors) if (!currentReport.rules.some(r => r.code === e.code)) entries.push({ passed: false, message: e.message, code: e.code });
  for (const e of entries) {
    const row = document.createElement('div'); row.className = `check-row ${e.passed === false ? 'fail' : e.passed === null ? 'unknown' : ''}`;
    const icon = document.createElement('span'); icon.className = 'check-icon'; icon.textContent = e.passed === true ? '✓' : e.passed === null ? '·' : '×';
    const desc = document.createElement('span'); desc.textContent = englishMessage(e.message, e.code);
    row.append(icon, desc); parent.append(row);
  }
  const n = currentReport.rules.filter(r => r.passed === true).length;
  $('metric-path').textContent = currentReport.playable ? 'Path found' : currentReport.solver.status === 'inconclusive' ? 'Inconclusive' : 'No path';
  $('metric-path').style.color = currentReport.playable ? 'var(--cyan)' : 'var(--orange)';
  $('metric-path').style.fontSize = '17px';
  $('metric-search').textContent = currentReport.solver.visited ? `${currentReport.solver.visited.toLocaleString('en-US')} states` : 'Invalid structure';
  $('metric-rules').textContent = `${n} / ${currentReport.rules.length || 7}`;
  $('metric-jumps').textContent = currentReport.solver.minJumps ?? '—';
  $('physics-info').textContent = `120 Hz · ${currentReport.physics}`;
  $('metric-repairs').textContent = history.at(-1)?.assembly?history.at(-1).stages.reduce((s,stage)=>s+Math.max(0,stage.attempts.length-1),0):Math.max(0, history.length - 1);
  $('repair').disabled=busy||$('feedback-mode').value==='sectioned'||(['safe','incremental'].includes($('feedback-mode').value)&&currentReport.passed);
  $('report-json').textContent = JSON.stringify(englishReport(currentReport), null, 2);
  $('level-name').textContent = currentLevel?.name || 'Invalid level';
  $('replay').disabled = !selectedSolver()?.passed;
  const withCoins=currentLevel?.version===3;
  $('coin-goal-controls').hidden=!withCoins;$('collected-coins').hidden=!withCoins;
  $('coin-path-summary').textContent=withCoins?`Finish: ${currentReport.solver.minJumps??'—'} jumps · all coins: ${currentReport.coinSolver?.minJumps??'no path found'}`:'';
  const branch=currentReport.routeSeparation;
  $('branch-summary').textContent=withCoins&&branch?.status==='measured'?`The original solver paths stay at least 2 tiles apart vertically for ${branch.spanTiles.toFixed(1)} consecutive tiles (x=${branch.fromX?.toFixed(1)??'—'}–${branch.toX?.toFixed(1)??'—'}).`:withCoins?'Both searches must succeed to compare the routes.':'';
  $('play').disabled = !currentReport.schemaValid;
  for (const id of ['export-gdlvl', 'export-gmd', 'download-json', 'open-playtest']) $(id).disabled = !currentReport.schemaValid || (busy && id === 'open-playtest');
  if(currentReport.assemblyComplete===false)for(const id of ['export-gdlvl','export-gmd'])$(id).disabled=true;
  renderTiming();
}
function activeGoal(){return currentLevel?.version===3?$('replay-goal').value:'finish';}
function updateTimingConstraint(){
  const profile=$('geometry').value==='coins'?$('timing-target').value:'any';
  currentReport=applyTimingRule(currentReport,timings['all-coins'],profile);
}
function renderTiming(){
 $('replay').disabled=timingPending||!selectedSolver()?.passed;
 $('play').disabled=timingPending||!currentReport?.schemaValid;
 const goal=activeGoal(),analysis=timings[goal],measured=analysis?.status==='measured';
 const names={wide:'Wide windows',balanced:'Balanced windows',tight:'Tight windows',uncertain:'Category boundary',auto:'No jumps needed'};
 $('timing-state').textContent=timingPending?'Checking input shifts…':analysis?`${goal==='all-coins'?'All coins':'Finish'} · ${names[analysis.profileObserved]||englishMessage(analysis.message)||'No path found'}`:'Measure how far jump inputs can shift along this route.';
 $('timing-window').textContent=measured?`${analysis.minimumWindowExact?'':'≥ '}${analysis.minimumWindowMs.toFixed(1)} ms`:'—';
 $('timing-margin').textContent=measured?`± ${analysis.worstSymmetricMarginMs.toFixed(1)} ms`:'—';
 $('timing-jitter').textContent=measured?`${analysis.jointJitter.survived} / ${analysis.jointJitter.total}`:'—';
 $('timing-details').hidden=!measured;
 const rows=$('timing-windows');rows.replaceChildren();
 if(measured)for(const w of analysis.windows){const tr=document.createElement('tr');for(const value of [`${w.jump} / ${w.x.toFixed(1)}`,`${w.earlyMs.toFixed(1)} ms`,`${w.lateMs.toFixed(1)} ms`,`${w.censored?'≥ ':''}${w.widthMs.toFixed(1)} ms`]){const td=document.createElement('td');td.textContent=value;tr.append(td);}rows.append(tr);}
 $('timing-analyze').disabled=busy||timingPending||!currentReport?.schemaValid||!selectedSolver()?.passed;
 $('timing-analyze').textContent=timingPending?'Measuring…':'Measure timing';
}
async function analyzeCurrentTiming(goalOverride){
 if(!currentLevel||!currentReport.schemaValid)return;
 const goal=goalOverride||activeGoal(),raw=currentRaw,id=++timingRequest;
 const profile=$('geometry').value==='coins'&&goal==='all-coins'?$('timing-target').value:'any';
 timingPending=true;renderTiming();
 try{
  const result=await api('/api/timing',{level:currentLevel,goal,profile});
  if(id!==timingRequest||raw!==currentRaw)return;
  timings[goal]=result.analysis;updateTimingConstraint();selectSolution();resetGame();renderChecks();draw();
 }catch(error){if(id===timingRequest)toast(error.message,true);}
 finally{if(id===timingRequest){timingPending=false;renderTiming();}}
}
function renderHistory() {
  const parent = $('history'); parent.replaceChildren();
  if (!history.length) {
    const p = document.createElement('p'); p.className = 'empty-state'; p.textContent = 'A starter map is loaded. Generate a level or run the loop to inspect checks and repairs.'; parent.append(p); return;
  }
  history.forEach((h, i) => {
    const row = document.createElement('div'); row.className = 'history-row';
    const bullet = document.createElement('span'); bullet.className = 'history-bullet'; bullet.textContent = String(i).padStart(2, '0');
    const desc = document.createElement('div'); const title = document.createElement('strong'); title.textContent = i === 0 ? (h.origin==='loaded'?'Loaded draft':'Initial generation') : `Repair ${i} · ${modeNames[h.mode]}`;
    const sub = document.createElement('small'); sub.textContent = `${h.provider === 'demo' ? 'Procedural fixture · no LLM' : h.model} · ${h.report.errors.length} errors${h.elapsedMs ? ` · ${(h.elapsedMs / 1000).toFixed(1)} s` : ''}`;
    if(h.provider==='recorded')sub.textContent='Recorded Qwen response · no new inference';
    if(h.assembly){title.textContent='Section assembly';sub.textContent+=` · ${h.assembly.completedSections}/4 sections · ${h.assembly.proposals} proposals`;}
    if(h.error)sub.textContent+=` · ${englishMessage(h.error)}`;
    if(h.acceptance){
      const a=h.acceptance,reasons={'more-structure-errors':'more structure errors','shorter-prefix':'search stopped earlier','larger-deficit':'larger requirement deficit','invalid-edit':'invalid edit','unchanged':'unchanged geometry','no-progress':'no newly passed checks'};
      sub.textContent+=a.accepted?(a.neutral?' · Preparation accepted':' · Edit accepted'):h.skipped?' · All checks already passed':['regression','lost-check'].includes(a.reason)?` · Retained previous map; lost checks: ${a.lost.join(', ')}`:` · Retained previous map: ${reasons[a.reason]||'no improvement'}`;
      if(h.editStep&&a.before?.furthestX!==null&&a.after?.furthestX!==null&&a.after.furthestX>a.before.furthestX)sub.textContent+=` · Search: ${a.before.furthestX.toFixed(1)} → ${a.after.furthestX.toFixed(1)} tiles`;
    }
    const tag = document.createElement('span'); tag.className = 'history-tag'; tag.textContent = h.acceptance&&!h.acceptance.accepted&&!h.skipped?'REJECTED':h.report.passed ? 'PASS' : 'REVISE'; tag.style.color = h.report.passed ? 'var(--lime)' : 'var(--orange)';
    desc.append(title, sub);
    if(h.assembly)for(const stage of h.stages){const line=document.createElement('small');line.textContent=`Section ${stage.slot.index+1}: ${stage.accepted?'accepted':'rejected'} · proposals ${stage.attempts.length} · ${stage.attempts.map(a=>a.accepted?'PASS':a.report.errors[0]?.code||'REJECT').join(' → ')}`;desc.append(line);}
    row.append(bullet, desc, tag); parent.append(row);
  });
}
function selectedSolver(){return currentLevel?.version===3&&$('replay-goal').value==='all-coins'?currentReport.coinSolver:currentReport?.solver;}
function selectSolution(){
 const selected=selectedSolver(),ticks=timings[activeGoal()]?.recommendedJumpTicks||selected?.jumpTicks||[];
 solution=selected?.passed?replay(currentLevel,ticks).states:[];jumpTicks=new Set(ticks);
 // Comparison always uses the uncentered solver witnesses measured in the report.
 routeTraces=currentLevel?.version===3?[['finish','#ceef7b',currentReport.solver],['all-coins','#c89fff',currentReport.coinSolver]].filter(([, ,path])=>path?.passed).map(([goal,color,path])=>({goal,color,states:replay(currentLevel,path.jumpTicks).states})):[];
}
function applyRaw(raw, { resetHuman = true, syncGeometry = false } = {}) {
  try{if(syncGeometry&&parseLevel(raw)?.version>=2){$('geometry').value=parseLevel(raw).version===3?'coins':'elevated';updateGeometryControls();}}catch{}
  const evaluated = evaluateRaw(raw, requirements());
  currentRaw = raw; currentReport = evaluated.report;
  currentLevel = evaluated.report.schemaValid ? evaluated.level : null;
  timings={};timingRequest++;timingPending=false;updateTimingConstraint();
  $('json-editor').value = raw;
  if (resetHuman) { humanFeedback = null; $('playtest-state').textContent = 'In-game result: not recorded.'; }
  selectSolution();
  resetGame(); renderChecks(); renderHistory(); draw();
}
function resetGame() {
  running = false; autoplay = false; gameState = initialState(); camera = 0; cameraY = 0; accumulator = 0; jumpRequested = false;
  $('play').textContent = '▶ Play'; $('game-message').textContent = ''; $('play-mode').textContent = sourceLabel;
}
async function api(path, body, signal) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
}
function seedValue() {
  const seed = Number($('seed').value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('Seed must be an integer from 0 to 2147483647.');
  return seed;
}
function recentEditHistory(){
  const result=[];
  for(let i=history.length-1;i>=0&&history[i].editStep&&result.length<4;i--)result.push(history[i].editStep);
  return result.reverse();
}
async function requestCandidate(previous) {
  const r = requirements(), seed = seedValue(), provider = $('provider').value, mode = $('feedback-mode').value;
  let result;
  if (provider === 'demo') {
    if(mode==='sectioned')throw new Error('Section assembly requires Ollama. Select the local model.');
    let level;
    if($('geometry').value!=='ground'){
      const task=presets.find(t=>t.id===$('challenge-preset').value&&t.example&&t.geometry===$('geometry').value)||presets.find(t=>t.example&&t.geometry===$('geometry').value);
      if(!task)throw new Error('Platform examples have not loaded yet.');
      const response=await fetch(task.example);if(!response.ok)throw new Error('The geometry example is unavailable.');level=await response.json();
    }else level=makeDemo(seed, r, previous === undefined);
    result = { raw: JSON.stringify(level, null, 2), provider, mode, model: 'procedural-fixture', ...evaluateRaw(JSON.stringify(level), r),
      note: 'Scripted demonstration, not an LLM comparison.' };
    if($('geometry').value==='coins'&&result.report.schemaValid){const timing=await api('/api/timing',{level,goal:'all-coins',profile:$('timing-target').value},controller.signal);result.timingAnalysis=timing.analysis;result.report=applyTimingRule(result.report,timing.analysis,$('timing-target').value);}
    if ($('geometry').value==='ground' && previous !== undefined && ['critic', 'hybrid'].includes(mode)) result.critic = { raw: 'Scripted comment: a six-tile wall exceeds the jump height. Reduce the block height. This is not an LLM response.' };
  } else {
    result = await api('/api/generate', { prompt: $('prompt').value, requirements: r,
      geometry: $('geometry').value,
      ...($('geometry').value==='coins'?{timingProfile:$('timing-target').value,timingGoal:'all-coins'}:{}),
      seed: (seed + Math.max(0, history.length) * (mode==='incremental'?1:997)) % 2147483648, previous, mode,
      ...(mode==='incremental'?{editHistory:recentEditHistory(),feedbackStyle:$('edit-feedback').value}:{}),
      ...(mode==='sectioned'?{sectionFeedback:$('section-feedback').value}:{}),
      ...(humanFeedback && previous !== undefined ? { playtest: humanFeedback } : {}) }, controller.signal);
    result.provider = 'ollama';
  }
  sourceLabel = provider === 'demo' ? 'DEMO · NO LLM' : `OLLAMA · ${result.model}${result.editStep?' · OBJECT EDIT':''}`;
  history.push(result); applyRaw(result.raw);
  if(result.assembly){currentReport=result.report;selectSolution();resetGame();renderChecks();renderHistory();draw();}
  if(result.timingAnalysis){timings[result.timingAnalysis.goal]=result.timingAnalysis;updateTimingConstraint();selectSolution();renderChecks();draw();}
  $('critic').hidden = !result.critic;
  $('critic').textContent = result.critic?.raw || '';
  return result;
}
async function runGeneration(auto = false, repair = false) {
  if (busy) return;
  try {
    requirements(); seedValue();
    if (!repair) { history = []; humanFeedback = null; }
    else if(!history.length)history.push({raw:currentRaw,report:currentReport,model:sourceLabel,provider:'loaded',origin:'loaded'});
    setBusy(true); controller = new AbortController();
    const result = await requestCandidate(repair ? currentRaw : undefined);
    const repairBudget=$('feedback-mode').value==='sectioned'?0:$('feedback-mode').value==='incremental'?4:3;
    if (auto) for (let i = 0; i < repairBudget && !history.at(-1).report.passed; i++) {
      await requestCandidate(currentRaw);
    }
    toast(history.at(-1).report.passed ? 'All proxy checks passed. Next, import and play the map in Geometry Dash.' : $('feedback-mode').value==='sectioned'?'Assembly stopped at a failed section. The history contains the diagnostics.':'Some checks failed. Inspect the report and request a repair.');
  } catch (e) { toast(e.name === 'AbortError' ? 'Request stopped.' : e.message, true); }
  finally { setBusy(false); renderHistory(); if (currentReport) renderChecks(); }
}

function canvasContext(canvas) {
  const { width, height } = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height };
}
function draw() {
  if ($('view-lab').hidden) return;
  const { ctx: c, width: w, height: h } = canvasContext($('game'));
  const tile = Math.min(42, w / 13), ground = h - 54 + cameraY * tile;
  c.clearRect(0, 0, w, h); c.fillStyle = '#101e2a'; c.fillRect(0, 0, w, h);
  // A restrained editorial grid and layered silhouettes, no external assets.
  c.strokeStyle = '#1a2d3b'; c.lineWidth = 1;
  for (let x = -(camera * tile % tile); x < w; x += tile) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = ground % tile; y < h; y += tile) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.fillStyle = '#18303c';
  for (let i = 0; i < 9; i++) { const bx = i * 153 - (camera * tile * .13 % 153); const bh = [55, 93, 70, 114][i % 4]; c.fillRect(bx, ground - bh, 78, bh); c.fillRect(bx + 7, ground - bh - 8, 64, 8); }
  c.fillStyle = '#142330'; c.fillRect(0, ground, w, h - ground); c.strokeStyle = '#426177'; c.beginPath(); c.moveTo(0, ground); c.lineTo(w, ground); c.stroke();
  if (!currentLevel) { c.fillStyle = '#b6c6d5'; c.font = '13px Segoe UI'; c.fillText('Fix the JSON structure to open the preview.', 20, h / 2); drawOverview(); return; }
  const px = x => (x - camera) * tile + 30;
  if ($('show-path').checked && solution.length) {
    c.strokeStyle = '#72e4e072'; c.lineWidth = 1.5; c.setLineDash([3, 5]); c.beginPath();
    solution.forEach((s, i) => { const x = px((s.x + P.width / 2) / P.tile), y = ground - (s.y + P.height / 2) / P.tile * tile; if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
    c.stroke(); c.setLineDash([]);
  }
  for (const o of currentLevel.objects) {
    const x = px(o.x); if (x > w + 30 || x + o.w * tile < 0) continue;
    const base=ground-(o.y??0)*tile;
    if(o.type==='coin'){
      const index=coinObjects(currentLevel).indexOf(o),collected=((gameState.coinMask??0)&(1<<index))!==0;
      c.save();c.globalAlpha=collected?.18:1;c.fillStyle='#f2c96d';c.strokeStyle='#ffedaf';c.lineWidth=2;c.beginPath();c.arc(x+tile/2,base-tile/2,tile*.35,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='#76501e';c.font=`bold ${Math.max(10,tile*.4)}px Consolas`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(index+1),x+tile/2,base-tile/2);c.restore();continue;
    }
    if (o.type !== 'block') for (let j = 0; j < o.w; j++) {
      const down=o.type==='spike_down';
      c.fillStyle = down?'#eaa4d8':'#ff9873'; c.beginPath(); c.moveTo(x + j * tile + 2, down?base-tile:base); c.lineTo(x + (j + .5) * tile, down?base:base-tile); c.lineTo(x + (j + 1) * tile - 2, down?base-tile:base); c.closePath(); c.fill();
      c.strokeStyle = '#ffc2a4'; c.lineWidth = 1; c.stroke();
    } else for (let j = 0; j < o.w; j++) for (let k = 0; k < o.h; k++) {
      const xx = x + j * tile, yy = base - (k + 1) * tile;
      c.fillStyle = o.y>0?'#275a65':'#345078'; c.fillRect(xx + 1, yy + 1, tile - 2, tile - 2); c.strokeStyle = o.y>0?'#6fe5e0':'#89b1f4'; c.strokeRect(xx + 1, yy + 1, tile - 2, tile - 2);
      c.strokeStyle = '#5275a0'; c.strokeRect(xx + 6, yy + 6, tile - 12, tile - 12);
    }
  }
  const end = px(currentLevel.length);
  c.strokeStyle = '#6fe5e0'; c.setLineDash([4, 5]); c.beginPath(); c.moveTo(end, 50); c.lineTo(end, ground); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#94b7c5'; c.font = '9px Consolas';
  for (let i = Math.max(0, Math.floor(camera / 5) * 5); i <= Math.min(currentLevel.length, camera + w / tile); i += 5) c.fillText(String(i).padStart(2, '0'), px(i), Math.min(h-20,ground + 23));
  if(currentLevel.version>=2)for(let y=0;y<=10;y+=2){const yy=ground-y*tile;if(yy>50&&yy<h-20)c.fillText(`y${y}`,7,yy-4);}
  const cubeX = px(gameState.x / P.tile), cubeY = ground - (gameState.y + P.height) / P.tile * tile;
  const cubeW = P.width / P.tile * tile, cubeH = P.height / P.tile * tile;
  c.save(); c.translate(cubeX + cubeW / 2, cubeY + cubeH / 2);
  if (!gameState.grounded) c.rotate(gameState.tick * .045);
  c.fillStyle = gameState.dead ? '#ff9873' : '#ceef7b'; c.fillRect(-cubeW / 2, -cubeH / 2, cubeW, cubeH);
  c.strokeStyle = '#ecffb0'; c.lineWidth = 2; c.strokeRect(-cubeW / 2, -cubeH / 2, cubeW, cubeH);
  c.fillStyle = '#243526'; c.fillRect(-cubeW * .23, -cubeH * .12, cubeW * .14, cubeH * .19); c.fillRect(cubeW * .09, -cubeH * .12, cubeW * .14, cubeH * .19); c.fillRect(-cubeW * .2, cubeH * .2, cubeW * .4, 2); c.restore();
  $('progress').textContent = `${Math.min(100, Math.floor(gameState.x / P.tile / currentLevel.length * 100))}%`;
  if(currentLevel.version===3)$('collected-coins').textContent=`Coins ${coinCount(gameState.coinMask??0)} / ${coinObjects(currentLevel).length}`;
  drawOverview();
}
function drawOverview() {
  const { ctx: c, width: w, height: h } = canvasContext($('overview')); c.clearRect(0, 0, w, h);
  if (!currentLevel) return;
  const scale = (w - 16) / currentLevel.length;
  c.fillStyle = '#273e50'; c.fillRect(7, h - 9, w - 14, 1);
  const compare=currentLevel.version===3&&$('compare-paths').checked;
  const heightScale=(h-15)/Math.max(compare?10:4,...currentLevel.objects.map(o=>(o.y??0)+o.h));
  if(compare)for(const trace of routeTraces){c.strokeStyle=trace.color;c.lineWidth=1.5;c.beginPath();trace.states.forEach((s,i)=>{const x=8+(s.x+P.width/2)/P.tile*scale,y=h-10-(s.y+P.height/2)/P.tile*heightScale;if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();}
  for (const o of currentLevel.objects) { c.fillStyle = o.type==='coin'?'#f2c96d':o.type==='spike_down'?'#eaa4d8':o.type === 'spike' ? '#ff9873' : o.y>0?'#6fe5e0':'#81aaff'; c.fillRect(8 + o.x * scale, h - 10 - ((o.y??0)+o.h)*heightScale, Math.max(2, o.w * scale - 1), o.h*heightScale); }
  c.fillStyle = '#6fe5e018'; c.fillRect(8 + camera * scale, 3, Math.min(w - 8 - camera * scale, $('game').getBoundingClientRect().width / Math.min(42, $('game').getBoundingClientRect().width / 13) * scale), h - 6);
  c.fillStyle = '#ceef7b'; c.fillRect(8 + gameState.x / P.tile * scale, 5, 2, h - 10);
}
function frame(time) {
  const delta = Math.min((time - previousFrame) / 1000 || 0, .1); previousFrame = time;
  if (running && currentLevel) {
    accumulator += delta;
    while (accumulator >= 1 / P.hz && running) {
      gameState = step(currentLevel, gameState, autoplay ? jumpTicks.has(gameState.tick) : jumpRequested);
      jumpRequested = false; accumulator -= 1 / P.hz;
      camera = Math.max(0, gameState.x / P.tile - 4);
      cameraY=currentLevel.version>=2?Math.max(0,(gameState.y+P.height)/P.tile-4.5):0;
      if (gameState.dead || gameState.x / P.tile >= currentLevel.length) {
        running = false; $('play').textContent = '↺ Try again';
        const needsCoins=currentLevel.version===3&&$('replay-goal').value==='all-coins';
        $('game-message').textContent = gameState.dead ? 'Collision · try again' : needsCoins?(coinCount(gameState.coinMask??0)===coinObjects(currentLevel).length?'Proxy finish with all coins ✓':'Finish · some coins are missing'):'Proxy finish ✓';
      }
    }
    draw();
  }
  requestAnimationFrame(frame);
}
function startPlay(auto) {
  if (!currentLevel || (auto && !selectedSolver()?.passed)) return;
  resetGame(); autoplay = auto; running = true;
  $('play').textContent = 'Ⅱ Pause'; $('play-mode').textContent = auto ? 'SOLVER PATH · PROXY' : 'MANUAL PLAY · PROXY'; $('game').focus(); draw();
}

$('generate').onclick = () => runGeneration(); $('auto').onclick = () => runGeneration(true);
$('load-section-demo').onclick=async()=>{
  if(busy)return;
  setBusy(true);
  try{
    const response=await fetch('/api/sectioned-demo');const record=await response.json();if(!response.ok)throw new Error(record.error);
    $('geometry').value='ground';$('provider').value='ollama';updateGeometryControls();
    for(const [key,value]of Object.entries(record.case.requirements)){const field=document.querySelector(`[data-req="${key}"]`);if(field)field.value=value;}
    $('prompt').value='Create a Geometry Dash level meeting all numeric requirements, with a complete playable path.';$('seed').value=record.case.seed;$('section-feedback').value=record.condition;
    $('feedback-mode').value='sectioned';$('feedback-mode').onchange();
    history=[{...record.result,provider:'recorded',origin:'recorded'}];sourceLabel='RECORDED QWEN · LIBRARY PLAN · NO NEW INFERENCE';
    applyRaw(record.result.raw);currentReport=record.result.report;selectSolution();resetGame();renderChecks();renderHistory();draw();
    toast('Loaded a recorded Qwen assembly. No new inference was run.');
  }catch(e){toast(e.message,true);}finally{setBusy(false);renderChecks();}
};
$('repair').onclick = () => runGeneration(false, true); $('cancel').onclick = () => controller?.abort();
$('play').onclick = () => { if (running) { running = false; $('play').textContent = '▶ Resume'; } else if (!gameState.dead && gameState.tick > 0 && gameState.x < (currentLevel?.length || 0) * P.tile) { running = true; $('play').textContent = 'Ⅱ Pause'; } else startPlay(false); };
$('replay').onclick = () => startPlay(true); $('reset').onclick = () => { resetGame(); draw(); };
$('show-path').onchange = draw;
$('compare-paths').onchange=draw;
$('replay-goal').onchange=()=>{selectSolution();resetGame();renderChecks();draw();};
$('timing-analyze').onclick=()=>analyzeCurrentTiming();
$('timing-target').onchange=()=>{$('challenge-preset').value='';history=[];updateGeometryControls();updateTimingConstraint();renderChecks();};
$('game').onkeydown = e => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); if (!running) startPlay(false); jumpRequested = true; } };
$('game').onpointerdown = () => { if (!running) startPlay(false); jumpRequested = true; };
$('overview').onpointerdown = e => { if (!currentLevel) return; running = false; $('play').textContent = '▶ Resume'; const rect = $('overview').getBoundingClientRect(); camera = Math.max(0, Math.min(currentLevel.length - 8, (e.clientX - rect.left) / rect.width * currentLevel.length - 5)); draw(); };
$('overview').onkeydown = e => { if (!currentLevel || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); camera = Math.max(0, Math.min(currentLevel.length - 8, camera + (e.key === 'ArrowRight' ? 5 : -5))); draw(); };
window.addEventListener('resize', draw);
document.querySelectorAll('.nav').forEach(el => { el.onclick = () => { running = false; document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${el.dataset.view}`; }); document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n === el)); draw(); }; });
document.querySelectorAll('[data-pane]').forEach(el => { el.onclick = () => { document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== `pane-${el.dataset.pane}`; }); document.querySelectorAll('[data-pane]').forEach(t => { t.classList.toggle('active', t === el); t.setAttribute('aria-selected', String(t === el)); }); }; });
document.querySelectorAll('[data-req]').forEach(el => { el.onchange = () => { $('challenge-preset').value = ''; updateGeometryControls(); try { applyRaw(currentRaw, { resetHuman: false }); } catch (e) { toast(e.message, true); } }; });
async function loadChallengePresets() {
  try {
    const response = await fetch('/challenge-presets.json');
    if (!response.ok) throw new Error('Difficulty presets are unavailable. Enter requirements manually.');
    const extraResponse=await fetch('/elevated-presets.json');if(!extraResponse.ok)throw new Error('Platform presets are unavailable.');
    const coinResponse=await fetch('/coin-presets.json');if(!coinResponse.ok)throw new Error('Coin presets are unavailable.');
    const timingResponse=await fetch('/timing-presets.json');if(!timingResponse.ok)throw new Error('Timing presets are unavailable.');
    const branchResponse=await fetch('/branch-presets.json');if(!branchResponse.ok)throw new Error('Branch presets are unavailable.');
    const tasks = [...await response.json(),...await extraResponse.json(),...await coinResponse.json(),...await timingResponse.json(),...await branchResponse.json()];tasks.forEach(englishPreset);presets=tasks;
    const labels = { flow: 'Warm-up · 80 tiles', rhythm: 'Basic rhythm · 100 tiles', triples: 'Medium · triple spikes', steps: 'Medium · tall steps', precision: 'Hard · precision, 18 jumps', endurance: 'Hard · endurance, 24 jumps' };
    for (const task of tasks) { const option = document.createElement('option'); option.value = task.id; option.textContent = labels[task.id] || task.title || task.id; $('challenge-preset').append(option); }
    $('challenge-preset').onchange = () => {
      const task = tasks.find(t => t.id === $('challenge-preset').value); if (!task) return;
      $('geometry').value=task.geometry||'ground';updateGeometryControls();
      $('timing-target').value=task.timingProfile||'any';$('replay-goal').value=task.timingProfile?'all-coins':'finish';
      const r = (task.geometry==='coins'?checkCoinRequirements:task.geometry==='elevated'?checkElevatedRequirements:checkRequirements)(task.requirements);
      document.querySelectorAll('[data-req]').forEach(el => { el.value = r[el.dataset.req]??COIN_ONLY_REQUIREMENTS[el.dataset.req]??EXTRA_REQUIREMENTS[el.dataset.req]??0; });
      $('prompt').value = task.prompt; history = []; humanFeedback = null;
      applyRaw(currentRaw); toast('Preset selected. Click Generate to create a new map.');
    };
  } catch (e) { toast(e.message, true); }
}
$('geometry').onchange=()=>{updateGeometryControls();history=[];humanFeedback=null;try{applyRaw(currentRaw);}catch(error){toast(error.message,true);}toast('The geometry profile sets the format of the next generation.');};
$('load-example').onclick=async()=>{
  try{const task=presets.find(t=>t.id===$('challenge-preset').value);if(!task?.example)return;
    const response=await fetch(task.example);if(!response.ok)throw new Error('The example is unavailable.');
    history=[];sourceLabel='PROCEDURAL EXAMPLE · NO LLM';applyRaw(await response.text());if(currentLevel?.version===3)await analyzeCurrentTiming('all-coins');toast('Loaded a geometry fixture. It is not an LLM generation.');
  }catch(error){toast(error.message,true);}
};
$('feedback-mode').onchange = () => {
    $('edit-feedback-field').hidden=$('feedback-mode').value!=='incremental';
    $('section-feedback-field').hidden=$('feedback-mode').value!=='sectioned';
    $('load-section-demo').hidden=$('feedback-mode').value!=='sectioned';
  $('mode-description').textContent = { none: 'Regenerate from the brief and previous map, without an external diagnostic report.', critic: 'An independent LLM critiques the JSON without seeing search or rule outcomes.', validator: 'Error codes, coordinates and rule outcomes from the proxy.', hybrid: 'Independent text critique combined with the exact validator report.', safe: 'The model receives the full validator report. Keep an edit only if it preserves all passed checks and passes a new one. Otherwise retain the map. Ground obstacles only.', incremental:'The model sees the failure location and edit bounds, then changes one object. Passed checks are preserved and search progress is measured. Preparatory edits are marked separately. Ground obstacles only.' }[$('feedback-mode').value];
  $('auto').textContent=`Run loop · up to ${$('feedback-mode').value==='incremental'?4:3} repairs →`;
    if($('feedback-mode').value==='sectioned'){$('auto').textContent='Build 4 sections →';$('mode-description').textContent='The model chooses library patterns for four sections, up to three proposals per section. The compiler sets coordinates. Check the prefix and joins after each section, and all original requirements on the complete map. A failed section stops assembly. Diagnostic reports can be disabled for comparison.';}
    if($('feedback-mode').value==='incremental'&&$('edit-feedback').value==='targeted')$('mode-description').textContent='Concise feedback explains the previous edit and points to objects relevant to the current deficit. The model changes one object while preserving passed checks. Experimental ground-only mode.';
  if(currentReport)renderChecks();
};
  $('edit-feedback').onchange=()=>$('feedback-mode').onchange();
  $('provider').onchange = ()=>{updateProviderNote();updateGeometryControls();};
async function refreshStatus() {
  $('model-status').disabled = true;
  try { const s = await (await fetch('/api/status')).json(); $('model-status').classList.toggle('online', s.available && s.installed); $('model-status').querySelector('span').textContent = s.available && s.installed ? `${s.model} · ready` : s.available ? `${s.model} · not installed` : 'Ollama · offline'; }
  catch { $('model-status').querySelector('span').textContent = 'Server unavailable'; }
  finally { $('model-status').disabled = false; }
}
$('model-status').onclick = refreshStatus;
$('apply-json').onclick = () => { try { history = []; sourceLabel = 'USER JSON'; applyRaw($('json-editor').value,{syncGeometry:true}); toast(currentReport.schemaValid ? 'JSON applied and validated.' : 'JSON validation failed. Inspect the errors.', !currentReport.schemaValid); } catch (e) { toast(e.message, true); } };
$('upload-json').onchange = async e => { try { const file = e.target.files[0]; if (!file) return; if (file.size > 100000) throw new Error('JSON must be at most 100 KB.'); const raw = await file.text(); history = []; sourceLabel = 'JSON FROM FILE'; applyRaw(raw,{syncGeometry:true}); } catch (error) { toast(error.message, true); } finally { e.target.value = ''; } };
function download(data, name, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download-json').onclick = () => download(currentRaw, 'dashlab-level.json', 'application/json');
async function exportLevel(format) {
  try { if (!currentLevel) throw new Error('Fix the JSON structure first.'); const result = await api('/api/export', { level: currentLevel, format }); download(result.data, `dashlab-${result.hash.slice(0, 10)}.${format}`); toast('File ready. Verify import and completion separately in the game.'); }
  catch (e) { toast(e.message, true); }
}
$('export-gdlvl').onclick = () => exportLevel('gdlvl'); $('export-gmd').onclick = () => exportLevel('gmd');
$('open-playtest').onclick = () => { if (!currentLevel) return; running = false; dialogLevel = structuredClone(currentLevel); $('game-death-x').max = currentLevel.length; $('playtest-dialog').showModal(); };
$('close-playtest').onclick = () => $('playtest-dialog').close();
$('playtest-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const result = await api('/api/playtest', { level: dialogLevel, gameVersion: $('game-version').value,
      status: $('game-result').value, deaths: Number($('game-deaths').value), deathX: $('game-death-x').value === '' ? null : Number($('game-death-x').value), notes: $('game-notes').value });
    // Pin feedback to the exact level opened by the dialog.
    if (JSON.stringify(dialogLevel) === JSON.stringify(currentLevel)) {
      humanFeedback = { status: result.status, gameVersion: result.gameVersion, deaths: result.deaths, deathX: result.deathX, notes: result.notes, levelHash: result.levelHash };
      $('playtest-state').textContent = `Human report: ${{ passed: 'completed', failed: 'not completed', 'import-failed': 'import failed' }[result.status]}, deaths: ${result.deaths}. Included in the next repair.`;
    }
    $('playtest-dialog').close(); toast('Human report saved to results/playtests.jsonl.');
  } catch (error) { toast(error.message, true); }
};
$('upload-results').onchange = async e => {
  try {
    const file = e.target.files[0]; if (!file) return; if (file.size > 1e6) throw new Error('File is too large.');
    const result = JSON.parse(await file.text());
    if (!Array.isArray(result.summary) || !result.summary.length || result.summary.length > 4) throw new Error('Expected summary.json produced by scripts/experiment.js.');
    $('results-note').textContent = result.scientificResults ? `Actual Ollama run · ${result.model} · physics ${result.physics?.id || 'unknown'}. No native-game result is inferred.` : 'SCRIPTED DEMO. Procedural maps; these numbers are not an LLM comparison.';
    const tbody = $('results-table'); tbody.replaceChildren();
    for (const row of result.summary) {
      const tr = document.createElement('tr');
      const pct = n => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
      for (const text of [modeNames[row.mode] || row.mode, row.n, pct(row.proxyPlayableRate), pct(row.successRate), row.meanRepairsUsed?.toFixed(2) ?? '—', row.diversitySuccessful?.toFixed(3) ?? '—']) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      tbody.append(tr);
    }
  } catch (error) { toast(error.message, true); } finally { e.target.value = ''; }
};
async function loadLatestStudy(){
  const target=$('latest-study-results');
  try{
    const response=await fetch('/repair-demo-data.json');if(!response.ok)throw new Error('Recorded results are unavailable.');
    const data=await response.json(),conditions={whole_none:'Whole plan · no report',whole_feedback:'Whole plan · with feedback',local_none:'One section · no report',local_feedback:'One section · with feedback',whole_random:'Random whole-plan repair',local_random:'Random one-section repair'};
    target.replaceChildren();
    for(const[arm,label]of Object.entries(conditions)){
      const row=document.createElement('tr');
      for(const text of [label,...['qwen3.5:4b','qwen3.5:9b-q4_K_M'].map(model=>{const cell=data.summary.find(s=>s.model===model&&s.arm===arm);return cell?`${cell.successes} / ${cell.completed}`:'Pending';})]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}
      target.append(row);
    }
    $('latest-study-note').textContent=`${data.completed}/${data.planned} chains · 12 numeric briefs in six known families × 2 seeds × 2 models × 6 conditions. Up to three repair proposals after a shared first draft.`;
  }catch(error){$('latest-study-note').textContent=error.message;}
}
applyRaw(currentRaw); $('feedback-mode').onchange(); refreshStatus(); loadChallengePresets(); loadLatestStudy(); requestAnimationFrame(frame);
