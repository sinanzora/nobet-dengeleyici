/* Resmî çizelge çözücüsü.
   - Kişi başına KESİN kısıtlar dinamik programlama ile birebir uygulanır: en çok K (8) farklı gün, ardışık nöbet
     başlangıçları arasında en az G (3) takvim günü (= iki tam boş gün), engelli günler (izin, hariç, ay sınırı, NSİ),
     tek kategori, hakediş hedefi (devirsiz modda altına düşülemez).
   - Günlük kadro sınırları (Acil üst sınırı, Servis/Acil asgari, Servis üst sınırı) kişiler arası bağ kurar; bunlar
     uyarlamalı ceza fiyatlarıyla (Lagrange benzeri) çözülür ve SONUÇ ayrıca bağımsız denetimden geçer.
   - Zaman sınırında tüm günlük sınırlar sağlanamazsa sonuç 'bulunamadı (zaman sınırı)' döner; bu bir imkânsızlık
     kanıtı DEĞİLDİR. İmkânsızlık yalnız açık kanıt (kişi düzeyinde DP, gün düzeyinde aday sayısı, kapasite toplamı) varsa bildirilir. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;root.NobetSolver=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const CATS=["Servis","Acil"];
  const now=()=>(typeof performance!=="undefined"&&performance.now)?performance.now():Date.now();
  /* Varsayılan çözücü ağırlıkları (talimatnamede listelenir). over/short: eşdeğer saat başına fazla/eksik cezası; day: gün başına;
     actual: fiilen çalışılan güne yazma ödülü; weekend: hafta sonu cezası; avoid/prefer: kişi tercihleri; balanceServis/balanceAcil: günlük yük dengesi;
     hard: günlük sınır ihlali başlangıç fiyatı (uyarlamalı artar); switch: kategori değiştirme cezası;
     posted: bu ayın PROBEL'e işlenmiş nöbetini koruma ödülü (yalnız bu ayın PROBEL listesi yüklüyse ve “koru” seçiliyse; yumuşak tercih, kesin kural değil). */
  const DEFAULT_WEIGHTS=Object.freeze({over:10,short:60,day:1,actual:4,weekend:0.4,avoid:25,prefer:4,balanceServis:3,balanceAcil:0.5,hard:40,switch:0.5,posted:6});
  /* kategori iyileştirme turunun sınırları: en çok bu kadar tur ve süre (ms; ayrıca çözücü süre sınırını aşmaz) */
  const IMPROVE=Object.freeze({rounds:40,ms:8000,maxCombo:10,maxHelpers:12});
  /* kategori kapsama kanıtının arama sınırları; aşılırsa kanıt iddia edilmez */
  const COVERAGE=Object.freeze({ms:2000,nodes:3e6,maxCandidates:20});
  function gcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b){[a,b]=[b,a%b];}return a;}
  function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}

  /* Tek kişi + tek kategori için en iyi takvim (kesin DP).
     dayCost[i]: o güne yazmanın maliyeti (Infinity = yasak). values[i]: o günün eşdeğer saati (null = kullanılamaz).
     Döner: {cost, days:[i...], total} veya null (hedefe ulaşılamıyor). */
  function bestSchedule(values,dayCost,target,opt){
    const N=values.length,K=opt.maxDays,G=opt.minGap;
    const avail=[];for(let i=0;i<N;i++)if(values[i]!=null&&values[i]>0&&Number.isFinite(dayCost[i]))avail.push(i);
    const tgt=Math.max(0,target);
    const shortW=opt.mode==="defer"?opt.shortW:Infinity;
    if(tgt<=0)return{cost:0,days:[],total:0,shortfall:0,over:0};
    if(!avail.length)return opt.mode==="defer"?{cost:shortW*tgt,days:[],total:0,shortfall:tgt,over:0}:null;
    let g=0;const h=values.map(v=>v==null?null:Math.round(v*2));for(const i of avail)g=gcd(g,h[i]);if(!g)g=1;
    const vals=values.map((v,i)=>h[i]==null?0:h[i]/g);
    let maxV=0;for(const i of avail)maxV=Math.max(maxV,vals[i]);
    const T=Math.ceil(tgt*2/g-1e-9);const cap=T+2*maxV;const V=cap+1;
    const size=(K+1)*N*V;
    const f=new Float64Array(size).fill(Infinity);const back=new Int16Array(size).fill(-1);
    const P=new Float64Array(size).fill(Infinity);const Parg=new Int16Array(size).fill(-1);
    const idx=(k,i,v)=>(k*N+i)*V+v;
    for(let k=1;k<=K;k++){
      for(let i=0;i<N;i++){
        if(vals[i]>0&&Number.isFinite(dayCost[i])&&values[i]!=null){
          const vi=vals[i],c=dayCost[i];
          if(k===1){if(vi<=cap){f[idx(1,i,vi)]=c;}}
          else if(i-G>=0){const pi=i-G;for(let v=vi;v<=cap;v++){const pv=P[idx(k-1,pi,v-vi)];if(pv<Infinity){const val=pv+c;if(val<f[idx(k,i,v)]){f[idx(k,i,v)]=val;back[idx(k,i,v)]=Parg[idx(k-1,pi,v-vi)];}}}}
        }
        for(let v=0;v<=cap;v++){const cur=f[idx(k,i,v)];const prevP=i>0?P[idx(k,i-1,v)]:Infinity;if(cur<prevP){P[idx(k,i,v)]=cur;Parg[idx(k,i,v)]=i;}else{P[idx(k,i,v)]=prevP;Parg[idx(k,i,v)]=i>0?Parg[idx(k,i-1,v)]:-1;}}
      }
    }
    let best=null;
    const unitH=g/2;
    for(let k=1;k<=K;k++)for(let v=0;v<=cap;v++){const c=P[idx(k,N-1,v)];if(!(c<Infinity))continue;const total=v*unitH;let term;if(total+1e-9>=tgt)term=opt.overW*(total-tgt);else{if(!(shortW<Infinity))continue;term=shortW*(tgt-total)+0;}const tc=c+term+opt.dayW*k;if(!best||tc<best.cost-1e-9){best={cost:tc,k,v,end:Parg[idx(k,N-1,v)],total};}}
    if(opt.mode==="defer"){const c0=shortW*tgt;if(!best||c0<best.cost)best={cost:c0,k:0,v:0,end:-1,total:0};}
    if(!best)return null;
    const days=[];let k=best.k,i=best.end,v=best.v;
    while(k>0&&i>=0){days.push(i);const vi=vals[i];const j=back[idx(k,i,v)];v-=vi;k--;i=j;}
    days.reverse();
    const total=days.reduce((s,d)=>s+values[d],0);
    return{cost:best.cost,days,total,shortfall:Math.max(0,tgt-total),over:Math.max(0,total-tgt)};
  }

  /* Bir kişi için ulaşılabilecek en yüksek eşdeğer (imkânsızlık kanıtı için): maliyetsiz DP, hedef sonsuz yerine en büyük toplam. */
  function maxReachable(values,blocked,opt){
    const N=values.length,K=opt.maxDays,G=opt.minGap;
    /* best[k][i] = i'de biten k nöbetle en yüksek toplam */
    const best=Array.from({length:K+1},()=>new Array(N).fill(-Infinity));let ans=0;
    for(let k=1;k<=K;k++){let pref=-Infinity;let pi=-1;for(let i=0;i<N;i++){while(pi<i-G){pi++;if(k>1)pref=Math.max(pref,best[k-1][pi]);}if(values[i]==null||blocked[i])continue;const val=values[i]+(k===1?0:pref);if(val>best[k][i])best[k][i]=val;ans=Math.max(ans,best[k][i]);}}
    return ans;
  }
  /* Kişinin bir kategoride hakedişini (altına düşmeden) karşılarken KAÇINILMAZ fazlası: engeller, en çok K gün ve G aralıkla
     ulaşılabilen toplamlardan hedefe eşit/üstü en küçüğü − hedef. Günlük kadro sınırları ve diğer kişiler yok sayılır (gevşetme),
     bu yüzden kişilerin toplamı GERÇEK en iyi çözümün fazlasının ALT SINIRIDIR. null = o kategoride hedefe ulaşılamıyor. */
  function overFloor(values,blocked,target,opt){
    const cost=values.map((v,i)=>blocked[i]||v==null?Infinity:0);
    const r=bestSchedule(values,cost,target,{maxDays:opt.maxDays,minGap:opt.minGap,mode:"strict",overW:1,dayW:0,shortW:Infinity});
    return r?r.over:null;
  }
  function minDaysNeeded(values,blocked,target,opt){
    if(target<=0)return 0;
    const N=values.length,K=opt.maxDays,G=opt.minGap;
    const best=Array.from({length:K+1},()=>new Array(N).fill(-Infinity));
    for(let k=1;k<=K;k++){let pref=-Infinity;let pi=-1;for(let i=0;i<N;i++){while(pi<i-G){pi++;if(k>1)pref=Math.max(pref,best[k-1][pi]);}if(values[i]==null||blocked[i])continue;best[k][i]=values[i]+(k===1?0:pref);if(best[k][i]+1e-9>=target)return k;}}
    return null;
  }

  /* KATEGORİ KAPSAMA (kesin, sınırlı arama). need[d]: o gün kategoride gereken en az kişi. cand: o kategoriye yazılabilen
     (hakedişini o kategoride tamamlayabilen) kişiler. Her aday ≤K gün, başlangıçlar arası ≥G, engelli günler hariç, toplam ≥ hedef.
     Döner: true (kapsama var), false (KESİNLİKLE yok), null (süre/düğüm sınırı — sonuç yok).
     Not: günlük üst sınırlar ve diğer kategori yok sayılır (gevşetme); gevşetilmiş problem çözümsüzse asıl problem de çözümsüzdür.
     Her aday hedefine ulaşabildiği için (maxReachable ≥ hedef) adayların hepsini kullanmak kapsamayı daraltmaz. */
  function coverageSearch(values,cand,need,opt,msLimit,nodeLimit){
    const N=values.length,K=opt.maxDays,G=opt.minGap;const t0=now();let nodes=0;
    const bestFrom=cand.map(p=>{const B=Array.from({length:N+G+1},()=>new Array(K+1).fill(0));for(let d=N-1;d>=0;d--)for(let k=1;k<=K;k++){const take=(!p.blockedArr[d]&&values[d]!=null)?values[d]+B[d+G][k-1]:-Infinity;B[d][k]=Math.max(B[d+1][k],take);}return B;});
    const st=cand.map(()=>({cnt:0,last:-1e9,sum:0}));
    const future=d=>{for(let i=0;i<cand.length;i++){const s=st[i];const rest=cand[i].target-s.sum;if(rest<=1e-9)continue;const from=Math.max(d,s.last+G);if(from>=N||K-s.cnt<=0||bestFrom[i][from][K-s.cnt]+1e-9<rest)return false;}return true;};
    const popc=x=>{let c=0;while(x){c+=x&1;x>>>=1;}return c;};
    function dfs(d){if(++nodes>nodeLimit||now()-t0>msLimit)throw 0;
      if(d===N){for(let i=0;i<cand.length;i++)if(st[i].sum+1e-9<cand[i].target)return false;return true;}
      if(!future(d))return false;
      const can=[];if(values[d]!=null)for(let i=0;i<cand.length;i++){const s=st[i];if(!cand[i].blockedArr[d]&&s.cnt<K&&d-s.last>=G)can.push(i);}
      const req=need[d]||0;if(can.length<req)return false;
      const n=Math.min(can.length,20);const subs=[];for(let m=0;m<(1<<n);m++)if(popc(m)>=req)subs.push(m);subs.sort((a,b)=>popc(a)-popc(b));
      for(const m of subs){const sel=[];for(let j=0;j<n;j++)if(m&(1<<j))sel.push(can[j]);const saved=sel.map(i=>({...st[i]}));
        for(const i of sel){st[i].cnt++;st[i].last=d;st[i].sum+=values[d];}
        if(dfs(d+1))return true;sel.forEach((i,j)=>{st[i]=saved[j];});}
      return false;}
    if(cand.length>COVERAGE.maxCandidates)return null;
    try{return dfs(0);}catch(e){if(e===0)return null;throw e;}
  }
  function solveOnce(problem){
    const t0=now();
    const P=problem;const N=P.dates.length;
    const D=DEFAULT_WEIGHTS,pw=P.weights||{};
    const opt={maxDays:P.maxDays??8,minGap:P.minGap??3,mode:P.mode||"strict",overW:pw.over??D.over,shortW:pw.short??D.short,dayW:pw.day??D.day};
    const W={actual:pw.actual??D.actual,weekend:pw.weekend??D.weekend,avoid:pw.avoid??D.avoid,prefer:pw.prefer??D.prefer,balanceServis:pw.balanceServis??D.balanceServis,balanceAcil:pw.balanceAcil??D.balanceAcil,hard0:pw.hard??D.hard,switch:pw.switch??D.switch,posted:pw.posted??D.posted};
    const timeLimit=P.timeLimitMs??6000;
    const persons=P.persons.filter(p=>p.target>0&&p.cats.length);
    const values={};for(const c of CATS)values[c]=P.fmsByDate.map(f=>f==null?null:f*P.factors[c]);
    const proof=[];
    /* --- kanıtlı imkânsızlık ön kontrolleri --- */
    for(const p of persons){
      const reach=p.cats.map(c=>({c,max:maxReachable(values[c],p.blockedArr,opt)}));
      const bestReach=Math.max(...reach.map(r=>r.max));
      if(opt.mode!=="defer"&&bestReach+1e-9<p.target)proof.push({kind:"person",pid:p.pid,message:`${p.name}: hakediş ${p.target} eşdeğer saat; izin/engeller, en çok ${opt.maxDays} gün ve iki tam gün dinlenme kuralıyla ${p.cats.join("/")} kategorisinde en fazla ${bestReach} eşdeğer saat yazılabilir.`});
    }
    for(let d=0;d<N;d++)for(const c of CATS){
      const mn=P.daily[d]?.[c]?.min;if(!mn)continue;
      if(P.fmsByDate[d]==null){proof.push({kind:"day",date:P.dates[d],cat:c,message:`${P.dates[d]}: ${c} asgari ${mn}, fakat bu günün FMS değeri doğrulanmadığı için resmî nöbet yazılamıyor.`});continue;}
      const cand=persons.filter(p=>p.cats.includes(c)&&!p.blockedArr[d]).length;
      if(cand<mn)proof.push({kind:"day",date:P.dates[d],cat:c,message:`${P.dates[d]}: ${c} için asgari ${mn} kişi gerekli, kurallara göre o gün yazılabilecek ${cand} kişi var.`});
    }
    /* kapasite: yalnız Acil (veya yalnız Servis) kişilerinin en az gün ihtiyacı toplamı > o kategorinin günlük üst sınırları toplamı */
    for(const c of CATS){
      const only=persons.filter(p=>p.cats.length===1&&p.cats[0]===c);
      let need=0,unknown=false;for(const p of only){const m=minDaysNeeded(values[c],p.blockedArr,p.target,opt);if(m==null){unknown=true;break;}need+=m;}
      if(unknown||opt.mode==="defer")continue;
      let capSum=0,hasCap=true;for(let d=0;d<N;d++){const mx=P.daily[d]?.[c]?.max;if(mx==null){hasCap=false;break;}capSum+=P.fmsByDate[d]==null?0:mx;}
      if(hasCap&&need>capSum)proof.push({kind:"capacity",cat:c,message:`${c}: yalnız ${c} kategorisine yazılabilen kişilerin hakedişi için en az ${need} kişi-gün gerekiyor; günlük üst sınırlar toplamı ${capSum}.`});
    }
    /* kategori kapsama kanıtı: yalnız devirsiz modda ve başka kanıt yokken; sonuçsuz kalırsa hiçbir şey iddia edilmez */
    if(!proof.length&&opt.mode!=="defer"&&P.coverageProof!==false)for(const c of CATS){
      const need=P.dates.map((_,d)=>P.fmsByDate[d]==null?0:(P.daily[d]?.[c]?.min||0));if(!need.some(x=>x>0))continue;
      const reachOf=p=>maxReachable(values[c],p.blockedArr,opt);
      const cand=persons.filter(p=>p.cats.includes(c)&&reachOf(p)+1e-9>=p.target);
      const r=coverageSearch(values[c],cand,need,opt,P.coverageMs??COVERAGE.ms,P.coverageNodes??COVERAGE.nodes);
      if(r===false){const out=persons.filter(p=>p.cats.includes(c)&&!cand.includes(p)).map(p=>({p,mx:reachOf(p)})).sort((a,b)=>b.p.target-a.p.target);
        const days=need.filter(x=>x>0).length;
        proof.push({kind:"coverage",cat:c,candidates:cand.map(p=>p.pid),message:`${c}: asgari kadro isteyen ${days} günün hepsine ${c} nöbetçisi yazılamıyor (kesin arama). ${c}'e yazılabilecek kişiler — hakedişini ${c}'te tamamlayabilenler — yalnız ${cand.length} kişi: ${cand.map(p=>`${p.name} (hakediş ${p.target})`).join(", ")||"yok"}; bunlar en çok ${opt.maxDays} gün ve iki tam gün dinlenme kuralıyla bu günleri kapsayamıyor.${out.length?` Diğer ${c} yetkili kişilerin hakedişi ${c}'te tamamlanamıyor: ${out.slice(0,6).map(x=>`${x.p.name} (hakediş ${x.p.target}, ${c}'te en çok ${x.mx})`).join(", ")}${out.length>6?` ve ${out.length-6} kişi daha`:""}.`:""} Seçenekler: bazı günler için ${c} asgari değerini değiştirmek (Adım 3 → Belirli günler için farklı sınır), onaylı devir modu ya da kurum kararı.`});}
    }
    if(proof.length)return{status:"infeasible",proof,assignments:[],stats:{elapsedMs:Math.round(now()-t0)}};
    /* --- ceza fiyatları --- */
    const load={Servis:new Array(N).fill(0),Acil:new Array(N).fill(0)};
    const mult={Servis:new Array(N).fill(W.hard0),Acil:new Array(N).fill(W.hard0)};
    const lim=(c,d)=>P.daily[d]?.[c]||{};
    function phi(c,d,L){const l=lim(c,d);const M=mult[c][d];let v=(c==="Servis"?W.balanceServis:W.balanceAcil)*L*L;if(l.max!=null&&L>l.max)v+=M*(L-l.max)*(L-l.max+1)/2*2;if(l.min!=null&&L<l.min)v+=M*(l.min-L)*(l.min-L+1)/2*2;return v;}
    function marginal(c,d){return phi(c,d,load[c][d]+1)-phi(c,d,load[c][d]);}
    function violations(){let v=0;const list=[];for(const c of CATS)for(let d=0;d<N;d++){const l=lim(c,d);const L=load[c][d];if(l.max!=null&&L>l.max){v+=L-l.max;list.push({c,d,type:"max",by:L-l.max});}if(l.min!=null&&L<l.min&&P.fmsByDate[d]!=null){v+=l.min-L;list.push({c,d,type:"min",by:l.min-L});}}return{v,list};}
    function personDayCost(p,c,d){
      if(p.blockedArr[d]||P.fmsByDate[d]==null)return Infinity;
      let x=marginal(c,d);
      if(p.actualDates?.[c]?.has(d))x-=W.actual;else if(p.actualDatesAny?.has(d))x-=W.actual*0.4;
      if(p.avoid?.has(d))x+=W.avoid;if(p.prefer?.has(d))x-=W.prefer;
      if(p.posted?.[c]?.has(d))x-=W.posted;
      if(P.weekend&&P.weekend[d])x+=W.weekend;
      return x;
    }
    const sched=new Map();
    function apply(p,s,sign){if(!s)return;for(const d of s.days)load[s.cat][d]+=sign;}
    function best(p){let b=null;for(const c of p.cats){const cost=new Array(N);for(let d=0;d<N;d++)cost[d]=personDayCost(p,c,d);const r=bestSchedule(values[c],cost,p.target,opt);if(!r)continue;const cur=sched.get(p.pid);const sw=cur&&cur.cat!==c?W.switch:0;const tot=r.cost+sw;if(!b||tot<b.cost-1e-9)b={...r,cost:tot,cat:c};}return b;}
    const rand=rng(P.seed||12345);
    const order=[...persons].sort((a,b)=>(a.cats.length-b.cats.length)||(b.target-a.target));
    let bestSol=null,sweeps=0,restarts=0;
    const record=()=>{const vio=violations();let obj=0;for(const p of persons){const s=sched.get(p.pid);if(s)obj+=s.over*opt.overW+s.shortfall*opt.shortW;}
      let bal=0;for(const c of CATS)for(let d=0;d<N;d++)bal+=load[c][d]*load[c][d]*(c==="Servis"?W.balanceServis:W.balanceAcil);
      const score=vio.v*1e6+obj*10+bal;
      if(!bestSol||score<bestSol.score-1e-9)bestSol={score,vio:vio.v,vioList:vio.list,obj,bal,sched:new Map([...sched].map(([k,v])=>[k,{...v,days:[...v.days]}]))};};
    outer:
    for(;;){
      for(const p of order){const s=best(p);if(s){sched.set(p.pid,s);apply(p,s,1);}}
      let stable=0;
      for(let it=0;it<400;it++){
        sweeps++;let changed=false;
        const ord=[...order];for(let i=ord.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[ord[i],ord[j]]=[ord[j],ord[i]];}
        for(const p of ord){const cur=sched.get(p.pid);apply(p,cur,-1);const s=best(p);const same=cur&&s&&cur.cat===s.cat&&cur.days.join()===s.days.join();if(s&&!same){sched.set(p.pid,s);changed=true;}const fin=sched.get(p.pid);apply(p,fin,1);}
        const vio=violations();
        record();
        if(vio.v===0&&!changed){stable++;if(stable>=2)break;}
        if(vio.v>0){for(const x of vio.list)mult[x.c][x.d]=Math.min(mult[x.c][x.d]*1.6+5,1e6);}
        if(now()-t0>timeLimit)break outer;
      }
      if(bestSol&&bestSol.vio===0)break;
      if(now()-t0>timeLimit)break;
      /* yeniden başlat: yükleri sıfırla, karıştırılmış sırayla */
      restarts++;for(const c of CATS){load[c].fill(0);}sched.clear();
      for(let i=order.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
      if(restarts>50)break;
    }
    const elapsedMs=Math.round(now()-t0);
    if(!bestSol)return{status:"not_found",proof:[],assignments:[],stats:{elapsedMs,sweeps,restarts}};
    const assignments=[];for(const p of persons){const s=bestSol.sched.get(p.pid);if(!s)continue;for(const d of s.days)assignments.push({pid:p.pid,date:P.dates[d],category:s.cat,fms:P.fmsByDate[d],eq:values[s.cat][d]});}
    const perPerson=persons.map(p=>{const s=bestSol.sched.get(p.pid);return{pid:p.pid,category:s?s.cat:null,total:s?s.total:0,target:p.target,over:s?s.over:0,shortfall:s?s.shortfall:p.target,days:s?s.days.length:0};});
    return{status:bestSol.vio===0?"feasible":"not_found",residual:bestSol.vioList.map(x=>({date:P.dates[x.d],cat:x.c,type:x.type,by:x.by})),assignments,perPerson,proof:[],stats:{elapsedMs,sweeps,restarts,objective:Math.round(bestSol.obj*100)/100,balance:Math.round(bestSol.bal*100)/100,persons:persons.length,timeLimitMs:timeLimit}};
  }
  const r2=x=>Math.round(x*100)/100;
  /* Kişi bazlı alt sınır (devirsiz mod): her kişinin izin verilen kategorilerindeki en küçük kaçınılmaz fazlası. */
  function overLowerBound(problem){
    const opt={maxDays:problem.maxDays??8,minGap:problem.minGap??3};const values={};for(const c of CATS)values[c]=problem.fmsByDate.map(f=>f==null?null:f*problem.factors[c]);
    const per={};let lb=0;
    for(const p of problem.persons){if(!(p.target>0)||!p.cats.length)continue;const by={};for(const c of p.cats)by[c]=overFloor(values[c],p.blockedArr,p.target,opt);const fin=Object.values(by).filter(v=>v!=null);per[p.pid]=by;if(fin.length)lb+=Math.min(...fin);}
    return{lb:r2(lb),per};
  }
  /* KATEGORİ İYİLEŞTİRME (3.2.1 — kullanıcı isteği 14.10.2026: “tüm olası varyasyonlar denenmeli”). Karma (iki kategoride de çalışmış) kişiler için:
     (1) TEKLİ değişiklik: fazlası öbür kategoride azalabilecek kişi (kazançlı aday);
     (2) KOMBİNASYONLAR: kazançlı adayların tüm alt kümeleri ve kazançlı aday + “yardımcı” kaydırmalar — kendi fazlası azalmayan ama öbür
         kategoriye geçerek yer açan kişi (Servis'teki biri Acil'e, Acil'deki biri Servis'e; kullanıcının örneği). Olası kazancı büyük olan,
         ters yönde takas içeren ve küçük kümeler önce denenir; denenen kümenin dışındaki karma kişiler o anki kategorilerinde sabit tutulur.
     Her KABULDEN sonra adaylar yeniden hesaplanıp baştan denenir (Eylül 2026 gerçek verisi: tek başına reddedilen bir aday, başka bir kabulden sonra 36 → 32 ederdi).
     Kişi bazlı alt sınıra ulaşılınca durulur (daha iyisi imkânsız). Yalnız geçerli ve amacı KESİN düşüren sonuç kabul edilir; süre bütçesi
     biterse en iyi bulunan döner. Sıra belirlenimci. */
  function improveCategories(problem,first,lbInfo,t0){
    let r=first,P=problem;const tried=[],accepted=[];const budget=Math.min(IMPROVE.ms,problem.timeLimitMs??6000);
    const overOf=x=>r2((x.perPerson||[]).reduce((z,y)=>z+(y.over||0),0));const atLB=()=>overOf(r)<=lbInfo.lb+1e-9;const late=()=>now()-t0>budget;
    const byPid=(a,b)=>a.p.pid<b.p.pid?-1:a.p.pid>b.p.pid?1:0;
    const cands=()=>{const pp=new Map((r.perPerson||[]).map(x=>[x.pid,x]));const gain=[],help=[];
      for(const p of P.persons){if(!(p.target>0)||p.cats.length<2)continue;const cur=pp.get(p.pid);if(!cur||!cur.category)continue;
        for(const c of p.cats){if(c===cur.category)continue;const f=lbInfo.per[p.pid]?.[c];if(f==null)continue;
          if(f+1e-9<cur.over)gain.push({p,c,gain:cur.over-f});else help.push({p,c,gain:0});}}
      gain.sort((a,b)=>b.gain-a.gain||byPid(a,b));help.sort(byPid);return{gain,help};};
    const attempt=set=>{tried.push(set.map(x=>x.p.pid+">"+x.c).join("+"));const left=Math.max(500,budget-(now()-t0));
      const cur=new Map((r.perPerson||[]).map(x=>[x.pid,x.category]));const pins=new Map(set.map(x=>[x.p.pid,x.c]));
      const P2={...P,coverageProof:false,timeLimitMs:Math.min(P.timeLimitMs??6000,left),persons:P.persons.map(q=>pins.has(q.pid)?{...q,cats:[pins.get(q.pid)]}:set.length>1&&q.cats.length>1&&cur.get(q.pid)?{...q,cats:[cur.get(q.pid)]}:q)};
      const s=solveOnce(P2);
      if(s.status==="feasible"&&s.stats.objective<r.stats.objective-1e-9){for(const x of set)accepted.push({pid:x.p.pid,name:x.p.name,category:x.c,objectiveBefore:r.stats.objective,objectiveAfter:s.stats.objective});r=s;P=P2;return true;}
      return false;};
    for(let round=0;round<IMPROVE.rounds&&!atLB()&&!late();round++){
      const{gain,help}=cands();const G=gain.slice(0,IMPROVE.maxCombo),H=help.slice(0,IMPROVE.maxHelpers);const combos=[];
      for(let m=1;m<(1<<G.length);m++){const s=G.filter((_,i)=>(m>>i)&1);if(s.length>1)combos.push(s);}
      for(const g of G){for(const h of H)combos.push([g,h]);for(let i=0;i<H.length;i++)for(let j=i+1;j<H.length;j++)combos.push([g,H[i],H[j]]);}
      for(let i=0;i<G.length;i++)for(let k=i+1;k<G.length;k++)for(const h of H)combos.push([G[i],G[k],h]);
      const sc=s=>s.reduce((z,x)=>z+x.gain,0);const opp=s=>s.every(x=>x.gain>0||s.some(y=>y.gain>0&&y.c!==x.c))?1:0;
      combos.sort((a,b)=>sc(b)-sc(a)||opp(b)-opp(a)||a.length-b.length);
      let improved=false;
      for(const x of G){if(late())break;if(attempt([x])){improved=true;break;}}
      if(!improved)for(const s of combos){if(late())break;if(attempt(s)){improved=true;break;}}
      if(!improved)break;
    }
    return{r,tried,accepted,problem:P};
  }
  function solve(problem){
    const t0=now();const first=solveOnce(problem);
    if(first.status!=="feasible"||(problem.mode||"strict")==="defer")return first;
    const lbInfo=overLowerBound(problem);const overFirst=r2((first.perPerson||[]).reduce((z,x)=>z+(x.over||0),0));
    const imp=problem.improveCategories===false?{r:first,tried:[],accepted:[]}:improveCategories(problem,first,lbInfo,t0);
    const r=imp.r;const overTotal=r2((r.perPerson||[]).reduce((z,x)=>z+(x.over||0),0));
    r.stats={...r.stats,elapsedMs:Math.round(now()-t0),overFirst,overTotal,overLowerBound:lbInfo.lb,overAtLowerBound:overTotal<=lbInfo.lb+1e-9,categoryTries:imp.tried.length,categoryFixed:imp.accepted};
    return r;
  }
  return{solve,solveOnce,bestSchedule,maxReachable,minDaysNeeded,overFloor,overLowerBound,improveCategories,coverageSearch,DEFAULT_WEIGHTS,COVERAGE,IMPROVE};
});
