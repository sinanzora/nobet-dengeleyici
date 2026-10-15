/* BAĞIMSIZ DENETÇİ — çözücü ve motor kodunu KULLANMAZ; ham ay verisinden kuralları yeniden sayar.
   Girdi: veritabanı (db), ay durumu (M) ve herhangi bir resmî çizelge (çözücü çıktısı veya elle girilmiş). */
(function(root,factory){const api=factory(root.NobetCore);if(typeof module==="object"&&module.exports)module.exports=api;root.NobetAuditor=api;})(typeof globalThis!=="undefined"?globalThis:this,function(C){
  "use strict";
  if(!C&&typeof require==="function")C=require("./core.js");
  const issue=(level,code,message,extra={})=>({level,code,message,...extra});
  /* kategori: yalnız Türkçe-katlamalı metin üzerinden (SERVİS/ACİL/YENİDOĞAN/KIDEMLİ/YOĞUN BAKIM büyük harf dahil) */
  function categoryOf(v){const f=C.fold(v);if(!f)return"";if(/acil|yogun bakim|yenidogan|kidemli/.test(f))return"Acil";if(/servis/.test(f))return"Servis";return"";}
  function pidOf(db,name){const k=C.fold(name);if(!k)return"";return(db.aliases&&db.aliases[k])||`p:${k}`;}

  /* tablo değeri; 3.0 oturumunda yetkili kuralı anahtarı (halfday/daytime) hiç yoksa varsayılan — motordan bağımsız */
  function tab(db,k){const t=db.global.fmsTable||C.DEFAULT_FMS_TABLE;return C.num(k in t?t[k]:(k==="halfday"||k==="daytime")?C.DEFAULT_FMS_TABLE[k]:null);}
  function dow(date){return new Date(Date.UTC(+date.slice(0,4),+date.slice(5,7)-1,+date.slice(8,10))).getUTCDay();}
  function fmsOfDate(db,M,date){
    const h=(M.settings.holidays||[]).find(x=>x.date===date);const wd=dow(date);
    /* yetkili 14.10.2026: arefe hafta içinde 19 (24 − 5 saat mesai), hafta sonunda günün normal değeri */
    if(h&&h.kind==="yarım gün")return wd===0||wd===6?tab(db,String(wd)):tab(db,"halfday");
    if(h)return h.confirmed&&C.num(h.fms)!=null?C.num(h.fms):null;
    return tab(db,String(wd));
  }
  /* saatli görevin türü (motordan bağımsız): gece = gece yarısını geçer; gündüz = 08–09 arası başlar, 16–17 arası biter */
  function hm(x){const m=/^(\d\d):(\d\d)$/.exec(x||"");return m?+m[1]*60+ +m[2]:null;}
  function shiftKind(s){const a=hm(s.start),b=hm(s.end);if(a==null||b==null)return"other";if(b<=a)return"night";if(a>=480&&a<=540&&b>=960&&b<=1020)return"day";return"other";}
  function shiftDayType(M,date){const h=(M.settings.holidays||[]).find(h=>h.date===date);if(h)return h.kind==="yarım gün"?"halfday":"holiday";const wd=C.weekday(date);return wd===0?"sunday":wd===6?"saturday":wd===5?"friday":"weekday";}
  /* Bağımsız fiilî hakediş hesabı */
  function earnedByPerson(db,M){
    const factors=db.global.factors||{Servis:1,Acil:1.5};
    const rows=(M.actual||[]).filter(r=>r.status!=="ignored"&&C.isYmd(r.date)&&String(r.date).startsWith(M.month));
    const out=new Map();
    /* aynı kişi-gün grubu: grupta en az bir TAM (özel saatsiz) kayıt varsa yalnız ilk tam kayıt sayılır; diğerleri (elle FMS verilmedikçe) 0 */
    const isFullRec=r=>!r.shift||(r.shift.start==="08:00"&&r.shift.end==="08:00");
    const groups=new Map();for(const r of rows){const k=`${pidOf(db,r.rawName)}|${r.date}`;(groups.get(k)||groups.set(k,[]).get(k)).push(r);}
    const zeroed=new Set();for(const g of groups.values()){if(g.length<2)continue;const keep=g.find(isFullRec);if(!keep)continue;for(const r of g)if(r!==keep&&!(r.fmsOverride!=null&&r.fmsOverride!==""))zeroed.add(r);}
    /* iki yerde saatli nöbet (kullanıcı kuralı 14.10.2026; motordan bağımsız): aynı kişi-gün, hepsi saatli (oryantasyon/elle FMS yok), en az iki farklı bölüm → tek tam nöbet, kategori Acil */
    const isPart=r=>!!(r.shift&&!(r.shift.start==="08:00"&&r.shift.end==="08:00"))&&!r.orientation&&!(r.fmsOverride!=null&&r.fmsOverride!=="");
    /* yetkili 14.10.2026: yalnız Cumartesi/Pazar ve Servis karışmadan; aksi gün birleştirilmez ve FMS'i bilinmiyor sayılır */
    const split=new Map(),badSplit=new Set();for(const g of groups.values()){if(g.length<2||!pidOf(db,g[0].rawName))continue;if(g.every(r=>isPart(r)&&C.CATEGORY_OF_UNIT[r.unit])&&new Set(g.map(r=>r.unit)).size>=2){
      const wd=dow(g[0].date);if(wd!==0&&wd!==6||g.some(r=>categoryOf(r.unit)==="Servis")){for(const r of g)badSplit.add(r);continue;}
      const keep=g.find(r=>C.CATEGORY_OF_UNIT[r.unit]==="Acil")||g[0];for(const r of g)split.set(r,r===keep);}}
    const offDay=d=>{const wd=dow(d);if(wd===0||wd===6)return true;const h=(M.settings.holidays||[]).find(x=>x.date===d);return!!h&&h.kind!=="yarım gün";};
    for(const r of rows){
      const pid=pidOf(db,r.rawName);const sp=split.get(r);const cat=sp!==undefined?"Acil":categoryOf(r.category||r.unit);
      const e=out.get(pid)||out.set(pid,{pid,eq:0,complete:true,cats:new Set(),dates:new Set(),rows:0}).get(pid);
      e.rows++;e.dates.add(r.date);
      let fms=null;let duty=true;
      const isFull=!r.shift||(r.shift.start==="08:00"&&r.shift.end==="08:00");
      if(badSplit.has(r))fms=null;
      else if(sp===true)fms=fmsOfDate(db,M,r.date);
      else if(sp===false)fms=0;
      else if(r.fmsOverride!=null&&r.fmsOverride!=="")fms=C.num(r.fmsOverride);
      else if(r.orientation)fms=fmsOfDate(db,M,r.date);/* kullanıcı kararı 14.10.2026: oryantasyon her zaman gerçek nöbet */
      else if(!isFull){const kind=shiftKind(r.shift);
        if(kind==="night")fms=null;
        else if(kind==="day"&&offDay(r.date))fms=tab(db,"daytime");
        else{const rule=(db.global.specialShiftRules||[]).find(x=>x.start===r.shift.start&&x.end===r.shift.end);fms=rule?C.num(rule.fms[shiftDayType(M,r.date)]):null;}}
      else fms=fmsOfDate(db,M,r.date);
      if(zeroed.has(r))fms=0;
      if(fms==null||!cat){e.complete=false;continue;}
      if(duty&&!r.orientation)e.cats.add(cat);
      e.eq+=fms*(factors[cat]??NaN);
    }
    for(const[pid,e]of out){const st=M.staff?.[pid]||{};const ov=st.earnedOverride?C.num(st.earnedOverride.value):null;e.computed=e.complete?C.round2(e.eq):null;e.target=ov!=null?ov:e.computed;}
    return out;
  }
  /* nöbetten sonra 2 tam gün boş → yalnız geçen ayın son 2 günü bu ayı etkiler (3. gün öncesinin kapattığı günler geçen ayda kalır) */
  function lastDaysOfPrev(month){const prev=C.prevMonth(month);return C.monthDates(prev).slice(-2);}

  function audit(db,M,assignments,opts={}){
    const out=[];const month=M.month;const dates=C.monthDates(month);const s=M.settings||{};
    const roster=(assignments||[]).map(a=>({...a,pid:a.pid||pidOf(db,a.name),cat:categoryOf(a.category)}));
    const earned=earnedByPerson(db,M);
    /* --- önceki ay resmî kaydı durumu (T21) --- */
    const lists={Servis:M.priorOfficial?.Servis,Acil:M.priorOfficial?.Acil};
    /* 3.3.2: “hepsi burada” onayı yok — son 2 gün için bilinen resmî nöbet varsa kayıt tam kabul edilir, yoksa eksik (motordan bağımsız) */
    const pl3=lastDaysOfPrev(month);
    const knownDuty=["Servis","Acil"].some(c=>((lists[c]&&lists[c].persons)||[]).some(p=>(p.duties||[]).some(d=>pl3.includes(d.date))))||(M.priorManual||[]).some(x=>x.kind==="duty"&&pl3.includes(x.date));const complete=knownDuty;
    /* gün başı makullük (FABLE T13-2): her gün bilinen resmî nöbetçi sayısı bu ayın günlük asgari toplamından az olmamalı */
    const minDay=(C.num(s.serviceMin)||0)+(C.num(s.emergencyMin)||0);const perDay=new Map(pl3.map(d=>[d,new Set()]));
    for(const c of["Servis","Acil"])for(const p of((lists[c]&&lists[c].persons)||[]))for(const d of p.duties||[])if(perDay.has(d.date))perDay.get(d.date).add(pidOf(db,p.name));
    for(const x of M.priorManual||[])if(x.kind==="duty"&&perDay.has(x.date))perDay.get(x.date).add(x.pid);
    const thinDays=[...perDay].filter(([d,set])=>set.size<minDay);
    if(!knownDuty)out.push(issue("warning","PRIOR_MISSING",`${C.monthLabel(C.prevMonth(month))} ayının son 2 günündeki resmî nöbetler girilmedi (Adım 1 → ②: geçen ayın program çıktısı ya da elle işaretleme): ay başı sınırı DOĞRULANMADI. Çizelge 'tam denetlendi / üretime hazır' sayılamaz.`,{incomplete:true}));
    else if(!(lists.Servis&&lists.Acil)&&(M.priorManual||[]).some(x=>x.kind==="duty"&&pl3.includes(x.date)))out.push(issue("info","PRIOR_MANUAL_ONLY",`${C.monthLabel(C.prevMonth(month))} ayının son 2 günündeki resmî nöbetler elle girildi: Tam (elle girildi). Ay başı sınırı girilen kayıtlara göre kontrol edildi.`));
    if(knownDuty&&thinDays.length)out.push(issue("warning","PRIOR_DAY_THIN",`${C.monthLabel(C.prevMonth(month))} son 2 gün için ${thinDays.map(([d,set])=>`${C.fmtDate(d)}: ${set.size} kişi`).join(", ")} biliniyor; bu ayın günlük asgarisine göre (Servis ${C.num(s.serviceMin)||0} + Acil ${C.num(s.emergencyMin)||0}) her gün en az ${minDay} beklenirdi. Eksik kişi varsa Adım 1 → ② bölümünde ekleyin. Ay başı sınırı girilen kayıtlara göre kontrol edildi; tam doğrulanmış sayılmadı.`,{incomplete:true}));
    /* bağımsız ay sınırı engelleri */
    const last3=new Set(lastDaysOfPrev(month));const bnd=new Map();const addB=(pid,date,why)=>{if(!date.startsWith(month))return;(bnd.get(pid)||bnd.set(pid,[]).get(pid)).push({date,why});};
    const rosterPids=new Set(roster.map(a=>a.pid));const staffPids=new Set([...earned.keys(),...rosterPids]);
    const noneConfirmed=new Set((M.priorManual||[]).filter(x=>x.kind==="none").map(x=>`${x.pid}|${x.date}`));
    for(const cat of["Servis","Acil"]){const src=lists[cat];if(!src)continue;for(const p of src.persons||[]){
      const pid=pidOf(db,p.name);
      for(const d of p.duties||[]){if(!last3.has(d.date))continue;addB(pid,C.addDays(d.date,1),`önceki ay ${C.fmtDate(d.date)} resmî ${cat} nöbeti`);addB(pid,C.addDays(d.date,2),`önceki ay ${C.fmtDate(d.date)} resmî ${cat} nöbeti (2 tam gün)`);}
      for(const md of p.boundaryMissing||[]){if(noneConfirmed.has(`${pid}|${md}`))continue;const hit=roster.filter(a=>a.pid===pid&&(a.date===C.addDays(md,1)||a.date===C.addDays(md,2)));
        if(hit.length)out.push(issue("error","BOUNDARY_UNCERTAIN_VIOLATION",`${p.name}: ${C.fmtDate(md)} PROBEL hücresi eksik/belirsiz iken ${hit.map(a=>C.fmtDate(a.date)).join(", ")} resmî nöbet yazılmış. Önce teyit edin.`));
        else out.push(issue("warning","BOUNDARY_UNCERTAIN",`${p.name}: ${C.fmtDate(md)} PROBEL hücresi eksik/belirsiz — 'nöbet yok' sayılmadı; teyit bekleniyor.`,{incomplete:true}));}
      if(!staffPids.has(pid)){
        for(const sp of staffPids){const nm=db.people?.[sp]?.name||sp.slice(2);const sim=C.nameSimilarity(p.name,nm);if(!sim||sim.kind==="same")continue;const rk=[C.fold(p.name),C.fold(nm)].sort().join("|");if(db.aliasRejected&&db.aliasRejected[rk])continue;
          const relevant=(p.duties||[]).some(d=>last3.has(d.date))||(p.boundaryMissing||[]).length;if(!relevant)continue;
          const hits=roster.filter(a=>a.pid===sp&&(p.duties||[]).some(d=>last3.has(d.date)&&(a.date===C.addDays(d.date,1)||a.date===C.addDays(d.date,2))));
          if(hits.length)out.push(issue("error","BOUNDARY_MATCH_VIOLATION",`Önceki ay PROBEL'de '${p.name}' ay sonu nöbetli; olası aynı kişi '${nm}' ${hits.map(a=>C.fmtDate(a.date)).join(", ")} yazılmış. Kimlik eşleşmesi onaylanmadan bu tarih güvenli değil.`));
          else out.push(issue("warning","BOUNDARY_MATCH_PENDING",`Önceki ay PROBEL'deki '${p.name}' bu ayın listesinde birebir yok; olası eşleşme '${nm}' (${sim.reason}). Ay sınırı güvenli tarafta uygulandı; eşleşmeyi onaylayın veya reddedin.`,{incomplete:true}));}
      }
    }}
    for(const x of M.priorManual||[])if(x.kind==="duty"){addB(x.pid,C.addDays(x.date,1),`önceki ay ${C.fmtDate(x.date)} resmî nöbet (elle girildi)`);addB(x.pid,C.addDays(x.date,2),`önceki ay ${C.fmtDate(x.date)} resmî nöbet (elle girildi, 2 tam gün)`);
      /* elle girilen ad bu ayın listesinde yoksa: olası aynı kişi (benzer ad) için PROBEL yoluyla aynı denetim */
      if(!staffPids.has(x.pid)&&last3.has(x.date)){const mn=db.people?.[x.pid]?.name||String(x.pid).slice(2);
        for(const sp of staffPids){const nm=db.people?.[sp]?.name||sp.slice(2);const sim=C.nameSimilarity(mn,nm);if(!sim||sim.kind==="same")continue;const rk=[C.fold(mn),C.fold(nm)].sort().join("|");if(db.aliasRejected&&db.aliasRejected[rk])continue;
          const hits=roster.filter(a=>a.pid===sp&&(a.date===C.addDays(x.date,1)||a.date===C.addDays(x.date,2)));
          if(hits.length>0)out.push(issue("error","BOUNDARY_MATCH_VIOLATION",`Önceki ay ${C.fmtDate(x.date)} resmî nöbeti elle '${mn}' adıyla girildi; olası aynı kişi '${nm}' ${hits.map(a=>C.fmtDate(a.date)).join(", ")} yazılmış. Kimlik eşleşmesi onaylanmadan bu tarih güvenli değil.`));
          else out.push(issue("warning","BOUNDARY_MATCH_PENDING",`Elle girilen ay sonu adı '${mn}' bu ayın listesinde birebir yok; olası eşleşme '${nm}' (${sim.reason}). Ay sınırı güvenli tarafta uygulandı; eşleşmeyi onaylayın veya reddedin.`,{incomplete:true}));}}}
    /* sonraki ayın mevcut resmî kaydı (varsa): ilk iki günündeki nöbetler bu ayın son günlerini kapatır */
    for(const n of(opts.nextFirstDuties||[])){for(let k=1;k<=2;k++){const back=C.addDays(n.date,-k);if(back.startsWith(month))(bnd.get(n.pid)||bnd.set(n.pid,[]).get(n.pid)).push({date:back,why:`sonraki ay ${C.fmtDate(n.date)} resmî ${n.cat} nöbeti`});}}
    /* --- görev bazlı kesin kurallar --- */
    const byPerson=new Map();const pd=new Set();
    const day={};dates.forEach(d=>day[d]={Servis:new Set(),Acil:new Set(),tasks:{Servis:0,Acil:0}});
    const fac=db.global.factors||{Servis:1,Acil:1.5};
    for(const a of roster){
      const nm=a.name||db.people?.[a.pid]?.name||a.pid;
      if(!a.pid){out.push(issue("error","NAME_EMPTY",`Resmî görev ${a.id||""}: personel adı boş.`));continue;}
      if(!a.date||!a.date.startsWith(month)){out.push(issue("error","OUTSIDE_MONTH",`${nm}: ${a.date} seçili ay dışında.`));continue;}
      if(!a.cat){out.push(issue("error","CATEGORY_INVALID",`${nm} ${C.fmtDate(a.date)}: kategori '${a.category}' Servis veya Acil değil.`));continue;}
      (byPerson.get(a.pid)||byPerson.set(a.pid,[]).get(a.pid)).push(a);
      const k=`${a.pid}|${a.date}`;if(pd.has(k))out.push(issue("error","DUPLICATE_PERSON_DAY",`${nm} ${C.fmtDate(a.date)}: aynı kişi aynı gün birden fazla resmî görev.`));pd.add(k);
      day[a.date][a.cat].add(a.pid);day[a.date].tasks[a.cat]++;
      const f=fmsOfDate(db,M,a.date);
      if(f==null)out.push(issue("error","FMS_DATE_UNVERIFIED",`${nm} ${C.fmtDate(a.date)}: bu günün FMS değeri onaylı değil (resmî tatil?).`));
      else if(C.num(a.fms)!==f)out.push(issue("error","FMS_MISMATCH",`${nm} ${C.fmtDate(a.date)}: görev FMS ${a.fms}, kural tablosu ${f}.`));
      if(f!=null&&a.eq!=null&&Math.abs(C.num(a.eq)-f*fac[a.cat])>0.001)out.push(issue("error","EQ_MISMATCH",`${nm} ${C.fmtDate(a.date)}: eşdeğer saat ${a.eq}, olması gereken ${f*fac[a.cat]}.`));
      if((M.exclusions||[]).includes(a.pid))out.push(issue("error","EXCLUDED",`${nm}: bu ay hariç tutulan personel, ${C.fmtDate(a.date)} görev yazılmış.`));
      for(const l of M.leaves||[])if(l.pid===a.pid&&a.date>=l.start&&a.date<=l.end)out.push(issue("error","ON_LEAVE",`${nm} ${C.fmtDate(a.date)}: ${l.kind||"izin"} (${C.fmtDate(l.start)}–${C.fmtDate(l.end)}) içinde.`));
      for(const u of M.unavailable||[])if(u.pid===a.pid&&u.mode==="blocked"&&a.date>=u.start&&a.date<=u.end)out.push(issue("error","UNAVAILABLE",`${nm} ${C.fmtDate(a.date)}: kesin müsait değil olarak işaretli.`));
      const only=(M.unavailable||[]).filter(u=>u.pid===a.pid&&u.mode==="only");if(only.length&&!only.some(u=>a.date>=u.start&&a.date<=u.end))out.push(issue("error","UNAVAILABLE",`${nm} ${C.fmtDate(a.date)}: yalnız belirtilen aralıklarda müsait.`));
      const st=M.staff?.[a.pid]||{};if(st.startDate&&a.date<st.startDate)out.push(issue("error","NOT_STARTED",`${nm} ${C.fmtDate(a.date)}: görev başlangıcı ${C.fmtDate(st.startDate)}.`));if(st.endDate&&a.date>st.endDate)out.push(issue("error","ENDED",`${nm} ${C.fmtDate(a.date)}: görev bitişi ${C.fmtDate(st.endDate)}.`));
      for(const b of bnd.get(a.pid)||[])if(b.date===a.date)out.push(issue("error","BOUNDARY",`${nm} ${C.fmtDate(a.date)}: ${b.why} — iki tam gün dinlenme sağlanmıyor.`));
      for(const cat of["Servis","Acil"]){const src=M.currentOfficial?.[cat];if(!src)continue;for(const p of src.persons||[]){if(pidOf(db,p.name)!==a.pid)continue;for(const b of p.blocks||[])if(b.date===a.date)out.push(issue("error","PROBEL_LEAVE",`${nm} ${C.fmtDate(a.date)}: bu ayın PROBEL kaydında '${b.label}'.`));if(s.respectCurrentProbelNsi!==false&&(p.nsi||[]).includes(a.date))out.push(issue("error","PROBEL_NSI",`${nm} ${C.fmtDate(a.date)}: bu ayın PROBEL kaydında NSİ (nöbet ertesi izin) günü.`));}}
    }
    for(const[pid,arr]of byPerson){
      const nm=arr[0].name||db.people?.[pid]?.name||pid;
      const ds=C.uniq(arr.map(a=>a.date)).sort();
      if(ds.length>(db.global.maxDutyDays||8))out.push(issue("error","MAX_DAYS",`${nm}: ${ds.length} farklı resmî nöbet günü; kesin üst sınır ${db.global.maxDutyDays||8}.`));
      for(let i=1;i<ds.length;i++){const g=C.dateDiff(ds[i-1],ds[i]);if(g<(db.global.minGapDays||3))out.push(issue("error","REST",`${nm}: ${C.fmtDate(ds[i-1])} → ${C.fmtDate(ds[i])} arasında yalnız ${Math.max(0,g-1)} tam boş gün (en az 2 gerekli).`));}
      const cats=C.uniq(arr.map(a=>a.cat));
      if(cats.length>1)out.push(issue("error","SINGLE_CATEGORY",`${nm}: resmî çizelgede birden fazla kategori (${cats.join(" + ")}); her personel tek kategoride olmalı.`));
      const e=earned.get(pid);const hist=e?[...e.cats]:[];const auth=M.staff?.[pid]?.authorizedCategory;
      for(const c of cats){
        if(hist.length===1&&c!==hist[0])out.push(issue("error","CATEGORY_SOURCE",`${nm}: fiilî kaynakta yalnız ${hist[0]} var; resmî ${c} kategorisine yazılamaz.`));
        if(hist.length===0&&auth!==c)out.push(issue("error","CATEGORY_AUTH",`${nm}: fiilî kaynakta sayılan nöbet yok; ${c} Adım 2'de kategori seçilmemiş.`));
      }
      if(!e||!(e.target>0))out.push(issue("error","UNWORKED",`${nm}: bu ay fiilî hakedişi yok/0; resmî nöbet yazılması çalışılmamış nöbeti ücretli göstermek olur.`));
      const official=arr.reduce((z,a)=>z+(fmsOfDate(db,M,a.date)||0)*(fac[a.cat]||0),0);
      if(e&&e.target!=null){
        const settle=M.staff?.[pid]?.settlePrior?openOf(M,pid):0;
        const need=e.target+settle;const short=C.round2(need-official);
        if(short>0.001){
          if(s.mode!=="defer")out.push(issue("error","ENTITLEMENT_LOSS",`${nm}: kazanılan ${C.fmtNum(need)} eşdeğer saat, resmî karşılık ${C.fmtNum(official)}; ${C.fmtNum(short)} saat eksik (devirsiz mod).`));
          else{const st=M.staff?.[pid]||{};if(st.paymentStatus==="paid")out.push(issue("info","SHORT_PAID",`${nm}: ${C.fmtNum(short)} saat fark bordroda ödenmiş işaretli; devredilmez.`));else if(st.paymentStatus==="unpaid"&&st.deferApproved)out.push(issue("info","SHORT_DEFERRED",`${nm}: ${C.fmtNum(short)} saat sonraki aya devir (ödenmedi, devret işaretli).`));else out.push(issue("warning","SHORT_PENDING",`${nm}: ${C.fmtNum(short)} eşdeğer saat fark; ödeme durumu belli değil ya da “sonraki aya devret” işaretli değil — kesin alacak DEĞİL, mutabakat bekliyor.`,{incomplete:true}));}
        }else if(short<-0.001)out.push(issue("warning","OVERPAY",`${nm}: resmî karşılık hakedişten ${C.fmtNum(-short)} eşdeğer saat fazla.`));
      }
    }
    /* devirsiz modda hiç görev almayan ama hakedişi olan kişi */
    for(const[pid,e]of earned){if(byPerson.has(pid)||!(e.target>0))continue;const nm=db.people?.[pid]?.name||pid;if((M.exclusions||[]).includes(pid)){out.push(issue("info","EXCLUDED_EARNED",`${nm}: bu ay hariç; ${C.fmtNum(e.target)} eşdeğer saat hakediş mutabakata kalır (silinmedi).`));continue;}
      if(s.mode!=="defer")out.push(issue("error","ENTITLEMENT_LOSS",`${nm}: ${C.fmtNum(e.target)} eşdeğer saat hakediş var, resmî çizelgede hiç görev yok (devirsiz mod).`));else out.push(issue("warning","SHORT_PENDING",`${nm}: ${C.fmtNum(e.target)} eşdeğer saat hakediş resmî çizelgeye yazılmadı; mutabakat/devir bekliyor.`,{incomplete:true}));}
    /* --- günlük kadro (kişi sayısı ile görev sayısı ayrı) --- */
    for(const d of dates){
      const o=(M.dailyRequirements||[]).find(x=>x.date===d)||{};const v=(a,b)=>C.num(a)!=null?C.num(a):C.num(b);
      const sMin=v(o.serviceMin,s.serviceMin),sMax=v(o.serviceMax,s.serviceMax),eMin=v(o.emergencyMin,s.emergencyMin),eMax=v(o.emergencyMax,s.emergencyCap);
      const nS=day[d].Servis.size,nA=day[d].Acil.size;
      if(eMax!=null&&nA>eMax)out.push(issue("error","EMERGENCY_MAX",`${C.fmtDate(d)}: Acil ailesinde ${nA} farklı kişi; günlük üst sınır ${eMax}.`));
      if(eMin!=null&&nA<eMin)out.push(issue("error","EMERGENCY_MIN",`${C.fmtDate(d)}: Acil ${nA} kişi, asgari ${eMin}.`));
      if(sMin!=null&&nS<sMin)out.push(issue("error","SERVICE_MIN",`${C.fmtDate(d)}: Servis ${nS} kişi, asgari ${sMin}.`));
      if(sMax!=null&&nS>sMax)out.push(issue("error","SERVICE_MAX",`${C.fmtDate(d)}: Servis ${nS} kişi, üst sınır ${sMax}.`));
    }
    /* --- aktif ama tarihi ay dışında/boş fiilî kayıt: hakedişten sessizce düşmesin (FABLE tur12b T12b-1) --- */
    for(const r of M.actual||[])if(r.status!=="ignored"&&!(C.isYmd(r.date)&&String(r.date).startsWith(month)))out.push(issue("error","ACTUAL_DATE_OUTSIDE",`Fiilî kayıt “${r.rawName||"(adsız)"}”: tarihi ${r.date||"BOŞ"} — ${C.monthLabel(month)} dışında; hakedişe katılmadı. Tarihi düzeltin ya da “Yok say”.`));
    /* --- fiilî kayıtta dinlenme istisnası (tarihsel; değiştirilmez) --- */
    const actualBy=new Map();for(const r of(M.actual||[]).filter(r=>r.status!=="ignored"&&C.isYmd(r.date)&&String(r.date).startsWith(month))){const pid=pidOf(db,r.rawName);(actualBy.get(pid)||actualBy.set(pid,new Set()).get(pid)).add(r.date);}
    for(const[pid,set]of actualBy){const ds=[...set].sort();const pairs=[];for(let i=1;i<ds.length;i++)if(C.dateDiff(ds[i-1],ds[i])<3)pairs.push(`${C.fmtDate(ds[i-1]).slice(0,5)}→${C.fmtDate(ds[i]).slice(0,5)}`);if(pairs.length)out.push(issue("info","ACTUAL_REST_EXCEPTION",`${db.people?.[pid]?.name||pid}: fiilî kayıtta iki tam boş gün bırakmayan ${pairs.length} aralık (${pairs.join(", ")}); gerçekleşmiş kayıt olduğu için DEĞİŞTİRİLMEDİ, resmî çizelgede tekrarlanmaz.`,{pid,pairs}));}
    /* --- defter --- */
    const claims=new Map();for(const e of M.ledger||[])if(e.kind==="carry-open")claims.set(e.claimId,{units:C.num(e.units)||0,paid:0,pid:e.pid});
    for(const e of M.ledger||[]){if(e.kind!=="payment"&&e.kind!=="carry-settled")continue;const c=claims.get(e.claimId);if(!c){out.push(issue("error","PAYMENT_UNKNOWN_CLAIM",`Ödeme/mahsup ${e.id}: bağlı alacak kaydı yok.`));continue;}c.paid+=C.num(e.units)||0;if(c.paid>c.units+0.001)out.push(issue("error","DOUBLE_PAYMENT",`${db.people?.[c.pid]?.name||c.pid}: alacak ${c.units}, toplam ödeme/mahsup ${c.paid}; çift ödeme.`));}
    out.push(issue("info","AUDIT_SUMMARY",`Bağımsız denetim: ${byPerson.size} kişi, ${roster.length} resmî görev, ${dates.length} gün yeniden sayıldı.`));
    return out;
  }
  function openOf(M,pid){const claims=new Map();for(const e of M.ledger||[])if(e.kind==="carry-open"&&e.pid===pid)claims.set(e.claimId,C.num(e.units)||0);for(const e of M.ledger||[])if((e.kind==="payment"||e.kind==="carry-settled")&&claims.has(e.claimId))claims.set(e.claimId,claims.get(e.claimId)-(C.num(e.units)||0));return[...claims.values()].reduce((s,v)=>s+Math.max(0,v),0);}
  return{audit,categoryOf,earnedByPerson,fmsOfDate};
});
