// Conservative comparison of two successful witnesses, not a topology proof.
export const ROUTE_MEASURE_VERSION='two-witness-height-span-v1';
export const MIN_HEIGHT_SEPARATION=2;
export function measureRouteSeparation(level,lowerTicks,upperTicks,{replay,physics}){
 const lower=replay(level,lowerTicks),upper=replay(level,upperTicks);
 if(!lower.passed||!upper.allCoins)return{version:ROUTE_MEASURE_VERSION,status:'unavailable',spanTiles:null,minimumHeightTiles:MIN_HEIGHT_SEPARATION};
 const intervals=[];let start=null,end=null;
 const flush=()=>{if(start!==null)intervals.push({fromX:start,toX:end,spanTiles:end-start});start=end=null;};
 for(let i=0;i<Math.min(lower.states.length,upper.states.length);i++){
  const a=lower.states[i],b=upper.states[i];
  if(a.tick!==b.tick||a.x!==b.x)throw new Error('Route witnesses must share ticks and horizontal physics.');
  if(b.y-a.y>=MIN_HEIGHT_SEPARATION*physics.tile){start??=a.x/physics.tile;end=a.x/physics.tile;}else flush();
 }
 flush();const longest=intervals.reduce((best,item)=>item.spanTiles>best.spanTiles?item:best,{fromX:null,toX:null,spanTiles:0});
 return{version:ROUTE_MEASURE_VERSION,status:'measured',minimumHeightTiles:MIN_HEIGHT_SEPARATION,...longest,
  seconds:longest.spanTiles/(physics.dx/physics.tile*physics.hz),intervals,
  scope:'Longest continuous tick-sampled interval with the all-coins witness at least 2 tiles above the minimum-jump finish witness. A short span does not prove that no other separated routes exist.'};
}
