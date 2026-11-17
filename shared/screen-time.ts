export const screenUseLimitMs=15*60_000;
export const screenRestMs=5*60_000;
export interface ScreenTimeStatus { serverNow:string; usedMs:number; limitMs:number; restMs:number; breakUntil?:string }

/** Project only the current visible lease; the server remains authoritative. */
export function screenTimeView(status:ScreenTimeStatus,elapsedMs=0,active=true) {
  const now=Date.parse(status.serverNow)+Math.max(0,elapsedMs);
  const restRemaining=status.breakUntil?Math.max(0,Date.parse(status.breakUntil)-now):0;
  const remaining=Math.max(0,status.limitMs-status.usedMs-(active&&!status.breakUntil?Math.max(0,elapsedMs):0));
  return {blocked:restRemaining>0||(!status.breakUntil&&remaining===0),restRemaining,remaining};
}
