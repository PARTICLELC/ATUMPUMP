import crypto from 'node:crypto';
export function createDemoAdapter() {
  const bases = Array.from({length:36},(_,i)=>({
    mint:`DEMO_MINT_${i+1}`, pair_address:`DEMO_PAIR_${i+1}`,
    symbol:`SIM${String(i+1).padStart(2,'0')}`, name:`A-LIST Demo Pair ${i+1}`,
    base:0.00001*(i+1), drift:0.00008+(i%7)*0.000025, phase:i
  }));
  return {
    async scan() {
      const now=Date.now();
      return bases.map(p=>{
        const seconds=now/1000;
        const wave=Math.sin(seconds/180+p.phase)*0.018;
        const growth=Math.exp(p.drift*(seconds/60));
        const noise=(crypto.createHash('sha256').update(`${p.mint}:${Math.floor(now/5000)}`).digest().readUInt16BE(0)/65535-0.5)*0.004;
        return {mint:p.mint,pair_address:p.pair_address,symbol:p.symbol,name:p.name,
          price:p.base*growth*(1+wave+noise),observed_at:now,source:'A_LIST_DEMO_SYNTHETIC'};
      });
    },
    close() {}
  };
}
