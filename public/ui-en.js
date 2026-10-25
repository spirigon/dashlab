// Presentation-only localization. Do not mutate validator data or saved research traces.
const labels={LENGTH:'Length',SPIKES:'Spikes',BLOCKS:'Block groups',DOUBLE_SPIKES:'Double-spike groups',TRIPLE_SPIKES:'Triple-spike groups',TALL_BLOCKS:'Tall blocks',TIGHT_GAPS:'Gaps of 1–2 tiles',SAFE_START:'Safe start',SAFE_FINISH:'Safe finish',MIN_JUMPS:'Required jumps',RAISED_BLOCKS:'Raised blocks',RAISED_SPIKES:'Raised spike groups',CEILING_SPIKES:'Ceiling spike groups',COVERED_SPIKES:'Covered spikes',GROUND_SPIKE_RUN:'Longest ground-spike run',ELEVATED_LANDINGS:'Required raised landings',COINS:'Coins',ALL_COINS:'All coins in one run',COIN_DETOUR:'Extra jumps for all coins',BRANCH_SPAN:'Continuous route separation',TIMING_PROFILE:'Timing profile',SCHEMA:'Invalid level structure',JSON_PARSE:'Invalid JSON',BOUNDS:'Object outside the allowed bounds',OVERLAP:'Overlapping objects',MERGEABLE_BLOCKS:'Merge adjacent aligned blocks',COIN_LIMIT:'At most three coins are allowed',ELEVATED_VERSION:'Select elevated geometry for this requirement'};
const cyrillic=/[\u0400-\u04ff]/;
export function englishMessage(value='',code){
  const text=String(value??'');if(!cyrillic.test(text))return text;
  const ratio=text.match(/:\s*([?\d.]+\s*\/\s*[≥≤]?[?\d.]+)/);
  if(code&&labels[code]&&ratio)return`${labels[code]}: ${ratio[1]}${code==='BRANCH_SPAN'?' tiles':''}`;
  const x=text.match(/x\s*[=≈]\s*([\d.]+)/)?.[1];
  if(code==='NO_PATH')return`No complete proxy path was found${x?'; search stopped near x='+x:''}.`;
  if(code==='NO_COIN_PATH')return`No complete path collecting all coins was found${x?' near x='+x:''}.`;
  if(code==='SEARCH_BUDGET')return'Search budget exhausted; the result is inconclusive.';
  if(code==='ALL_COINS')return text.includes('неизвестен')?'All-coins search is inconclusive.':'No complete all-coins path was found.';
  if(code==='COVERED_SPIKES')return`Covered spikes: ${text.match(/\d+/)?.[0]??'?'}. Consider whether they serve a purpose.`;
  if(code==='GROUND_SPIKE_RUN')return`A run of ${text.match(/\d+/)?.[0]??'?'} ground spikes needs an in-game playtest.`;
  if(code==='TIMING_PROFILE'){
    const window=text.match(/окно\s*([?\d.]+)/)?.[1]??'?';return`Timing constraint: minimum local window ${window} ms. See the timing panel for the measured profile.`;
  }
  if(code){const objects=text.match(/objects\[\d+\]/)?.[0];return`${labels[code]||code}${objects?' · '+objects:''}${x?' · x='+x:''}. See the level JSON for details.`;}
  if(/Ollama/i.test(text))return'Ollama request failed. Check the model, local server and request timeout.';
  if(/Требование|requirements|ожидается целое/i.test(text))return`Invalid requirement: ${text.match(/[a-zA-Z][a-zA-Z0-9]*/)?.[0]||'numeric value'}. Enter an integer within the input limits.`;
  if(/Исходный путь/.test(text))return'The selected input sequence does not complete the goal or includes an input without a jump.';
  return'Request failed. Check the input and inspect the server diagnostics.';
}
export function englishReport(value){
  if(Array.isArray(value))return value.map(englishReport);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='message'?englishMessage(item,value.code):englishReport(item)]));
  return value;
}
const presets={
  flow:['Warm-up · 80 tiles','Create a short warm-up with distinct obstacles, recovery space and a safe start and finish. Meet every numeric requirement.'],
  rhythm:['Basic rhythm · 100 tiles','Create a rhythmic cube level with alternating spikes and blocks. Meet all requirements and preserve a complete playable route.'],
  triples:['Medium · triple spikes','Use visible triple-spike groups and recovery space. Meet all numeric requirements and preserve a complete path.'],
  steps:['Medium · tall steps','Use steps and tall blocks with accessible approaches. Meet the numeric requirements and preserve a complete path.'],
  precision:['Hard · precision, 18 jumps','Create a precision-focused cube level requiring at least the specified minimum jumps. Meet all counts and preserve full-level playability.'],
  endurance:['Hard · endurance, 24 jumps','Create a longer endurance level with varied obstacle groups and recovery space. Meet all numeric requirements and preserve full-level playability.'],
  terraces:['Routes · terraces','Use steps and a descent, then a short climb to a wide raised platform with one visible spike on top. Leave recovery space. Approach from ground steps; avoid covered spikes and an opening jump directly onto a high floating platform.'],
  'low-ceiling':['Routes · stay low','Alternate a single jump, recovery space, a low ceiling crossed without jumping, and steps onto a wide platform. Separate later spikes and ceilings safely. Avoid covered spikes and long ground-spike runs.'],
  'two-routes':['Routes · high or low','Provide distinct upper and lower routes with accessible approaches and a safe merge. Use varied player actions, avoid covered spikes and meet every original numeric requirement.'],
  'upper-reward':['Coins · upper reward','Create two routes: an easier lower route and an upper route with one coin. All coins must be collectable in one run. Use accessible ground approaches and recovery space after the merge.'],
  'coin-practice':['Coins · two jumps for a reward','Create a short terraced route with two coins. Put one above a wide platform and make the other require a separate jump in an open safe section. Separate sections with recovery space; collect all coins in one run.'],
  'three-coins':['Coins · collect all three','Create a complete cube route with three collectable coins and a simpler finish route. All three coins must be reachable in one run. Meet every original requirement.'],
  'timing-wide':['Timing · wide windows','Create a short level with one coin on a raised platform. Use low climbs, wide supports and recovery space so the all-coins route has wide timing windows. Avoid long ground-spike runs.'],
  'timing-balanced':['Timing · balanced windows','Place a coin on a high platform with simple obstacles after recovery space. Collecting it should require a controlled high jump, targeting a local window of 4–9 ticks. The ordinary finish must also be reachable.'],
  'timing-tight':['Timing · tight window','Create an all-coins route with a tight but valid jump window, plus a reachable ordinary finish. Meet the numeric requirements without changing the physics.'],
  'long-skyway':['Branch · long upper road','Make clearly different routes over most of the level. After a common platform, allow descent into a lower corridor or jumps along upper platforms with three coins. Separate the solver routes vertically by at least two tiles for the requested horizontal span. Leave room to descend and recover before the common finish; avoid spikes hidden below upper blocks.'],
  'high-low-road':['Branch · heights and lower steps','Build distinct upper and lower routes. The lower route uses ground steps; the upper route changes height and contains three coins. Make both finish paths accessible, meet the route-separation requirement and leave recovery space at the merge. Avoid covered spikes.'],
};
export function englishPreset(task){const entry=presets[task.id];if(entry){task.title=entry[0];task.prompt=entry[1];}else if(cyrillic.test(task.title||'')){task.title=task.id;task.prompt='Create a level meeting all original numeric requirements with a complete playable path.';}return task;}
