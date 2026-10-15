/* Pediatri Nöbet Dengeleyici — iş kuralları motoru (v2).
   Üç ayrı doğru ayrı tutulur: FİİLÎ nöbet (hastane Excel'i), RESMÎ çizelge (PROBEL), BORDRO/DEVİR (defter).
   Ortak birim: Servis-eşdeğeri FMS saati = Servis FMS × 1 + Acil ailesi FMS × 1,5. */
(function(root,factory){const api=factory(root.NobetCore,root.NobetSolver,root.NobetAuditor);if(typeof module==="object"&&module.exports)module.exports=api;root.NobetEngine=api;})(typeof globalThis!=="undefined"?globalThis:this,function(C,S,A){
  "use strict";
  if(typeof require==="function"){C=C||require("./core.js");S=S||require("./solver.js");A=A||require("./auditor.js");}
  const DB_VERSION=4;

  /* ---------------- varsayılanlar ---------------- */
  function defaultGlobal(){return{
    fmsTable:{...C.DEFAULT_FMS_TABLE},factors:{Servis:1,Acil:1.5},maxDutyDays:8,minGapDays:3,
    specialShiftRules:[],orientationRule:null,
    defaults:{emergencyCap:8,emergencyMin:null,serviceMin:null,serviceMax:null},
    importMapping:null,timeLimitSec:8
  };}
  function newDb(){
    /* sürüm 3: programa gömülü kişi adı / hazır isim kararı YOK — kararlar kullanıcıdan ya da geçen ayın çıktı Excel'inden gelir */
    return{version:DB_VERSION,app:"pediatri-nobet-dengeleyici",createdAt:new Date().toISOString(),activeMonth:null,global:defaultGlobal(),people:{},aliases:{},aliasRejected:{},aliasLog:[],months:{},fileIndex:{}};}
  function newMonth(db,month){
    const g=db.global.defaults;
    return{month,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
      actualSource:null,actual:[],actualOutside:[],
      priorOfficial:{Servis:null,Acil:null},priorManual:[],priorListsComplete:false,priorHolidays:{answer:null,dates:[]},
      currentOfficial:{Servis:null,Acil:null},
      exclusions:[],leaves:[],unavailable:[],staff:{},
      settings:{emergencyCap:g.emergencyCap,emergencyMin:g.emergencyMin,serviceMin:g.serviceMin,serviceMax:g.serviceMax,holidays:[],specialDays:{holiday:null,halfDay:null},mode:"strict",approvedBy:"",rulesConfirmed:false,safeBoundary:true},
      dailyRequirements:[],ledger:[],result:null,manualEdits:[],priorSignatureUsed:null,stale:null,auditLog:[]};
  }
  function ensureMonth(db,month){if(!db.months[month]){db.months[month]=newMonth(db,month);carryForwardBasics(db,month);pullPriorFromPrevious(db,month);}return db.months[month];}
  /* Yeni ay açılırken: ay sınırını aşan izinler, personel başlangıç/ayrılış ve klinik yetki bilgisi taşınır;
     ayın kuralları önceki aydan ÖNERİ olarak gelir (yeniden onay gerekir). Hariç tutma ve ödeme durumları TAŞINMAZ. */
  function nextMonthFirstDuties(db,month){const nx=officialForMonth(db,C.nextMonth(month));const out=[];if(!nx)return out;for(const cat of["Servis","Acil"])for(const p of(nx[cat]?.persons||[]))for(const d of p.duties||[])if(C.dateDiff(C.monthDates(C.nextMonth(month))[0],d.date)<=1)out.push({name:p.name,pid:resolve(db,p.name),date:d.date,cat});return out;}
  function carryForwardBasics(db,month){
    const prev=db.months[C.prevMonth(month)];const M=db.months[month];if(!prev)return;
    const first=C.monthDates(month)[0];
    for(const l of prev.leaves||[])if(l.end>=first&&!M.leaves.some(x=>x.id===l.id))M.leaves.push({...l,note:`${l.note||""}${l.note?" · ":""}${C.monthLabel(prev.month)} kaydından devam`.trim()});
    for(const u of prev.unavailable||[])if(u.end>=first&&!M.unavailable.some(x=>x.id===u.id))M.unavailable.push({...u});
    for(const[pid,st]of Object.entries(prev.staff||{})){const keep={};for(const k of["startDate","endDate","authorizedCategory","authorizedBy"])if(st[k])keep[k]=st[k];if(Object.keys(keep).length)M.staff[pid]={...keep,...(M.staff[pid]||{})};}
    for(const k of["emergencyCap","emergencyMin","serviceMin","serviceMax","mode","approvedBy","safeBoundary","respectCurrentProbelNsi","keepPosted"])if(prev.settings[k]!=null)M.settings[k]=prev.settings[k];
    M.settings.rulesConfirmed=false;
    log(M,"AY_ACILDI",`${C.monthLabel(prev.month)} ayarları öneri olarak alındı; izin/personel bilgisi taşındı`);
  }
  function log(M,action,detail=""){M.auditLog=M.auditLog||[];M.auditLog.push({at:new Date().toISOString(),action,detail});if(M.auditLog.length>2000)M.auditLog=M.auditLog.slice(-2000);M.updatedAt=new Date().toISOString();}

  /* ---------------- kişi kimliği ve eşleştirme ---------------- */
  function resolve(db,rawName){const k=C.personKey(rawName);if(!k)return"";return db.aliases[k]||`p:${k}`;}
  function ensurePerson(db,rawName,extra={}){
    let pid=resolve(db,rawName);if(!pid)return"";
    if(extra.sicil){const bySicil=Object.values(db.people).find(p=>p.sicil&&p.sicil===String(extra.sicil)&&p.id!==pid);
      if(bySicil&&!db.aliases[C.personKey(rawName)]){/* kurum sicil numarası kalıcı kimliktir: aynı sicil = aynı kişi */db.aliases[C.personKey(rawName)]=bySicil.id;db.aliasLog.push({at:new Date().toISOString(),from:rawName,to:bySicil.name,by:"Sicil no eşleşmesi",sicil:extra.sicil});pid=bySicil.id;}}
    const p=db.people[pid]||(db.people[pid]={id:pid,name:C.displayName(rawName),sicil:"",spellings:[],createdAt:new Date().toISOString()});
    if(!p.spellings.includes(rawName))p.spellings.push(rawName);
    if(extra.sicil&&!p.sicil)p.sicil=String(extra.sicil);
    return pid;
  }
  function personName(db,pid){return db.people[pid]?.name||pid.replace(/^p:/,"");}
  /* 'from' ismini 'to' kişisine bağla (kullanıcı onayıyla). Tüm aylardaki kişi ayarları taşınır. */
  function confirmAlias(db,fromName,toName,by=""){
    const toPid=ensurePerson(db,toName);const fromKey=C.personKey(fromName);const fromPid=resolve(db,fromName);
    if(!fromKey||!toPid)return;if(fromPid===toPid&&db.aliases[fromKey]===toPid)return;
    for(const[k,v]of Object.entries(db.aliases))if(v===fromPid)db.aliases[k]=toPid;
    db.aliases[fromKey]=toPid;
    const fromP=db.people[fromPid];const toP=db.people[toPid];
    /* kaynak kişinin bütün yazımları (silinmeden önce): hangi ayda geçtiğini bulmak için */
    const fromKeys=new Set([fromKey,...((fromP&&fromP.spellings)||[]).map(C.personKey)]);
    if(fromP&&fromPid!==toPid){toP.spellings=C.uniq([...toP.spellings,...fromP.spellings]);if(!toP.sicil&&fromP.sicil)toP.sicil=fromP.sicil;delete db.people[fromPid];}
    if(!toP.spellings.includes(fromName))toP.spellings.push(fromName);
    for(const M of Object.values(db.months||{})){
      /* kaynak kişinin bu ayda izin/müsaitlik, ay sınırı teyidi, devir defteri, personel kararı ya da hariç tutma kaydı var mı (taşınmadan önce) — FABLE tur10 F1e */
      /* resmî listeler (önceki ay / bu ay PROBEL) kişiyi kimlikle değil ADLA saklar: kaynak kişinin herhangi bir yazımı orada geçiyorsa ay etkilenir (FABLE tur11 F1f) */
      const inOfficial=[M.priorOfficial,M.currentOfficial].some(o=>["Servis","Acil"].some(c=>((o&&o[c]&&o[c].persons)||[]).some(p=>fromKeys.has(C.personKey(p.name)))));
      const touched=fromPid!==toPid&&(inOfficial||!!(M.staff&&M.staff[fromPid])||(M.exclusions||[]).includes(fromPid)||[M.leaves,M.unavailable,M.priorManual,M.ledger].some(arr=>(arr||[]).some(x=>x.pid===fromPid)));
      if(M.staff&&M.staff[fromPid]){M.staff[toPid]={...M.staff[fromPid],...(M.staff[toPid]||{})};delete M.staff[fromPid];}
      M.exclusions=C.uniq((M.exclusions||[]).map(x=>x===fromPid?toPid:x));
      for(const arr of[M.leaves,M.unavailable,M.priorManual,M.ledger])(arr||[]).forEach(x=>{if(x.pid===fromPid)x.pid=toPid;});
      /* kayıtlı sonuç: atamalar ve uzlaştırma satırları yeni kimliğe taşınır; bu kişiyi içeren ayın çizelgesi yeniden hesaplanmalı (FABLE tur8 F1) */
      /* yalnız KAYNAK kişinin geçtiği ay etkilenir (atama, uzlaştırma ya da fiilî kayıt); hedef kişinin tek başına bulunduğu ay değişmez (FABLE tur9 F1c) */
      const r=M.result;if(r&&fromPid!==toPid){let hit=touched;const newName=personName(db,toPid);
        for(const a of r.assignments||[])if(a.pid===fromPid){a.pid=toPid;a.name=newName;hit=true;}
        const rec=Array.isArray(r.reconciliation)?r.reconciliation:((r.reconciliation&&r.reconciliation.rows)||[]);
        if(rec.some(x=>x.pid===fromPid))hit=true;
        if(!hit)hit=(M.actual||[]).some(x=>fromKeys.has(C.personKey(x.rawName)));
        /* uzlaştırma (kişi başına satır) sonucu olan her ayda yeni kimliklerle yeniden hesaplanır — iki satır kalmaz, taşınan devir alacağı yansır (FABLE tur9 F1b, tur10 F1e) */
        if(Array.isArray(r.reconciliation))r.reconciliation=reconcile(db,M,r);
        if(hit){r.stale=true;M.stale={reason:`İsim birleştirme: “${fromName}” = “${toName}”. Bu ayın hakediş ve çizelgesi yeniden hesaplanmalı.`,at:new Date().toISOString()};}}
    }
    db.aliasLog.push({at:new Date().toISOString(),from:fromName,to:toName,by:by||"Kullanıcı onayı"});
  }
  function rejectAlias(db,a,b,by=""){const k=[C.personKey(a),C.personKey(b)].sort().join("|");db.aliasRejected[k]={at:new Date().toISOString(),by};db.aliasLog.push({at:new Date().toISOString(),from:a,to:b,by:by||"Kullanıcı",rejected:true});}
  function isRejected(db,a,b){return!!db.aliasRejected[[C.personKey(a),C.personKey(b)].sort().join("|")];}
  /* Ay içindeki isimler arasında olası eşleşmeler (otomatik birleştirme YOK). */
  function aliasSuggestions(db,month){
    const M=db.months[month];if(!M)return[];
    const names=new Map();/* pid -> {name, roles:Set} */
    const add=(raw,role)=>{const pid=resolve(db,raw);if(!pid)return;const e=names.get(pid)||{pid,name:db.people[pid]?.name||C.displayName(raw),raws:new Set(),roles:new Set()};e.raws.add(raw);e.roles.add(role);names.set(pid,e);};
    M.actual.filter(r=>r.status!=="ignored").forEach(r=>add(r.rawName,"fiilî"));
    for(const cat of["Servis","Acil"]){(M.priorOfficial[cat]?.persons||[]).forEach(p=>add(p.name,"önceki ay resmî"));(M.currentOfficial[cat]?.persons||[]).forEach(p=>add(p.name,"bu ay resmî"));}
    /* elle girilen ay sonu (önceki ayın resmî) nöbetleri de kontrol edilir (ilk gerçek kullanıcı denemesi: elle girilen ad listedekinden farklı soyadıyla yazılmıştı) */
    for(const x of M.priorManual||[])if(x.kind==="duty"&&db.people[x.pid])add(db.people[x.pid].name,"önceki ay resmî");
    const list=[...names.values()];const out=[];
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      const a=list[i],b=list[j];if(a.pid===b.pid)continue;
      const sim=C.nameSimilarity(a.name,b.name);if(!sim||sim.kind==="same")continue;
      if(isRejected(db,a.name,b.name))continue;
      out.push({a:a.name,b:b.name,pidA:a.pid,pidB:b.pid,kind:sim.kind,score:sim.score,reason:sim.reason,rolesA:[...a.roles],rolesB:[...b.roles],
        blocking:(a.roles.has("fiilî")&&b.roles.has("fiilî"))||a.roles.has("önceki ay resmî")!==b.roles.has("önceki ay resmî")});
    }
    return out.sort((x,y)=>y.score-x.score);
  }

  /* ---------------- içe aktarma uygulama ---------------- */
  function setActualImport(db,month,parsed,fileMeta){
    const M=ensureMonth(db,month);
    /* kaynak sürüm geçmişi: önceki içe aktarma silinmez, listede kalır */
    if(M.actualSource&&M.actualSource.fileHash){(M.sourceHistory||(M.sourceHistory=[])).push({role:"fiilî",fileName:M.actualSource.fileName,fileHash:M.actualSource.fileHash,sheetName:M.actualSource.sheetName,importedAt:M.actualSource.importedAt,confirmed:!!M.actualSource.confirmed,records:M.actual.length,replacedAt:new Date().toISOString()});}
    const keepManual=M.actual.filter(r=>r.manual);
    M.actual=[...parsed.records.map(r=>({...r,status:"active"})),...keepManual];
    M.actualOutside=parsed.outside.map(r=>({...r}));
    parsed.records.forEach(r=>ensurePerson(db,r.rawName));
    const shifts=new Map();parsed.records.forEach(r=>{if(r.shift&&!(r.shift.start==="08:00"&&r.shift.end==="08:00")){const k=`${r.shift.start}-${r.shift.end}`;shifts.set(k,(shifts.get(k)||0)+1);}});
    for(const k of shifts.keys()){const[start,end]=k.split("-");if(!db.global.specialShiftRules.some(x=>x.start===start&&x.end===end))db.global.specialShiftRules.push({id:C.uid("vardiya"),start,end,fms:{weekday:null,friday:null,saturday:null,sunday:null,holiday:null},note:"İçe aktarımda görüldü; FMS kurumca doğrulanmalı"});}
    M.actualSource={fileHash:fileMeta.hash||"",fileName:fileMeta.name||"",fileSize:fileMeta.size||0,sheetName:parsed.sheetName,importedAt:new Date().toISOString(),confirmed:false,confirmedAt:null,stats:parsed.stats,issues:parsed.issues,header:parsed.header,dateCol:parsed.dateCol,title:parsed.title,titleRef:parsed.titleRef||null,blocks:parsed.blocks||[],format:fileMeta.format||"xlsx"};
    M.result=null;log(M,"FIILI_ICE_AKTARIM",`${fileMeta.name||""} / ${parsed.sheetName}: ${parsed.records.length} kayıt, ${parsed.outside.length} ay dışı`);
    return M;
  }
  function confirmActualImport(db,month,by=""){const M=db.months[month];if(!M||!M.actualSource)return;M.actualSource.confirmed=true;M.actualSource.confirmedAt=new Date().toISOString();M.actualSource.confirmedBy=by;log(M,"FIILI_ONAY",by);}
  function probelSignature(src){if(!src)return"";return C.sha256Text(JSON.stringify((src.persons||[]).map(p=>[C.personKey(p.name),p.duties.map(d=>d.date),p.nsi,p.boundaryMissing||[]])));}
  function slimProbel(parsed,fileMeta,origin){return{fileHash:fileMeta.hash||"",fileName:fileMeta.name||"",importedAt:new Date().toISOString(),origin:origin||"upload",month:parsed.month,category:parsed.category,title:parsed.title||"",format:parsed.format||"",reportedPersonCount:parsed.reportedPersonCount,stats:parsed.stats,
    issues:(parsed.issues||[]).filter(i=>!i.person),
    persons:parsed.persons.map(p=>({name:p.name,sicil:p.sicil||"",duties:p.duties.map(d=>({date:d.date,label:d.label,fmsStd:d.fmsStd,code:d.code})),nsi:p.nsi,blocks:p.blocks,work:p.work,weekendWork:p.weekendWork||[],boundaryMissing:p.boundaryMissing||[],uncertainDays:(p.uncertainDays||[]).map(u=>({raw:u.raw,code:u.code,possibleDates:u.possibleDates})),alignment:p.alignment,reported:p.reported,derivedFms:p.derivedFms,issues:p.issues}))};}
  function setProbel(db,month,role,category,parsed,fileMeta){
    const M=ensureMonth(db,month);
    const src=slimProbel(parsed,fileMeta,"upload");src.category=category||parsed.category;src.signature=probelSignature(src);
    parsed.persons.forEach(p=>ensurePerson(db,p.name,{sicil:p.sicil}));
    if(role==="prior"){
      const exp=C.prevMonth(month);
      if(parsed.month&&parsed.month!==exp)throw new Error(`Önceki ay listesi ${C.monthLabel(exp)} olmalı; dosya ${C.monthLabel(parsed.month)}.`);
      if(M.priorOfficial[src.category]&&M.priorOfficial[src.category].fileHash)(M.sourceHistory||(M.sourceHistory=[])).push({role:`önceki ay PROBEL ${src.category}`,fileName:M.priorOfficial[src.category].fileName,fileHash:M.priorOfficial[src.category].fileHash,importedAt:M.priorOfficial[src.category].importedAt,replacedAt:new Date().toISOString()});
      M.priorOfficial[src.category]=src;log(M,"ONCEKI_AY_PROBEL",`${src.category}: ${fileMeta.name||""} (${parsed.persons.length} kişi)`);
      /* önceki ayın kendisinde de 'bu ay resmî' olarak sakla (ileride yeniden kullanım) */
      if(db.months[exp]){db.months[exp].currentOfficial[src.category]={...src,origin:"upload"};}
    }else{
      if(parsed.month&&parsed.month!==month)throw new Error(`Bu ay listesi ${C.monthLabel(month)} olmalı; dosya ${C.monthLabel(parsed.month)}.`);
      if(M.currentOfficial[src.category]&&M.currentOfficial[src.category].fileHash)(M.sourceHistory||(M.sourceHistory=[])).push({role:`bu ay PROBEL ${src.category}`,fileName:M.currentOfficial[src.category].fileName,fileHash:M.currentOfficial[src.category].fileHash,importedAt:M.currentOfficial[src.category].importedAt,replacedAt:new Date().toISOString()});
      M.currentOfficial[src.category]=src;log(M,"BU_AY_PROBEL",`${src.category}: ${fileMeta.name||""}`);
      const nx=C.nextMonth(month);if(db.months[nx])pullPriorFromPrevious(db,nx,{force:true});
    }
    M.result&&(M.result.stale=true);
    checkStale(db);
    return src;
  }

  /* ---------------- fiilî FMS ve hakediş ---------------- */
  function dayTypeOf(date,M){const h=(M.settings.holidays||[]).find(h=>h.date===date);if(h)return h.kind===HALF?"halfday":"holiday";const wd=C.weekday(date);return wd===0?"sunday":wd===6?"saturday":wd===5?"friday":"weekday";}
  /* RESMÎ TATİL / YARIM GÜN: program tahmin etmez. Her ay iki soru: specialDays.holiday / specialDays.halfDay
     (null = cevaplanmadı, true = var, false = yok). Günler ve FMS değerleri kullanıcı tarafından girilir ve onaylanır. */
  const HALF="yarım gün";
  /* İZİN = personelin ÇALIŞMADIĞI her gün (kullanıcı kuralı). Sebep yalnız bilgi içindir; hepsi aynı işlenir: o günlerde resmî nöbet yazılmaz.
     “İşten ayrıldı”: ayrıldığı günden ay sonuna; “Henüz başlamadı”: ay başından başladığı günün öncesine kadar girilir. */
  const LEAVE_REASONS=Object.freeze(["Yıllık izin","Rapor","Doğum sonrası izni","Mazeret izni","Görevlendirme","İşten ayrıldı","Henüz başlamadı","Diğer"]);
  function setSpecialDayAnswer(db,month,which,value){if(!["holiday","halfDay"].includes(which))throw new Error("geçersiz soru");const M=ensureMonth(db,month);
    M.settings.specialDays={...(M.settings.specialDays||{holiday:null,halfDay:null}),[which]:value==null?null:!!value};M.settings.rulesConfirmed=false;if(M.result)M.result.stale=true;log(M,"OZEL_GUN_CEVAP",`${which}=${value}`);return M;}
  function addSpecialDay(db,month,o){const M=ensureMonth(db,month);if(!o||!o.date||!o.date.startsWith(month))throw new Error("Tarih bu ay içinde olmalı.");
    if((M.settings.holidays||[]).some(h=>h.date===o.date))throw new Error(`${C.fmtDate(o.date)} zaten listede.`);const kind=o.kind===HALF?HALF:"tatil";const fms=C.num(o.fms);
    M.settings.holidays.push({date:o.date,label:o.label||(kind===HALF?"Yarım gün":"Resmî tatil"),kind,fms,confirmed:!!o.confirmed&&fms!=null});M.settings.holidays.sort((a,b)=>a.date.localeCompare(b.date));
    M.settings.rulesConfirmed=false;if(M.result)M.result.stale=true;log(M,"OZEL_GUN",`${kind} ${o.date}`);return M;}
  /* Önceki ayın PROBEL listesini hizalamak için o ayın resmî tatil günleri: o ayın kaydı cevaplıysa oradan, değilse bu ayda sorulan cevaptan */
  function priorHolidayInfo(db,M){const pm=C.prevMonth(M.month);const P=db.months[pm];
    if(P&&P.settings&&P.settings.specialDays&&P.settings.specialDays.holiday!=null)return{answered:true,source:"record",month:pm,dates:(P.settings.holidays||[]).filter(h=>h.kind!==HALF).map(h=>h.date)};
    const a=M.priorHolidays||{};return{answered:a.answer!=null,source:"asked",month:pm,dates:a.answer===true?(a.dates||[]):[]};}
  function setPriorHolidays(db,month,answer,dates){const M=ensureMonth(db,month);const pm=C.prevMonth(month);for(const d of dates||[])if(!String(d).startsWith(pm))throw new Error(`Tarih ${C.monthLabel(pm)} içinde olmalı.`);
    M.priorHolidays={answer:answer==null?null:!!answer,dates:answer?[...new Set(dates||[])].sort():[]};log(M,"ONCEKI_AY_TATIL",`${answer} ${M.priorHolidays.dates.join(",")}`);return M;}
  function fmsConfig(db,M){return{fmsTable:db.global.fmsTable,holidays:(M.settings.holidays||[]).map(h=>({date:h.date,kind:h.kind,fms:h.confirmed?h.fms:null}))};}
  function stdFms(db,M,date){return C.standardFms(date,fmsConfig(db,M));}
  /* Fiilî kaydın bu aya ait geçerli tarihi var mı — TEK tanım: hakediş satırları (actualRows), ay dışı/geçersiz tarihli aktif kayıtlar
     (misplacedActual: ön koşul hatası, kayıt listesi, rapor) aynı kuralla ayrılır (FABLE tur12c T12c-1/T12c-4). Denetçi aynı kuralı bağımsız uygular. */
  function inMonthDate(M,d){return C.isYmd(d)&&d.startsWith(M.month);}
  function misplacedActual(db,M){return(M.actual||[]).filter(r=>r.status!=="ignored"&&!inMonthDate(M,r.date));}
  /* Adım 1 kayıt listesinin modeli: hakedişe giren satırlar, ay dışı/geçersiz tarihli AKTİF kayıtlar (Düzelt/Yok say ile çözülür), yok sayılanlar */
  function recordListModel(db,M){return{rows:actualRows(db,M),misplaced:misplacedActual(db,M),ignored:(M.actual||[]).filter(r=>r.status==="ignored")};}
  /* İKİ YERDE SAATLİ NÖBET (kullanıcı kuralı 14.10.2026; yetkili teyidi aynı gün): aynı kişi aynı gün EN AZ İKİ FARKLI bölümde saatli görev
     yaptıysa (ör. Acil 17.00–08.00 + Yenidoğan 09.00–17.00) ve o gün saatsiz (tam) kaydı yoksa, o gün TEK TAM NÖBET sayılır: FMS günün standart
     değeri (tatilse onun onaylı FMS'i), kategori Acil; özel vardiya FMS'i sorulmaz. Yetkiliye göre bu YALNIZ Cumartesi/Pazar ve Acil ailesi
     içinde olur: hafta içi (tatil dahil) ya da Servis karışan gün birleştirilmez, kayıt düzeltilene kadar FMS'i eksik kalır (uyarı).
     Tek başına saatli görev: gündüz mesaisi (08–16 / 09–17) Cumartesi, Pazar ve resmî tatilde 8 FMS (kural); tek başına gece görevi olmaz (uyarı);
     diğerleri için özel vardiya kuralı sorulur. Elle FMS verilmiş, oryantasyon ya da bölümü belirsiz kayıt içeren gün birleştirilmez
     (kullanıcı kararı/eksik veri önceliklidir). Bağımsız denetçi aynı kuralları ayrıca uygular. */
  function halfSource(date){const wd=C.weekday(date);return wd>=1&&wd<=5?"arefe (yarım gün) nöbeti — kural":`arefe ${C.dayName(date)} gününe denk geldi — günün normal değeri (mesai yok)`;}
  function dayFmsProblem(h){return!h?"Standart FMS tablosunda değer yok":h.kind===HALF?`Arefe (yarım gün, ${h.label}) nöbet FMS değeri tabloda boş`:`Resmî tatil (${h.label}) FMS değeri onaylanmadı`;}
  /* hafta sonu ya da resmî tatil (yarım gün hariç): gündüz mesaisi kuralı bu günlerde geçerli */
  function offDay(M,date){const wd=C.weekday(date);if(wd===0||wd===6)return true;const h=(M.settings.holidays||[]).find(h=>h.date===date);return!!h&&h.kind!==HALF;}
  function isShiftPart(r){return!!(r.shift&&!(r.shift.start==="08:00"&&r.shift.end==="08:00"))&&!r.orientation&&!(r.fmsOverride!=null&&r.fmsOverride!=="");}
  function isSplitDay(list){return list.length>=2&&list.every(r=>isShiftPart(r)&&!!C.CATEGORY_OF_UNIT[r.unit])&&new Set(list.map(r=>r.unit)).size>=2;}
  /* Her aktif fiilî kayıt için FMS, kaynağı ve eşdeğer saat. */
  function actualRows(db,M){
    const rows=M.actual.filter(r=>r.status!=="ignored"&&inMonthDate(M,r.date)).map(r=>({...r,pid:resolve(db,r.rawName)}));
    const f=db.global.factors;
    for(const r of rows){
      r.fms=null;r.fmsSource="";r.duty=true;r.problems=[];
      const holiday=(M.settings.holidays||[]).find(h=>h.date===r.date);
      if(r.fmsOverride!=null&&r.fmsOverride!==""){r.fms=C.num(r.fmsOverride);r.fmsSource="elle düzeltildi";}
      /* kullanıcı kararı (14.10.2026): oryantasyon nöbeti HER ZAMAN gerçek nöbet gibi sayılır (günün standart FMS'i); eski “FMS yok / seçilmedi” ayarı yok sayılır */
      else if(r.orientation){const v=stdFms(db,M,r.date);if(v==null)r.problems.push(dayFmsProblem(holiday));else{r.fms=v;r.fmsSource="oryantasyon = gerçek nöbet (kural)";}}
      else if(C.isNightShift(r.shift)){
        /* yetkili (14.10.2026): tek başına gece görevi olmaz — gece ancak hafta sonu iki yerde çalışmanın parçasıdır (aşağıda birleşir) */
        r.problems.push(`Tek başına gece görevi (${r.shift.start}–${r.shift.end}): yetkiliye göre böyle görev olmaz; gece yalnız hafta sonu iki yerde çalışmanın parçası olur. Aynı günün öbür satırı eksik ya da yanlış yazılmış olabilir — kaydı düzeltin (doğruysa FMS'i elle girin)`);}
      else if(r.shift&&C.isDaytimeShift(r.shift)&&offDay(M,r.date)){
        /* yetkili (14.10.2026): tek başına gündüz mesaisi Cumartesi, Pazar ve resmî tatilde 8 FMS (saatle hesaplanmaz) */
        const v=C.tableFms(db.global.fmsTable,"daytime");if(v==null)r.problems.push("Gündüz mesaisi FMS değeri tabloda boş");else{r.fms=v;r.fmsSource=`gündüz mesaisi ${r.shift.start}-${r.shift.end} (${C.dayName(r.date)}${holiday?", resmî tatil":""}) — kural`;}}
      else if(r.shift&&!(r.shift.start==="08:00"&&r.shift.end==="08:00")){
        const rule=db.global.specialShiftRules.find(x=>x.start===r.shift.start&&x.end===r.shift.end);
        const dt=dayTypeOf(r.date,M);const v=rule?C.num(rule.fms[dt]):null;r.ruleDt=dt;/* Adım 3 tablosu: bu ay hangi gün türünün değeri gerçekten gerekiyor */
        if(v==null)r.problems.push(`${r.shift.start}-${r.shift.end} özel vardiyasının ${({weekday:"hafta içi",friday:"cuma",saturday:"cumartesi",sunday:"pazar",holiday:"resmî tatil",halfday:"yarım gün"})[dt]} FMS değeri onaylanmadı`);else{r.fms=v;r.fmsSource=`özel vardiya kuralı ${r.shift.start}-${r.shift.end}`;}
      }
      else{const v=stdFms(db,M,r.date);if(v==null)r.problems.push(dayFmsProblem(holiday));else{r.fms=v;r.fmsSource=holiday?(holiday.kind===HALF?halfSource(r.date):"resmî tatil (onaylı)"):"standart tablo";}}
      if(!r.pid)r.problems.push("Personel adı boş");
      if(!C.CATEGORY_OF_UNIT[r.unit])r.problems.push(`Bölüm belirsiz${r.v3Unit?` (eski kayıtta “${r.v3Unit}”)`:""} — kaydı düzeltip bölüm seçin`);
      r.factor=f[r.category]??null;r.eq=r.fms==null||r.factor==null?null:C.round2(r.fms*r.factor);
    }
    /* Aynı kişi aynı gün: kişi-gün sayısı 1; iki TAM (standart) nöbet iki kez ödenmez. */
    const byPD=new Map();rows.forEach(r=>{const k=`${r.pid}|${r.date}`;(byPD.get(k)||byPD.set(k,[]).get(k)).push(r);});
    for(const list of byPD.values()){
      if(list.length<2)continue;
      const full=list.filter(r=>!r.shift||(r.shift.start==="08:00"&&r.shift.end==="08:00"));
      const partial=list.filter(r=>!full.includes(r));
      list.forEach(r=>r.sameDay=list.length);
      if(list[0].pid&&isSplitDay(list)){
        /* yetkili (14.10.2026): iki yerde çalışma YALNIZ Cumartesi/Pazar ve hep Acil ailesi içinde olur; başka durum sessizce sayılmaz */
        const wdS=C.weekday(list[0].date),why=[];if(list.some(r=>C.CATEGORY_OF_UNIT[r.unit]==="Servis"))why.push("Servis ile Acil ailesi aynı gün olmaz (büyük olasılıkla Excel yazım hatası)");if(wdS!==0&&wdS!==6)why.push(`iki yerde çalışma yalnız Cumartesi ve Pazar olur (bu gün ${C.dayName(list[0].date)})`);
        if(why.length){const label=list.map(r=>`${r.unit} ${r.shift.start}–${r.shift.end}`).join(" + ");for(const r of list){r.splitBlocked=label;r.fms=null;r.eq=null;r.fmsSource="";r.problems=[`Aynı gün iki yerde saatli görev (${label}): yetkiliye göre ${why.join("; ")} — kaydı düzeltin (doğruysa FMS'i elle girin)`];}continue;}
        const keep=list.find(r=>C.CATEGORY_OF_UNIT[r.unit]==="Acil")||list[0];const label=list.map(r=>`${r.unit} ${r.shift.start}–${r.shift.end}`).join(" + ");
        const holiday=(M.settings.holidays||[]).find(h=>h.date===keep.date);const v=stdFms(db,M,keep.date);
        for(const r of list){r.category="Acil";r.factor=f.Acil??null;r.split=label;r.splitKeep=r===keep;r.problems=[];
          if(r===keep){r.fms=v;r.fmsSource=`iki yerde saatli nöbet (${label}) — tek tam nöbet sayıldı, kategori Acil`+(holiday?` (${holiday.kind===HALF?"yarım gün":"resmî tatil"})`:"");
            if(v==null)r.problems.push(dayFmsProblem(holiday));}
          else{r.fms=0;r.splitOf=keep.id;r.fmsSource=`birleşik nöbetin parçası (${label}) — ayrıca sayılmadı`;}
          r.eq=r.fms==null||r.factor==null?null:C.round2(r.fms*r.factor);}
        continue;}
      if(full.length>=1&&list.length>1){
        full.slice(1).concat(partial).forEach(r=>{if(r.fmsOverride!=null&&r.fmsOverride!=="")return;r.dupOf=full[0].id;r.fms=0;r.eq=r.factor==null?null:0;r.problems=[];r.fmsSource="aynı gün tam nöbetle çakışıyor — ikinci kez sayılmadı";r.reviewNeeded=true;});
      }
    }
    return rows;
  }
  function staffSummary(db,M,rows){
    rows=rows||actualRows(db,M);
    const byPid=new Map();
    const touch=(pid,raw)=>{if(!byPid.has(pid))byPid.set(pid,{pid,name:db.people[pid]?.name||(raw?C.displayName(raw):personName(db,pid)),rows:[]});return byPid.get(pid);};
    rows.forEach(r=>r.pid&&touch(r.pid,r.rawName).rows.push(r));
    Object.keys(M.staff||{}).forEach(pid=>touch(pid));
    (M.exclusions||[]).forEach(pid=>touch(pid));
    const out=[];
    for(const p of byPid.values()){
      const st=M.staff?.[p.pid]||{};
      const dutyRows=p.rows.filter(r=>r.duty!==false);
      const history=C.uniq(p.rows.filter(r=>!r.orientation&&r.duty!==false).map(r=>r.category));
      const servisFms=p.rows.filter(r=>r.category==="Servis").reduce((s,r)=>s+(r.fms||0),0);
      const acilFms=p.rows.filter(r=>r.category==="Acil").reduce((s,r)=>s+(r.fms||0),0);
      const complete=p.rows.every(r=>r.eq!=null);
      const earnedComputed=complete?C.round2(p.rows.reduce((s,r)=>s+r.eq,0)):null;
      const ov=st.earnedOverride&&C.num(st.earnedOverride.value)!=null?C.num(st.earnedOverride.value):null;
      const earnedTarget=ov!=null?ov:earnedComputed;
      let allowed=[];let catSource="";
      if(history.length===1){allowed=[...history];catSource="fiilî kaynak (tek kategori)";if(st.officialCategory&&st.officialCategory!==history[0])catSource+=" — seçilen kategori kaynakta yok, yok sayıldı";}
      else if(history.length>1){if(st.officialCategory&&history.includes(st.officialCategory)){allowed=[st.officialCategory];catSource="fiilî karma; kullanıcı seçti";}else{allowed=[...history];catSource="fiilî karma; çözücü birini seçer";}}
      else if(st.authorizedCategory){allowed=[st.authorizedCategory];catSource=`fiilî yok; ${st.authorizedBy||"kullanıcı"} yetkilendirdi`;}
      const open=openBalance(M,p.pid);
      out.push({pid:p.pid,name:p.name,rows:p.rows,actualDays:C.uniq(dutyRows.map(r=>r.date)).length,actualDates:C.uniq(p.rows.map(r=>r.date)).sort(),history,allowed,catSource,servisFms,acilFms,complete,earnedComputed,earnedOverride:ov,earnedTarget,overrideNote:st.earnedOverride?.note||"",
        excluded:(M.exclusions||[]).includes(p.pid),staff:st,openBalance:open,unverified:p.rows.filter(r=>r.eq==null).length,reviewNeeded:p.rows.filter(r=>r.reviewNeeded).length,orientationOnly:p.rows.length>0&&history.length===0});
    }
    return out.sort((a,b)=>a.name.localeCompare(b.name,"tr"));
  }

  /* ---------------- ay sınırı (önceki ayın RESMÎ kaydı) ---------------- */
  /* liste eksikken elle tamamlanan ay sonu kaydının TEK ifadesi (ekran, rapor, PROBEL giriş dosyası, talimatname, denetçi) */
  const PRIOR_MANUAL_LABEL="Tam (elle girildi)";
  function priorStatus(db,M){
    const lists={Servis:!!M.priorOfficial.Servis,Acil:!!M.priorOfficial.Acil};const days=new Set(C.priorBoundaryDays(M.month));
    /* 3.3.2 (kullanıcı isteği 15.10.2026): “hepsi burada” onayı kaldırıldı. Geçen ayın son 2 günü için aktarılan (program çıktısı) ya da elle
       girilen resmî nöbetler TAM kayıt kabul edilir; hiç nöbet bilinmiyorsa eksik. Gün başı makullük uyarısı (PRIOR_DAY_THIN) sürer. */
    const known=["Servis","Acil"].some(c=>((M.priorOfficial[c]&&M.priorOfficial[c].persons)||[]).some(p=>(p.duties||[]).some(d=>days.has(d.date))))||(M.priorManual||[]).some(x=>x.kind==="duty"&&days.has(x.date));
    const manualFill=known&&!(lists.Servis&&lists.Acil)&&(M.priorManual||[]).some(x=>x.kind==="duty"&&days.has(x.date));
    return{lists,complete:known,planBased:false,manualFill,any:known||lists.Servis||lists.Acil||(M.priorManual||[]).length>0};
  }
  /* pid -> [{date, reason, kind:'kesin'|'güvenli'}] */
  function boundaryBlocks(db,M,staffList){
    const month=M.month;const prev=C.prevMonth(month);const prevDates=C.monthDates(prev);const last3=new Set(C.priorBoundaryDays(month));/* yalnız son 2 gün bu ayı etkiler */
    const first=C.monthDates(month).slice(0,2);
    const blocks=new Map();const add=(pid,date,reason,kind,src)=>{if(!date.startsWith(month))return;const arr=blocks.get(pid)||blocks.set(pid,[]).get(pid);if(!arr.some(x=>x.date===date&&x.reason===reason))arr.push({date,reason,kind,source:src});};
    const known=new Set();const pendingMatches=[];
    const staffPids=new Set((staffList||[]).map(s=>s.pid));
    const manualNone=new Set(M.priorManual.filter(x=>x.kind==="none").map(x=>`${x.pid}|${x.date}`));
    for(const cat of["Servis","Acil"]){
      const src=M.priorOfficial[cat];if(!src)continue;
      for(const p of src.persons){
        const pid=resolve(db,p.name);known.add(pid);
        const targets=[pid];
        if(!staffPids.has(pid)){/* bu ayın listesinde birebir yok: olası eşleşmelere de (güvenli tarafta) uygula */
          for(const s of staffList||[]){const sim=C.nameSimilarity(p.name,s.name);if(sim&&sim.kind!=="same"&&!isRejected(db,p.name,s.name)){targets.push(s.pid);pendingMatches.push({probelName:p.name,candidate:s.name,candidatePid:s.pid,reason:sim.reason,cat});}}
        }
        for(const d of p.duties){if(!last3.has(d.date))continue;for(const t of targets){const pending=t!==pid;add(t,C.addDays(d.date,1),`${C.fmtDate(d.date)} resmî ${cat} nöbeti (${src.origin==="app-plan"?"uygulama planı":"PROBEL"})${pending?" — isim eşleşmesi onay bekliyor":""}`,pending?"güvenli":"kesin",cat);add(t,C.addDays(d.date,2),`${C.fmtDate(d.date)} resmî ${cat} nöbeti + 2 tam gün dinlenme${pending?" — isim eşleşmesi onay bekliyor":""}`,pending?"güvenli":"kesin",cat);}}
        /* 3.3.0: güvenli mod kaldırıldı — eksik/belirsiz PROBEL hücresi engel koymaz; bağımsız denetçi BOUNDARY_UNCERTAIN uyarısı verir */
      }
    }
    for(const x of M.priorManual){if(x.kind!=="duty")continue;known.add(x.pid);add(x.pid,C.addDays(x.date,1),`${C.fmtDate(x.date)} resmî nöbet (elle girildi)`,"kesin","elle");add(x.pid,C.addDays(x.date,2),`${C.fmtDate(x.date)} resmî nöbet + 2 tam gün (elle girildi)`,"kesin","elle");
      /* elle girilen ad bu ayın listesinde birebir yoksa olası eşleşmelere de güvenli tarafta uygulanır (PROBEL yoluyla aynı kural) */
      if(!staffPids.has(x.pid)){const nm=personName(db,x.pid);for(const s of staffList||[]){const sim=C.nameSimilarity(nm,s.name);if(!sim||sim.kind==="same"||isRejected(db,nm,s.name))continue;pendingMatches.push({probelName:nm,candidate:s.name,candidatePid:s.pid,reason:sim.reason,cat:"elle"});
        add(s.pid,C.addDays(x.date,1),`${C.fmtDate(x.date)} resmî nöbet (elle girildi: “${nm}”) — isim eşleşmesi onay bekliyor`,"güvenli","elle");add(s.pid,C.addDays(x.date,2),`${C.fmtDate(x.date)} resmî nöbet + 2 tam gün (elle girildi: “${nm}”) — isim eşleşmesi onay bekliyor`,"güvenli","elle");}}}
    M.priorManual.filter(x=>x.kind==="none-all").forEach(x=>known.add(x.pid));
    /* Sonraki ayın resmî kaydı zaten varsa (yüklenmiş PROBEL veya plan) bu ayın son günleri de ona göre kapanır */
    const nx=officialForMonth(db,C.nextMonth(month));
    if(nx)for(const cat of["Servis","Acil"])for(const p of(nx[cat]?.persons||[])){const pid=resolve(db,p.name);for(const d of p.duties||[]){const dd=C.dateDiff(C.monthDates(C.nextMonth(month))[0],d.date);if(dd>1)continue;for(let k=1;k<=2;k++){const back=C.addDays(d.date,-k);add(pid,back,`${C.fmtDate(d.date)} sonraki ay resmî ${cat} nöbeti — arada 2 tam gün kalmalı`,"kesin","sonraki ay");}}}
    const st=priorStatus(db,M);
    const unknown=[];
    /* 3.3.0 (kullanıcı isteği): güvenli mod kaldırıldı — ay sonu onaylanmadıysa ilk 2 gün kapatılmaz; durum “eksik veri”, uyarı verilir */
    if(!st.complete){for(const s of staffList||[])if(!known.has(s.pid))unknown.push(s.pid);}
    return{blocks,known,unknown,pendingMatches,status:st};
  }

  /* ---------------- engeller ---------------- */
  function personBlocks(db,M,s,bnd){
    const dates=C.monthDates(M.month);const out=new Map();const add=(d,why)=>{if(!out.has(d))out.set(d,why);};
    for(const l of M.leaves||[]){if(l.pid!==s.pid)continue;for(const d of dates)if(d>=l.start&&d<=l.end)add(d,`${l.kind||"izin"}${l.source?` (${l.source})`:""}`);}
    for(const u of M.unavailable||[]){if(u.pid!==s.pid)continue;if(u.mode==="blocked")for(const d of dates)if(d>=u.start&&d<=u.end)add(d,"kesin müsait değil");}
    const only=(M.unavailable||[]).filter(u=>u.pid===s.pid&&u.mode==="only");if(only.length)for(const d of dates)if(!only.some(u=>d>=u.start&&d<=u.end))add(d,"yalnız belirtilen aralıkta müsait");
    const st=M.staff?.[s.pid]||{};if(st.startDate)for(const d of dates)if(d<st.startDate)add(d,"henüz başlamadı");if(st.endDate)for(const d of dates)if(d>st.endDate)add(d,"görevi sona erdi");
    for(const b of bnd.blocks.get(s.pid)||[])add(b.date,b.reason);
    /* bu ayın resmî PROBEL listesindeki izin/başlamadı/görevlendirme kodları */
    for(const cat of["Servis","Acil"]){const src=M.currentOfficial[cat];if(!src)continue;for(const p of src.persons){if(resolve(db,p.name)!==s.pid)continue;for(const b of p.blocks||[])add(b.date,`PROBEL: ${b.label}`);if(M.settings.respectCurrentProbelNsi!==false)for(const d of p.nsi||[])add(d,"PROBEL: NSİ (nöbet ertesi izin)");}}
    return out;
  }
  function softPrefs(M,pid){const avoid=new Set(),prefer=new Set();const dates=C.monthDates(M.month);for(const u of M.unavailable||[]){if(u.pid!==pid)continue;for(let i=0;i<dates.length;i++)if(dates[i]>=u.start&&dates[i]<=u.end){if(u.mode==="avoid")avoid.add(i);if(u.mode==="prefer")prefer.add(i);}}return{avoid,prefer};}
  /* Bu ayın yüklenmiş PROBEL listesindeki (uygulama planı değil) nöbet günleri — “işlenmiş nöbetleri koru” açıkken çözücüye tercih olarak verilir */
  function postedSources(M){return["Servis","Acil"].map(cat=>({cat,src:M.currentOfficial&&M.currentOfficial[cat]})).filter(x=>x.src&&x.src.origin!=="app-plan");}
  function postedDays(db,M,pid,dates){if(M.settings.keepPosted===false)return null;const out={Servis:new Set(),Acil:new Set()};let any=false;
    for(const{cat,src}of postedSources(M))for(const q of src.persons||[]){if(resolve(db,q.name)!==pid)continue;for(const d of q.duties||[]){const i=dates.indexOf(d.date);if(i>=0){out[cat].add(i);any=true;}}}return any?out:null;}
  /* Öneri ile PROBEL'e işlenmiş kayıt arasındaki fark (kaynak değiştirilmez; yalnız liste) */
  function postedDiff(db,M,assignments){
    const posted=[];for(const{cat,src}of postedSources(M))for(const q of src.persons||[]){const pid=resolve(db,q.name);for(const d of q.duties||[])if(String(d.date||"").startsWith(M.month))posted.push({pid,name:personName(db,pid),date:d.date,category:cat});}
    if(!posted.length)return null;
    const key=x=>`${x.pid}|${x.date}|${x.category}`;const P=new Set(posted.map(key)),A=new Set((assignments||[]).map(key));
    const removed=posted.filter(x=>!A.has(key(x))).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,"tr"));
    const added=(assignments||[]).filter(x=>!P.has(key(x))).map(x=>({pid:x.pid,name:x.name||personName(db,x.pid),date:x.date,category:x.category})).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name,"tr"));
    return{posted:posted.length,kept:posted.length-removed.length,added,removed,keepPosted:M.settings.keepPosted!==false};
  }
  /* Fiilî listede her gün en az bulunan kişi sayısının altına düşen resmî günler (kategori başına) */
  function staffingNotes(db,M,assignments,rows){
    const out=[];const dates=C.monthDates(M.month);rows=rows||actualRows(db,M);const lim=dailyLimits(M);
    for(const cat of["Servis","Acil"]){
      const act=dates.map(d=>new Set(rows.filter(r=>r.date===d&&r.category===cat&&r.duty!==false).map(r=>r.pid)).size);
      const actMin=Math.min(...act);if(!(actMin>0))continue;
      const off=dates.map(d=>new Set((assignments||[]).filter(a=>a.date===d&&a.category===cat).map(a=>a.pid)).size);
      const low=dates.filter((d,i)=>off[i]<actMin);if(!low.length)continue;
      const mins=C.uniq(lim.map(l=>l[cat].min==null?"—":String(l[cat].min)));
      out.push({level:"warning",code:"STAFFING_BELOW_ACTUAL",message:`${cat}: fiilî listede her gün en az ${actMin} kişi var; resmî öneride ${low.length} gün ${actMin} kişiden az (${low.slice(0,15).map(d=>C.fmtDate(d).slice(0,5)).join(", ")}${low.length>15?" …":""}). Program yalnız Adım 3'teki günlük asgari değere (${cat} en az ${mins.join("/")}) uyar; resmî listedeki günlük ${cat} kadrosunun kurumca kabul edilebilir olduğunu yetkiliyle teyit edin.`,cat,days:low});
    }
    return out;
  }
  /* Kişi bazlı fazla ödeme alt sınırı (yalnız devirsiz mod): toplam fazla ≥ alt sınır her zaman; eşitse olası en düşük değer KANITLIDIR */
  function overBound(built,assignments,M){
    if(M.settings.mode==="defer")return null;const P=built.problem;const lb=S.overLowerBound(P).lb;let total=0;
    for(const p of P.persons){if(!(p.target>0))continue;const eq=(assignments||[]).filter(a=>a.pid===p.pid).reduce((z,a)=>z+(a.eq||0),0);total+=Math.max(0,eq-p.target);}
    total=C.round2(total);return{total,lowerBound:lb,atBound:total<=lb+1e-9};
  }
  function postNotes(db,M,built,assignments,sol){
    const out=[];if(!(assignments||[]).length)return{issues:out,postedDiff:postedDiff(db,M,assignments),overBound:null};
    /* yeni başlayan: ilk fiilî günden önce resmî nöbet */
    const flags=newStarterFlags(db,M,built.staff);
    for(const[pid,f]of flags){const early=assignments.filter(a=>a.pid===pid&&a.date<f.first).map(a=>C.fmtDate(a.date).slice(0,5));if(early.length)out.push({level:"warning",code:"OFFICIAL_BEFORE_FIRST_ACTUAL",message:`${personName(db,pid)}: resmî öneri ${early.join(", ")} günlerine nöbet yazdı; bu günler ilk fiilî kaydından (${C.fmtDate(f.first)}) önce. Kişi o tarihte henüz başlamadıysa Adım 2'de “Henüz başlamadı” izni girip yeniden hesaplayın.`,pid});}
    out.push(...staffingNotes(db,M,assignments,built.rows));
    const ob=overBound(built,assignments,M);
    if(ob)out.push({level:"info",code:"OVERPAY_BOUND",message:`Fazla ödeme (plan) ${C.fmtNum(ob.total)} eşdeğer saat; kişi bazlı kaçınılmaz alt sınır ${C.fmtNum(ob.lowerBound)} (her kişinin hakedişi günlük FMS adımlarıyla karşılanabildiği için). ${ob.atBound?"Bu çizelge olası en düşük fazla ödemeye ulaştı (kanıtlı).":`Aradaki ${C.fmtNum(C.round2(ob.total-ob.lowerBound))} saatin günlük kadro/aralık kuralları nedeniyle kaçınılmaz olup olmadığı kanıtlanamadı.`}`});
    const fx=sol&&sol.stats&&sol.stats.categoryFixed||[];
    if(fx.length)out.push({level:"info",code:"CATEGORY_IMPROVED",message:`Kategori iyileştirmesi: ${fx.map(x=>`${x.name} → ${x.category}`).join(", ")} (fazla ödeme ${C.fmtNum(sol.stats.overFirst)} → ${C.fmtNum(sol.stats.overTotal)} eşdeğer saat). İki bölümde de çalışmış kişiler için kategori seçimi Adım 2'den değiştirilebilir.`});
    const pd=postedDiff(db,M,assignments);
    if(pd&&(pd.added.length||pd.removed.length))out.push({level:"warning",code:"POSTED_CHANGES",message:`Bu ayın PROBEL'e işlenmiş ${pd.posted} nöbetinden ${pd.kept} tanesi öneride aynen var; öneri ${pd.removed.length} nöbeti kaldırıp ${pd.added.length} yeni nöbet ekliyor${pd.keepPosted?"":" (“işlenmiş nöbetleri koru” KAPALI)"}. Değişiklikler yetkili onayı olmadan PROBEL'e işlenmemeli (Adım 4 → “PROBEL farkı”).`});
    return{issues:out,postedDiff:pd,overBound:ob};
  }
  function dailyLimits(M){
    const s=M.settings;return C.monthDates(M.month).map(date=>{const o=(M.dailyRequirements||[]).find(x=>x.date===date)||{};const v=(a,b)=>C.num(a)!=null?C.num(a):C.num(b);
      return{date,Servis:{min:v(o.serviceMin,s.serviceMin),max:v(o.serviceMax,s.serviceMax)},Acil:{min:v(o.emergencyMin,s.emergencyMin),max:v(o.emergencyMax,s.emergencyCap)}};});
  }

  /* ---------------- olası yeni başlayan ----------------
     Oryantasyon kaydı var ya da geçen ayın fiilî listesi kayıtlıyken orada yok; ilk fiilî günü ay başından sonra; “Henüz başlamadı” izni,
     başlangıç tarihi ya da “başlangıç kontrol edildi” işareti yok. Program başlama tarihini TAHMİN ETMEZ; kullanıcıya sorar. */
  function prevActualPids(db,M){const P=db.months[C.prevMonth(M.month)];const rows=P?(P.actual||[]).filter(r=>r.status!=="ignored"&&String(r.date||"").startsWith(P.month)):[];return rows.length?new Set(rows.map(r=>resolve(db,r.rawName))):null;}
  /* önceki ayın RESMÎ kaydında (yüklenen/aktarılan liste ya da elle ay sonu nöbeti) adı geçen kişi o ay çalışıyordu: yeni başlayan sayılmaz (FABLE tur12) */
  function prevOfficialPids(db,M){const out=new Set();for(const c of["Servis","Acil"])for(const p of((M.priorOfficial&&M.priorOfficial[c]&&M.priorOfficial[c].persons)||[]))out.add(resolve(db,p.name));for(const x of M.priorManual||[])if(x.kind==="duty")out.add(x.pid);return out;}
  function newStarterInfo(db,M,p,prevAct,prevOff){
    if(!p||p.excluded||!(p.rows||[]).length)return null;const st=M.staff?.[p.pid]||{};if(st.startChecked||st.startDate)return null;
    if((prevOff||prevOfficialPids(db,M)).has(p.pid))return null;
    if((M.leaves||[]).some(l=>l.pid===p.pid&&/başlamadı/i.test(l.kind||"")))return null;
    const first=p.rows.map(r=>r.date).sort()[0];if(!first||first<=C.monthDates(M.month)[0])return null;
    const orient=p.rows.some(r=>r.orientation);const notPrev=!!prevAct&&!prevAct.has(p.pid);if(!orient&&!notPrev)return null;
    return{pid:p.pid,first,orient,notPrev,message:`${p.name}: bu ay ilk fiilî kaydı ${C.fmtDate(first)}${orient?" (oryantasyon nöbeti)":""}${notPrev?`; ${C.monthLabel(C.prevMonth(M.month))} fiilî listesinde yok`:""}. Yeni başladıysa ay başından başladığı günün öncesine kadar “Henüz başlamadı” izni girin (Adım 2); girilmezse resmî çizelge başlamadan önceki günlere nöbet yazabilir. Daha önce de çalışıyorsa Adım 2'de “başlangıç kontrol edildi” işaretleyin.`};
  }
  function newStarterFlags(db,M,staff){const prevAct=prevActualPids(db,M),prevOff=prevOfficialPids(db,M);const out=new Map();for(const p of staff||staffSummary(db,M)){const i=newStarterInfo(db,M,p,prevAct,prevOff);if(i)out.set(p.pid,i);}return out;}

  /* ---------------- ön koşullar (veri eksikliği) ---------------- */
  function preflight(db,M,staff,bnd){
    const out=[];const e=(code,message,extra={})=>out.push({level:"error",code,message,...extra});const w=(code,message,extra={})=>out.push({level:"warning",code,message,...extra});
    if(!M.actualSource&&!M.actual.some(r=>r.manual))e("NO_ACTUAL","Bu ayın fiilî nöbet listesi yüklenmedi.");
    else if(M.actualSource&&!M.actualSource.confirmed)e("IMPORT_NOT_CONFIRMED","Fiilî liste içe aktarımı onaylanmadı (Adım 1'de önizlemeyi kontrol edip 'Onayla').");
    /* aktif fiilî kayıt ayın içinde olmalı: tarihi boş/ay dışı aktif kayıt hakedişten SESSİZCE düşerdi (FABLE tur12b T12b-1) */
    for(const r of misplacedActual(db,M))e("ACTUAL_DATE_OUTSIDE",`Fiilî kayıt “${r.rawName||"(adsız)"}” ${r.unit||""}: tarihi ${r.date?C.fmtDate(r.date):"BOŞ"} — ${C.monthLabel(M.month)} dışında olduğu için hakedişe katılamıyor. Adım 1 → “Okunan kayıtları listele / düzelt” → listenin EN ÜSTÜNDEKİ kırmızı satırda tarihi düzeltin ya da gerekçesiyle “Yok say”.`,{recordId:r.id});
    const impErr=(M.actualSource?.issues||[]).filter(i=>i.level==="error");
    if(impErr.length&&!M.actualSource.errorsAcknowledged)e("IMPORT_HAS_ERRORS",`Fiilî liste içe aktarımında ${impErr.length} hata var (${impErr.slice(0,2).map(i=>i.message).join(" · ")}). Dosyayı düzeltin veya hatalara rağmen açık onay verin.`);
    const s=M.settings;
    if(C.num(s.emergencyCap)==null)e("EMERGENCY_CAP_MISSING","Günlük Acil üst sınırı girilmedi.");
    if(C.num(s.emergencyMin)==null)e("EMERGENCY_MIN_MISSING","Günlük Acil asgari kadrosu girilmedi (0 da olabilir; klinik yönetimince belirlenmeli).");
    if(C.num(s.serviceMin)==null)e("SERVICE_MIN_MISSING","Günlük Servis asgari kadrosu girilmedi (0 da olabilir; klinik yönetimince belirlenmeli).");
    /* resmî tatil ve yarım gün soruları: cevapsız → çizelge yok (program tahmin etmez) */
    const sd=s.specialDays||{};const hol=(s.holidays||[]).filter(h=>h.kind!==HALF),half=(s.holidays||[]).filter(h=>h.kind===HALF);
    if(sd.holiday==null)e("HOLIDAY_QUESTION",`${C.monthLabel(M.month)}: “Bu ay resmî tatil var mı?” sorusu cevaplanmadı (Adım 3). Program tatil günlerini tahmin etmez.`);
    if(sd.halfDay==null)e("HALFDAY_QUESTION",`${C.monthLabel(M.month)}: “Bu ay yarım gün çalışma (ör. bayram arifesi) var mı?” sorusu cevaplanmadı (Adım 3).`);
    if(sd.holiday===true&&!hol.length)e("HOLIDAY_DAYS_MISSING","Bu ay resmî tatil VAR dendi ama tatil günü girilmedi.");
    if(sd.holiday===false&&hol.length)e("HOLIDAY_ANSWER_CONFLICT",`“Resmî tatil yok” dendi ama listede ${hol.map(h=>C.fmtDate(h.date)).join(", ")} var — cevabı ya da listeyi düzeltin.`);
    if(sd.halfDay===true&&!half.length)e("HALFDAY_DAYS_MISSING","Bu ay yarım gün VAR dendi ama yarım gün girilmedi.");
    if(sd.halfDay===false&&half.length)e("HALFDAY_ANSWER_CONFLICT",`“Yarım gün yok” dendi ama listede ${half.map(h=>C.fmtDate(h.date)).join(", ")} var — cevabı ya da listeyi düzeltin.`);
    for(const h of hol)if(!h.confirmed)e("HOLIDAY_UNCONFIRMED",`${C.fmtDate(h.date)} ${h.label}: resmî tatil FMS değeri onaylanmadı (değilse listeden çıkarın).`);
    /* yarım gün (arefe) FMS'i sorulmaz: yetkili kuralı (hafta içi 19, hafta sonu günün normal değeri) — tablo değeri boşaltılmışsa engel */
    for(const h of half)if(stdFms(db,M,h.date)==null)e("HALFDAY_FMS_EMPTY",`${C.fmtDate(h.date)} ${h.label}: arefe (yarım gün) nöbet FMS değeri tabloda boş (Adım 3 → Standart FMS tablosu).`);
    const prevAct=prevActualPids(db,M),prevOff=prevOfficialPids(db,M);
    for(const p of staff){
      if(p.excluded)continue;
      {const ns=newStarterInfo(db,M,p,prevAct,prevOff);if(ns)w("NEW_STARTER_CHECK",ns.message,{pid:p.pid,firstDate:ns.first});}
      /* izinli girilen günde fiilî nöbet: tarihlerden biri yanlış olabilir */
      for(const r of p.rows)for(const l of M.leaves||[])if(l.pid===p.pid&&r.date>=l.start&&r.date<=l.end)w("ACTUAL_DURING_LEAVE",`${p.name} ${C.fmtDate(r.date)}: “${l.kind||"izin"}” (${C.fmtDate(l.start)}–${C.fmtDate(l.end)}) girilmiş ama fiilî listede o gün nöbeti var (${r.unit}). İzin tarihlerini ya da fiilî kaydı kontrol edin. Resmî kayıtta izinli olup fiilen çalıştıysa (bilinçli durum) sorun yoktur: hakediş fiilî kayda göre sayılır, resmî nöbet izin dışındaki bir güne yazılır.`,{pid:p.pid,recordId:r.id});
      p.rows.filter(r=>r.problems.length).forEach(r=>e("FMS_UNVERIFIED",`${p.name} ${C.fmtDate(r.date)} ${r.unit}: ${r.problems.join("; ")}.`,{pid:p.pid,recordId:r.id}));
      if((p.earnedTarget||0)>0&&!p.allowed.length)e("CATEGORY_UNRESOLVED",`${p.name}: fiilî kaynakta sayılan nöbet yok; resmî kategori için açık yetki gerekli.`,{pid:p.pid});
      for(const r of p.rows)if(r.split&&r.splitKeep)out.push({level:"info",code:"SPLIT_DUTY_MERGED",message:`${p.name} ${C.fmtDate(r.date)}: iki yerde saatli nöbet (${r.split}) — o gün tek tam nöbet sayıldı (kategori Acil, ${r.fms==null?"FMS eksik":C.fmtNum(r.fms)+" FMS"}); özel vardiya FMS'i sorulmadı.`,pid:p.pid,recordId:r.id});
      if(p.reviewNeeded)w("SAME_DAY_REVIEW",`${p.name}: aynı gün birden fazla fiilî kayıt; ikinci tam nöbet hakedişe tekrar sayılmadı — kontrol edin.`,{pid:p.pid});
      if(p.earnedOverride!=null&&p.earnedComputed!=null&&Math.abs(p.earnedOverride-p.earnedComputed)>0.001){const d=C.round2(p.earnedComputed-p.earnedOverride);
        const lines=[...p.rows].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>`${C.fmtDate(r.date).slice(0,5)} ${r.unit}${r.shift?` ${r.shift.start}-${r.shift.end}`:""} ${C.fmtNum(r.fms??0)} FMS → ${C.fmtNum(r.eq??0)}`).join("; ");
        w("EARNED_OVERRIDE_MISMATCH",`${p.name}: onaylı hakediş ${C.fmtNum(p.earnedOverride)} eşdeğer saat, kaynak satırlardan hesaplanan ${C.fmtNum(p.earnedComputed)} (satırlar: ${lines}). ${d>0?`Onaylı değer ${C.fmtNum(d)} saat DÜŞÜK: satırlar doğruysa kişi bu kadar eksik ödenir. Hakedişe girmemesi gereken kayıt varsa onu Adım 1 → “Okunan kayıtları listele” → “Yok say” ile gerekçesiyle hakediş dışı bırakın (kaynak silinmez) ve onaylı değeri silin.`:`Onaylı değer ${C.fmtNum(-d)} saat YÜKSEK: kaynakta eksik kayıt varsa Adım 1'de “Elle fiilî kayıt ekle” ile kaynağıyla ekleyin ve onaylı değeri silin.`} Toplamı elle değiştirmek kayıtla mutabakatı kapatmaz; şu an onaylı değer kullanılıyor.`,{pid:p.pid,difference:d});}
    }
    const sug=aliasSuggestions(db,M.month).filter(x=>x.blocking);
    for(const x of sug)e("ALIAS_DECISION",`İsim eşleştirme kararı bekleniyor: '${x.a}' ↔ '${x.b}' (${x.reason}). Aynı kişi mi? Kimlik/sicil ile teyit edip karar verin.`,{a:x.a,b:x.b});
    return out;
  }

  /* ---------------- problem kurma + çözüm ---------------- */
  function buildProblem(db,M,opts={}){
    const rows=actualRows(db,M);const staff=staffSummary(db,M,rows);const bnd=boundaryBlocks(db,M,staff);
    const dates=C.monthDates(M.month);const fmsByDate=dates.map(d=>stdFms(db,M,d));
    const persons=[];const blockedMap={};
    for(const s of staff){
      if(s.excluded||!(s.earnedTarget>0)||!s.allowed.length)continue;
      const blocks=personBlocks(db,M,s,bnd);blockedMap[s.pid]=blocks;
      const settle=s.staff.settlePrior?Math.max(0,s.openBalance):0;
      const ad={Servis:new Set(),Acil:new Set()},any=new Set();
      s.rows.forEach(r=>{const i=dates.indexOf(r.date);if(i>=0){ad[r.category]?.add(i);any.add(i);}});
      const {avoid,prefer}=softPrefs(M,s.pid);
      const posted=postedDays(db,M,s.pid,dates);
      persons.push({pid:s.pid,name:s.name,target:C.round2(s.earnedTarget+settle),settle,cats:s.allowed,blockedArr:dates.map(d=>blocks.has(d)),actualDates:ad,actualDatesAny:any,avoid,prefer,posted});
    }
    const daily=dailyLimits(M).map(x=>({Servis:x.Servis,Acil:x.Acil}));
    return{rows,staff,bnd,blockedMap,problem:{dates,fmsByDate,factors:db.global.factors,maxDays:db.global.maxDutyDays,minGap:db.global.minGapDays,mode:M.settings.mode,daily,persons,weekend:dates.map(d=>[0,6].includes(C.weekday(d))),timeLimitMs:(opts.timeLimitSec??db.global.timeLimitSec??8)*1000,seed:opts.seed||20260913,weights:opts.weights||db.global.solverWeights||undefined}};
  }
  function run(db,month,opts={}){
    const M=db.months[month];if(!M)throw new Error("Ay bulunamadı.");
    const built=buildProblem(db,M,opts);const pre=preflight(db,M,built.staff,built.bnd);
    const base={generatedAt:new Date().toISOString(),month,priorSignature:priorSignature(M),inputSignature:inputSignature(db,M),monthSignature:monthInputSignature(db,M),inputSigV:INPUT_SIG_V};
    if(pre.some(x=>x.level==="error")){
      const blocked={...base,status:"data_missing",statusText:"Veri/onay eksik — çizelge üretilmedi",assignments:[],issues:pre,solver:null};
      /* önceki bir çizelge varsa SİLİNMEZ: bayat işaretlenir, eksikler ayrıca gösterilir (FABLE tur8 F2) */
      if(M.result&&(M.result.assignments||[]).length){M.result.stale=true;M.result.blockedRun={at:base.generatedAt,issues:pre.filter(x=>x.level==="error")};
        M.stale={reason:`Yeni hesaplama yapılamadı: ${pre.filter(x=>x.level==="error").length} veri/onay eksiği var (Adım 4'te listelenir). Görüntülenen çizelge önceki hesaplamadır.`,at:base.generatedAt};
        log(M,"COZUM","veri eksik — önceki çizelge korundu (bayat): "+pre.filter(x=>x.level==="error").length+" hata");return blocked;}
      M.result=blocked;
      log(M,"COZUM","veri eksik: "+pre.filter(x=>x.level==="error").length+" hata");return M.result;
    }
    const sol=S.solve(built.problem);
    let assignments=(sol.assignments||[]).map((a,i)=>({id:`resmi-${month}-${i+1}`,pid:a.pid,name:personName(db,a.pid),date:a.date,category:a.category,fms:a.fms,eq:a.eq,source:"çözücü"}));
    assignments.sort((a,b)=>a.date.localeCompare(b.date)||a.category.localeCompare(b.category,"tr")||a.name.localeCompare(b.name,"tr"));
    const audit=A.audit(db,M,assignments,{nextFirstDuties:nextMonthFirstDuties(db,M.month)});
    const post=sol.status==="infeasible"?{issues:[],postedDiff:null,overBound:null}:postNotes(db,M,built,assignments,sol);
    const issues=[...pre,...post.issues,...audit];
    let status,statusText;
    if(sol.status==="infeasible"){status="infeasible";statusText="Kanıtlı olarak çözüm yok — kesin kurallar bu verilerle sağlanamaz";
      /* "o gün yazılabilecek 0 kişi" kanıtına NEDEN eklenir: o kategorideki kişilerin o günkü engelleri (izin, ay sınırı…) */
      const why=p=>{if(p.kind!=="day"||!p.date)return"";const reasons=new Map();for(const q of built.problem.persons){if(!q.cats.includes(p.cat)||!(q.target>0))continue;const r=built.blockedMap[q.pid]&&built.blockedMap[q.pid].get(p.date);if(!r)continue;const k=String(r).replace(/\s*\([^)]*\)\s*$/,"");reasons.set(k,(reasons.get(k)||0)+1);}
        return reasons.size?` Nedenler: ${[...reasons.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} (${n} kişi)`).join("; ")}.`:"";};
      issues.unshift(...sol.proof.map(p=>({level:"error",code:"INFEASIBLE_PROOF",message:p.message+why(p)})));assignments=[];}
    else if(sol.status!=="feasible"){status="not_found";statusText=`Süre sınırında (${Math.round((sol.stats?.timeLimitMs||0)/1000)} sn) tüm günlük sınırları sağlayan çözüm BULUNAMADI — bu imkânsızlık kanıtı değildir`;(sol.residual||[]).forEach(r=>issues.unshift({level:"error",code:"SOLVER_RESIDUAL",message:`${C.fmtDate(r.date)} ${r.cat}: ${r.type==="max"?"üst sınır":"asgari"} ${r.by} kişi ${r.type==="max"?"aşıldı":"eksik"} (en iyi deneme).`}));}
    else{const errs=issues.filter(x=>x.level==="error");const incomplete=issues.some(x=>x.incomplete);status=errs.length?"invalid":incomplete?"valid_incomplete":"valid_complete";statusText=errs.length?"Bağımsız denetimde REDDEDİLDİ":incomplete?"Kurallara uygun — ancak eksik veri var; TAM DENETLENDİ DEĞİL":"Geçerli — bağımsız denetimden geçti";}
    M.result={...base,status,statusText,assignments,issues,solver:{engine:"Kişi bazında kesin DP + uyarlamalı ceza fiyatlı yerel arama + kategori iyileştirme",...(sol.stats||{}),status:sol.status},postedDiff:post.postedDiff,overBound:post.overBound,stale:false};
    M.result.reconciliation=reconcile(db,M,M.result);
    M.priorSignatureUsed=M.result.priorSignature;M.stale=null;
    log(M,"COZUM",`${status}; ${assignments.length} resmî görev; ${issues.filter(x=>x.level==="error").length} hata`);
    checkStale(db);
    return M.result;
  }
  /* Elle düzeltme: resmî görev ekle / çıkar, ardından yeniden denetle (çözücü çalıştırmadan). */
  function manualEdit(db,month,edit){
    const M=db.months[month];const r=M.result;if(!r)throw new Error("Önce çizelge üretin.");
    if(edit.type==="remove"){r.assignments=r.assignments.filter(a=>a.id!==edit.id);}
    else if(edit.type==="add"){const pid=edit.pid;const fms=stdFms(db,M,edit.date);r.assignments.push({id:C.uid("elle"),pid,name:personName(db,pid),date:edit.date,category:edit.category,fms,eq:fms==null?null:fms*db.global.factors[edit.category],source:"elle"});r.assignments.sort((a,b)=>a.date.localeCompare(b.date)||a.category.localeCompare(b.category,"tr")||a.name.localeCompare(b.name,"tr"));}
    M.manualEdits.push({...edit,at:new Date().toISOString()});
    reaudit(db,month);log(M,"ELLE_DUZELTME",JSON.stringify(edit));return r;
  }
  /* Son hesaplamadan SONRA resmî listede elle yapılan değişiklikler (yeniden hesaplama bunları siler — kullanıcı isteği 15.10.2026: önce sorulsun) */
  function pendingManualEdits(M){const r=M&&M.result;if(!r||!(r.assignments||[]).length)return[];const g=String(r.generatedAt||"");return(M.manualEdits||[]).filter(e=>String(e.at||"")>g);}
  function reaudit(db,month){
    const M=db.months[month];const r=M.result;if(!r||!r.assignments)return r;
    const built=buildProblem(db,M);const pre=preflight(db,M,built.staff,built.bnd);
    const audit=A.audit(db,M,r.assignments,{nextFirstDuties:nextMonthFirstDuties(db,M.month)});const post=postNotes(db,M,built,r.assignments,null);r.issues=[...pre,...post.issues,...audit];r.postedDiff=post.postedDiff;r.overBound=post.overBound;
    const errs=r.issues.filter(x=>x.level==="error");const incomplete=r.issues.some(x=>x.incomplete);
    r.status=errs.length?"invalid":incomplete?"valid_incomplete":"valid_complete";
    r.statusText=errs.length?"Bağımsız denetimde REDDEDİLDİ":incomplete?"Kurallara uygun — ancak eksik veri var; TAM DENETLENDİ DEĞİL":"Geçerli — bağımsız denetimden geçti";
    r.priorSignature=priorSignature(M);r.inputSignature=inputSignature(db,M);r.monthSignature=monthInputSignature(db,M);r.inputSigV=INPUT_SIG_V;r.stale=false;M.stale=null;delete r.blockedRun;
    r.reconciliation=reconcile(db,M,r);checkStale(db);return r;
  }

  /* ---------------- mutabakat ve devir defteri ---------------- */
  function openBalance(M,pid){return ledgerBalances(M).filter(c=>c.pid===pid).reduce((s,c)=>s+c.open,0);}
  function ledgerBalances(M){
    const claims=new Map();
    for(const e of M.ledger||[])if(e.kind==="carry-open"){claims.set(e.claimId,{claimId:e.claimId,pid:e.pid,sourceMonth:e.sourceMonth,units:C.num(e.units)||0,settled:0,approvedBy:e.approvedBy||"",note:e.note||"",reversed:false});}
    for(const e of M.ledger||[]){const c=claims.get(e.claimId);if(!c)continue;if(e.kind==="payment"||e.kind==="carry-settled")c.settled+=C.num(e.units)||0;if(e.kind==="carry-reversed")c.reversed=true;}
    return[...claims.values()].map(c=>({...c,open:c.reversed?0:Math.max(0,C.round2(c.units-c.settled)),overSettled:c.settled>c.units+1e-9}));
  }
  function addLedger(db,month,ev){
    const M=db.months[month];const e={id:C.uid("defter"),at:new Date().toISOString(),...ev};
    if(["payment","carry-settled"].includes(e.kind)){const bal=ledgerBalances(M).find(c=>c.claimId===e.claimId);if(!bal)throw new Error("Ödeme/mahsup bağlı olduğu alacak kaydı (claimId) bulunamadı.");if((C.num(e.units)||0)>bal.open+1e-9)throw new Error(`Çift ödeme engellendi: açık bakiye ${bal.open}, girilen ${e.units}.`);if(!e.reference)throw new Error("Ödeme/mahsup için bordro/belge referansı zorunlu.");}
    if(e.kind==="carry-open"){if(!e.approvedBy)throw new Error("Devir alacağı açmak için yetkili onayı zorunlu.");e.claimId=e.claimId||C.uid("alacak");}
    M.ledger.push(e);log(M,"DEFTER",`${e.kind} ${e.claimId||""} ${e.units}`);
    if(M.result)M.result.reconciliation=reconcile(db,M,M.result);
    return e;
  }
  function postedOfficial(db,M,pid){
    let found=null;
    for(const cat of["Servis","Acil"]){const src=M.currentOfficial[cat];if(!src)continue;for(const p of src.persons){if(resolve(db,p.name)!==pid)continue;const fms=p.reported?.fms;found=found||{categories:[],fms:0,eq:0,unknown:false,duties:[]};found.categories.push(cat);if(fms==null)found.unknown=true;else{found.fms+=fms;found.eq+=fms*db.global.factors[cat];}found.duties.push(...p.duties.map(d=>({...d,category:cat})));}}
    return found;
  }
  function reconcile(db,M,result){
    const staff=staffSummary(db,M);const a=result?.assignments||[];
    return staff.filter(s=>s.rows.length||s.openBalance||a.some(x=>x.pid===s.pid)).map(s=>{
      const mine=a.filter(x=>x.pid===s.pid);const cats=C.uniq(mine.map(x=>x.category));
      const plannedFms=mine.reduce((z,x)=>z+(x.fms||0),0),plannedEq=C.round2(mine.reduce((z,x)=>z+(x.eq||0),0));
      const posted=postedOfficial(db,M,s.pid);
      const basis=posted&&!posted.unknown?"PROBEL (yüklendi)":"plan (PROBEL teyidi yok)";
      const officialEq=posted&&!posted.unknown?C.round2(posted.eq):plannedEq;
      const diff=s.earnedTarget==null?null:C.round2(s.earnedTarget-officialEq);
      const st=s.staff||{};
      let decision="fark yok",carry=0;
      if(diff!=null&&diff>0.001){
        if(st.paymentStatus==="paid")decision="ödenmiş — devir yok";
        else if(st.paymentStatus==="unpaid"&&st.deferApproved){decision="onaylı açık devir";carry=diff;}
        else decision="mutabakat bekliyor (ödeme durumu/onay eksik)";
      }else if(diff!=null&&diff<-0.001)decision="fazla ödeme planı (fark negatif)";
      return{pid:s.pid,name:s.name,excluded:s.excluded,actualDays:s.actualDays,servisFms:s.servisFms,acilFms:s.acilFms,earnedComputed:s.earnedComputed,earnedOverride:s.earnedOverride,earnedTarget:s.earnedTarget,
        plannedCategory:cats.join(" + ")||"—",plannedDays:C.uniq(mine.map(x=>x.date)).length,plannedFms,plannedEq,
        postedCategory:posted?posted.categories.join(" + "):"",postedFms:posted?posted.fms:null,postedEq:posted&&!posted.unknown?C.round2(posted.eq):null,basis,difference:diff,openingOpen:s.openBalance,decision,carry,closingOpen:C.round2(s.openBalance+carry)};
    });
  }

  /* ---------------- imzalar, ay geçişi, bayatlama ---------------- */
  function officialForMonth(db,month){
    /* Öncelik: yüklenmiş bu-ay PROBEL > uygulama planı */
    const M=db.months[month];if(!M)return null;
    const out={Servis:null,Acil:null};
    for(const cat of["Servis","Acil"]){if(M.currentOfficial[cat])out[cat]={...M.currentOfficial[cat],origin:M.currentOfficial[cat].origin==="upload"?"app-probel":M.currentOfficial[cat].origin};}
    if(!out.Servis&&!out.Acil&&M.result&&M.result.assignments&&M.result.assignments.length&&!["data_missing","infeasible"].includes(M.result.status)){
      for(const cat of["Servis","Acil"]){const persons=new Map();M.result.assignments.filter(x=>x.category===cat).forEach(x=>{const p=persons.get(x.pid)||persons.set(x.pid,{name:personName(db,x.pid),sicil:db.people[x.pid]?.sicil||"",duties:[],nsi:[],blocks:[],boundaryMissing:[]}).get(x.pid);p.duties.push({date:x.date,label:"",fmsStd:x.fms});const nx=C.addDays(x.date,1);if(nx.startsWith(month))p.nsi.push(nx);});
        out[cat]={origin:"app-plan",month,category:cat,planStatus:M.result.status,fileName:`Uygulama planı (${M.result.status==="valid_complete"||M.result.status==="valid_incomplete"?"PROBEL'e girildiği teyit edilmedi":"GEÇERSİZ plan — düzeltin"})`,importedAt:M.result.generatedAt,persons:[...persons.values()]};out[cat].signature=probelSignature(out[cat]);}
    }
    return out.Servis||out.Acil?out:null;
  }
  function pullPriorFromPrevious(db,month,o={}){
    const M=db.months[month];if(!M)return false;const prev=C.prevMonth(month);const off=officialForMonth(db,prev);if(!off)return false;
    let changed=false;
    for(const cat of["Servis","Acil"]){const cur=M.priorOfficial[cat];if(!off[cat])continue;if(cur&&cur.origin==="upload"&&!o.force)continue;if(cur&&cur.origin==="upload"&&o.force&&off[cat].origin==="app-plan")continue;if(!cur||cur.signature!==off[cat].signature){M.priorOfficial[cat]={...off[cat]};changed=true;}}
    if(changed)log(M,"ONCEKI_AY_OTOMATIK",`${C.monthLabel(prev)} resmî kaydı aktarıldı`);
    return changed;
  }
  /* Sürüm 3: önceki sürümden gelen (yüklenmiş PROBEL türevli) listeleri kaldırma. Geçen ayın kaydındaki yüklenmiş kopya da kaldırılır;
     yoksa checkStale onu yeniden getirirdi. Ardından geçen ayın varsa program çizelgesi (app-plan) gelir ve “hepsi burada” onayı ister. */
  const LEGACY_ORIGINS=["upload","app-probel"];
  function dropLegacyPrior(db,month,cat){const M=db.months[month];if(!M||!M.priorOfficial[cat])return null;const was=M.priorOfficial[cat].origin;
    M.priorOfficial[cat]=null;const P=db.months[C.prevMonth(month)];if(P&&P.currentOfficial&&P.currentOfficial[cat]&&P.currentOfficial[cat].origin==="upload")P.currentOfficial[cat]=null;
    pullPriorFromPrevious(db,month);if(M.result)M.result.stale=true;log(M,"ESKI_PROBEL_KALDIR",`geçen ay ${cat} (${was})`);checkStale(db);return M.priorOfficial[cat];}
  function dropLegacyCurrent(db,month){const M=db.months[month];if(!M)return;M.currentOfficial={Servis:null,Acil:null};if(M.result)M.result.stale=true;log(M,"ESKI_PROBEL_KALDIR","bu ay");checkStale(db);}
  function priorSignature(M){return C.sha256Text(JSON.stringify([M.priorOfficial.Servis?.signature||"",M.priorOfficial.Acil?.signature||"",M.priorManual,M.priorListsComplete,M.settings.safeBoundary,!!M.priorPlanConfirmed]));}
  function inputSignature(db,M){return C.sha256Text(JSON.stringify([M.actual.map(r=>[r.id,r.rawName,r.date,r.unit,r.status,r.fmsOverride]),M.exclusions,M.leaves,M.unavailable,M.staff,M.settings,M.dailyRequirements,db.global,db.aliases]));}
  /* sürüm 2: genel isim haritası yerine bu ayın isimlerinin çözümlendiği kimlikler — başka aydaki isim kararı bu ayı bayatlatmaz */
  /* sürüm 3: resmî listelerdeki (önceki ay / bu ay PROBEL) adların çözümlendiği kimlikler de imzada (FABLE tur11 F1f) */
  const INPUT_SIG_V=3;
  function officialNameIds(db,M){return[M.priorOfficial,M.currentOfficial].map(o=>["Servis","Acil"].map(c=>((o&&o[c]&&o[c].persons)||[]).map(p=>[C.personKey(p.name),resolve(db,p.name)])));}
  function monthInputSignature(db,M){const s=M.settings||{};return C.sha256Text(JSON.stringify([M.actual.map(r=>[r.id,r.rawName,resolve(db,r.rawName),r.date,r.unit,r.status,r.fmsOverride,r.shift||null,!!r.orientation]),officialNameIds(db,M),M.exclusions,M.leaves,M.unavailable,M.staff,{...s,rulesConfirmed:undefined,approvedBy:undefined},M.dailyRequirements,db.global.fmsTable,db.global.factors,db.global.maxDutyDays,db.global.minGapDays,db.global.specialShiftRules,db.global.orientationRule]));}
  /* Önceki ayın resmî kaydı değiştiyse bağlı sonraki ayın sonucu 'bayat' (yeniden denetim gerekli). */
  function checkStale(db){
    for(const month of Object.keys(db.months).sort()){
      const M=db.months[month];
      pullPriorFromPrevious(db,month);
      if(M.result&&M.result.priorSignature&&M.result.priorSignature!==priorSignature(M)){M.result.stale=true;M.stale={reason:`${C.monthLabel(C.prevMonth(month))} resmî kaydı veya ay sınırı bilgisi değişti; bu ayın çizelgesi yeniden denetlenmeli. Eski onay geçersiz.`,at:new Date().toISOString()};}
      /* ayın kendi girdileri (fiilî kayıtlar, isim çözümlemesi, izin, kural, FMS…) çözümden sonra değiştiyse */
      else if(M.result&&!M.result.stale&&M.result.inputSigV===INPUT_SIG_V&&M.result.monthSignature&&M.result.monthSignature!==monthInputSignature(db,M)){M.result.stale=true;M.stale={reason:"Bu ayın girdileri (fiilî kayıt, isim kararı, izin, kural veya FMS) çizelgeden sonra değişti; yeniden hesaplanmalı.",at:new Date().toISOString()};}
    }
  }
  function carryToNext(db,month,by=""){
    const M=db.months[month];const r=M.result;if(!r||!["valid_complete","valid_incomplete"].includes(r.status))throw new Error("Önce geçerli bir çizelge üretin.");
    const nm=C.nextMonth(month);const N=ensureMonth(db,nm);
    const rec=reconcile(db,M,r);const existing=new Set(N.ledger.map(e=>e.claimId+"|"+e.kind));
    for(const e of nextLedgerEntries(db,month))if(!existing.has(e.claimId+"|"+e.kind)){N.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),...e});existing.add(e.claimId+"|"+e.kind);}
    /* açık önceki alacaklar */
    for(const c of ledgerBalances(M))if(c.open>0.001&&!existing.has(c.claimId+"|carry-open"))N.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),kind:"carry-open",claimId:c.claimId,pid:c.pid,sourceMonth:c.sourceMonth,units:c.open,approvedBy:c.approvedBy,note:`${C.monthLabel(month)} kapanışından devreden açık bakiye`});
    for(const x of rec){
      if(x.decision==="onaylı açık devir"&&x.carry>0){const claimId=`alacak-${month}-${x.pid}`;if(!existing.has(claimId+"|carry-open"))N.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),kind:"carry-open",claimId,pid:x.pid,sourceMonth:month,units:x.carry,approvedBy:M.settings.approvedBy,note:`${C.monthLabel(month)} dönem farkı (ödenmemiş, onaylı)`});}
      else if(x.decision.startsWith("mutabakat bekliyor")){const claimId=`bekleyen-${month}-${x.pid}`;if(!existing.has(claimId+"|reconciliation-pending"))N.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),kind:"reconciliation-pending",claimId,pid:x.pid,sourceMonth:month,units:x.difference,note:"Ödeme durumu/yetkili onayı bekleniyor — kesin alacak DEĞİL"});}
      else if(x.decision==="ödenmiş — devir yok"){const claimId=`odenmis-${month}-${x.pid}`;if(!M.ledger.some(e=>e.claimId===claimId&&e.kind==="note"))M.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),kind:"note",claimId,pid:x.pid,units:x.difference,note:"Plan farkı bordroda ödenmiş olarak işaretlendi; devredilmedi"});}
    }
    pullPriorFromPrevious(db,nm,{force:true});
    log(M,"SONRAKI_AYA_DEVIR",`${nm}; ${by}`);log(N,"DEVIR_ALINDI",`${month} kapanışı`);
    checkStale(db);
    return N;
  }

  /* ---------------- aydan aya taşıma (sürüm 3): çıktı Excel'indeki “PROGRAM VERİSİ” ----------------
     Program kalıcı veri tutmaz. Bir sonraki ayın ihtiyaç duyduğu bilgi bu ayın çıktı Excel'ine yazılır ve gelecek ay o dosyadan geri okunur:
     resmî çizelge (önerilen plan ve varsa yüklenen PROBEL listeleri — ay başı dinlenme kuralı için), isim kararları, özel vardiya/oryantasyon/FMS kuralları,
     ay sonunu aşan izinler ve tercihler, başlama/ayrılış/klinik yetki, sonraki aya devreden defter kayıtları, ayın kural önerileri ve tatil cevapları.
     Kişiler kimlikle değil ADLA taşınır; kurum sicil numarası taşınmaz. */
  const CARRY_FORMAT="pediatri-nobet-devir",CARRY_V=1;
  /* sonraki ayın defterine geçecek kayıtlar (carryToNext ile aynı kural) */
  function nextLedgerEntries(db,month){
    const M=db.months[month];const r=M.result;const out=[];if(!r)return out;
    for(const c of ledgerBalances(M))if(c.open>0.001)out.push({kind:"carry-open",claimId:c.claimId,pid:c.pid,sourceMonth:c.sourceMonth,units:c.open,approvedBy:c.approvedBy,note:C.monthLabel(month)+" kapanışından devreden açık bakiye"});
    for(const x of reconcile(db,M,r)){
      if(x.decision==="onaylı açık devir"&&x.carry>0)out.push({kind:"carry-open",claimId:"alacak-"+month+"-"+x.pid,pid:x.pid,sourceMonth:month,units:x.carry,approvedBy:M.settings.approvedBy,note:C.monthLabel(month)+" dönem farkı (ödenmemiş, onaylı)"});
      else if(x.decision.startsWith("mutabakat bekliyor"))out.push({kind:"reconciliation-pending",claimId:"bekleyen-"+month+"-"+x.pid,pid:x.pid,sourceMonth:month,units:x.difference,note:"Ödeme durumu/yetkili onayı bekleniyor — kesin alacak DEĞİL"});}
    return out;
  }
  function carryPayload(db,month,result){
    const M=db.months[month];const r=result||M.result;const nm=pid=>personName(db,pid);const last=C.monthDates(month).slice(-1)[0];
    const posted={};for(const cat of["Servis","Acil"]){const src=M.currentOfficial&&M.currentOfficial[cat];if(src&&src.origin!=="app-plan")posted[cat]=(src.persons||[]).map(p=>({name:p.name,duties:(p.duties||[]).map(d=>d.date),nsi:p.nsi||[],boundaryMissing:p.boundaryMissing||[]}));}
    const keepSt=["startDate","endDate","authorizedCategory","authorizedBy"];
    const S=M.settings||{};const g=db.global;
    /* generatedAt = çizelgenin hesaplandığı an (içe alırken geçen ayın planının zamanı olarak kullanılır; aynı çizelge aynı veriyi üretir) */
    return{format:CARRY_FORMAT,v:CARRY_V,app:C.VERSION,month,generatedAt:(r&&r.generatedAt)||new Date().toISOString(),status:r?r.status:null,stale:!!(r&&r.stale),
      plan:(r&&r.assignments||[]).map(a=>({name:nm(a.pid),date:a.date,category:a.category})),posted,
      settings:{emergencyCap:S.emergencyCap,emergencyMin:S.emergencyMin,serviceMin:S.serviceMin,serviceMax:S.serviceMax,mode:S.mode,approvedBy:S.approvedBy,safeBoundary:S.safeBoundary,respectCurrentProbelNsi:S.respectCurrentProbelNsi,keepPosted:S.keepPosted,specialDays:S.specialDays,holidays:(S.holidays||[]).map(h=>({...h}))},
      leaves:(M.leaves||[]).filter(l=>okDate(l.start)&&okDate(l.end)&&l.end>last).map(l=>({name:nm(l.pid),start:l.start,end:l.end,kind:l.kind,note:l.note||""})),
      unavailable:(M.unavailable||[]).filter(u=>okDate(u.start)&&okDate(u.end)&&u.end>last).map(u=>({name:nm(u.pid),start:u.start,end:u.end,mode:u.mode,note:u.note||""})),
      staff:Object.entries(M.staff||{}).map(([pid,st])=>{const k={};for(const f of keepSt)if(st[f])k[f]=st[f];return Object.keys(k).length?{name:nm(pid),...k}:null;}).filter(Boolean),
      ledger:nextLedgerEntries(db,month).map(e=>({...e,pid:undefined,name:nm(e.pid)})),
      aliases:Object.entries(db.aliases||{}).filter(([k,pid])=>"p:"+k!==pid).map(([k,pid])=>({spelling:k,name:nm(pid)})),
      rejected:Object.keys(db.aliasRejected||{}),
      global:{fmsTable:{...g.fmsTable},factors:{...g.factors},maxDutyDays:g.maxDutyDays,minGapDays:g.minGapDays,orientationRule:g.orientationRule,specialShiftRules:(g.specialShiftRules||[]).map(x=>({start:x.start,end:x.end,fms:{...x.fms},note:x.note||""}))}};
  }
  /* Geçen ayın çıktısındaki taşıma verisini bu aya uygular. Aynı dosya tekrar yüklenirse kayıt çoğalmaz. */
  function applyCarryPayload(db,month,p,meta={}){
    if(!p||p.format!==CARRY_FORMAT)throw new Error("Bu, programın aydan aya taşıma verisi değil.");
    if(p.v!==CARRY_V)throw new Error("Taşıma verisi farklı bir biçim sürümüne ait ("+p.v+"); bu program "+CARRY_V+" bekliyor.");
    validateCarry(p);
    const prev=C.prevMonth(month);if(p.month!==prev)throw new Error("Bu dosya "+C.monthLabel(p.month)+" ayına ait. "+C.monthLabel(month)+" için "+C.monthLabel(prev)+" ayının çıktısı gerekir.");
    const fresh=!db.months[month];const M=ensureMonth(db,month);const at=new Date().toISOString();const notes=[];
    /* isim kararları (mevcut kararlar korunur) */
    let nAlias=0;for(const a of p.aliases||[]){if(!a||!a.spelling||!a.name||db.aliases[a.spelling])continue;const to=ensurePerson(db,a.name);if("p:"+a.spelling===to)continue;db.aliases[a.spelling]=to;db.aliasLog.push({at,from:a.spelling,to:a.name,by:"önceki ay çıktısı"});nAlias++;}
    let nRej=0;for(const k of p.rejected||[])if(k&&!db.aliasRejected[k]){db.aliasRejected[k]={at,by:"önceki ay çıktısı"};nRej++;}
    /* tüm aylara ait kurallar: özel vardiya FMS değerleri yalnız boş kutulara; FMS tablosu/katsayılar varsayılandaysa */
    const g=db.global,pg=p.global||{},def=defaultGlobal();
    for(const x of pg.specialShiftRules||[]){const cur=g.specialShiftRules.find(y=>y.start===x.start&&y.end===x.end);
      if(!cur)g.specialShiftRules.push({id:C.uid("vardiya"),start:x.start,end:x.end,fms:{...x.fms},note:"önceki ay çıktısından"});
      else for(const k of Object.keys(x.fms||{}))if(cur.fms[k]==null&&x.fms[k]!=null)cur.fms[k]=x.fms[k];}
    if(g.orientationRule==null&&pg.orientationRule!=null)g.orientationRule=pg.orientationRule;
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for(const k of["fmsTable","factors","maxDutyDays","minGapDays"])if(pg[k]!=null&&!same(pg[k],g[k])){if(same(g[k],def[k]))g[k]=JSON.parse(JSON.stringify(pg[k]));else notes.push(k+" bu oturumda değiştirilmiş; önceki ayın değeri ALINMADI");}
    /* geçen ayın kaydı (salt okunur özet) */
    const P=ensureMonth(db,prev);const ps=p.settings||{};
    P.settings={...P.settings,...ps,holidays:(ps.holidays||[]).map(h=>({...h})),rulesConfirmed:true};
    P.importedFrom={file:meta.name||"",sha:meta.sha||"",at,app:p.app,status:p.status,stale:!!p.stale};
    const fms=d=>stdFms(db,P,d);
    P.result={generatedAt:p.generatedAt,month:prev,status:p.status||"valid_incomplete",statusText:"Önceki ayın çıktı Excel'inden alındı",imported:true,stale:false,issues:[],
      assignments:(p.plan||[]).map((a,i)=>{const f=fms(a.date);return{id:"devir-"+prev+"-"+(i+1),pid:ensurePerson(db,a.name),name:a.name,date:a.date,category:a.category,fms:f,eq:f==null?null:f*g.factors[a.category],source:"önceki ay çıktısı"};})};
    for(const cat of["Servis","Acil"]){const L=(p.posted||{})[cat];if(!L)continue;
      P.currentOfficial[cat]={origin:"upload",category:cat,fileName:"önceki ay çıktısından (yüklenmiş PROBEL listesi)",importedAt:at,month:prev,
        persons:L.map(x=>({name:x.name,sicil:"",duties:(x.duties||[]).map(d=>({date:d,label:"",fmsStd:fms(d)})),nsi:x.nsi||[],blocks:[],work:[],weekendWork:[],boundaryMissing:x.boundaryMissing||[],issues:[]}))};
      P.currentOfficial[cat].signature=probelSignature(P.currentOfficial[cat]);L.forEach(x=>ensurePerson(db,x.name));}
    const lid=(kind,o)=>"devir-"+kind+"-"+prev+"-"+C.sha256Text(JSON.stringify(o)).slice(0,10);
    P.leaves=(p.leaves||[]).map(l=>({id:lid("izin",l),pid:ensurePerson(db,l.name),start:l.start,end:l.end,kind:l.kind,source:"önceki ay çıktısı",note:l.note||""}));
    P.unavailable=(p.unavailable||[]).map(u=>({id:lid("tercih",u),pid:ensurePerson(db,u.name),start:u.start,end:u.end,mode:u.mode,note:u.note||""}));
    for(const s of p.staff||[]){const pid=ensurePerson(db,s.name);const st=P.staff[pid]||(P.staff[pid]={});for(const k of["startDate","endDate","authorizedCategory","authorizedBy"])if(s[k])st[k]=s[k];}
    /* bu ay: ay sonunu aşan izinler, kişi bilgileri; kurallar yalnız ay yeni açıldıysa öneri olarak */
    if(fresh)carryForwardBasics(db,month);
    else{const first=C.monthDates(month)[0];
      for(const l of P.leaves)if(l.end>=first&&!M.leaves.some(x=>x.id===l.id))M.leaves.push({...l,note:(l.note?l.note+" · ":"")+C.monthLabel(prev)+" kaydından devam"});
      for(const u of P.unavailable)if(u.end>=first&&!M.unavailable.some(x=>x.id===u.id))M.unavailable.push({...u});
      for(const[pid,st]of Object.entries(P.staff)){const keep={};for(const k of["startDate","endDate","authorizedCategory","authorizedBy"])if(st[k])keep[k]=st[k];if(Object.keys(keep).length)M.staff[pid]={...keep,...(M.staff[pid]||{})};}
      for(const k of["emergencyCap","emergencyMin","serviceMin","serviceMax"])if(M.settings[k]==null&&ps[k]!=null)M.settings[k]=ps[k];}
    let nLedger=0;const ex=new Set(M.ledger.map(e=>e.claimId+"|"+e.kind));
    for(const e of p.ledger||[]){if(ex.has(e.claimId+"|"+e.kind))continue;M.ledger.push({id:C.uid("defter"),at,kind:e.kind,claimId:e.claimId,pid:ensurePerson(db,e.name),sourceMonth:e.sourceMonth,units:e.units,approvedBy:e.approvedBy||"",note:(e.note||"")+" (önceki ay çıktısından)"});nLedger++;}
    pullPriorFromPrevious(db,month);
    log(M,"ONCEKI_AY_CIKTISI",(meta.name||"")+": plan "+(p.plan||[]).length+" görev, isim kararı "+nAlias+", devir "+nLedger);
    checkStale(db);
    return{prev,plan:(p.plan||[]).length,posted:Object.fromEntries(Object.entries(p.posted||{}).map(([c,L])=>[c,L.length])),aliases:nAlias,rejected:nRej,leaves:P.leaves.length,staff:(p.staff||[]).length,ledger:nLedger,status:p.status,stale:!!p.stale,notes};
  }

  /* ---------------- sürüm 3: dışarıdan gelen verinin yapı denetimi (FABLE tur13 T13-3 / T13-4) ----------------
     Çalışma dosyası, eski sürüm kaydı ve taşıma verisi UYGULANMADAN ÖNCE denetlenir; bozuksa hiçbir şey değişmez ve
     kullanıcıya anlaşılır ileti verilir (ham JavaScript hatası değil). */
  function validateDb(d){
    /* YALNIZ YAPI (kap) denetimi: bunlar bozuksa veri güvenle okunamaz → reddedilir. Kayıt düzeyindeki kusurlar repairDb'de ayrılır (FABLE tur13c T13c-1) */
    const bad=w=>{throw new Error("dosyanın yapısı bozuk ("+w+")");};
    const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
    if(!obj(d))bad("veri yok");if(d.version!==DB_VERSION)bad("veri sürümü "+d.version);
    if(!obj(d.months))bad("aylar");for(const k of["people","aliases","aliasRejected"])if(d[k]!=null&&!obj(d[k]))bad(k);
    if(!obj(d.global)||!obj(d.global.fmsTable)||!obj(d.global.factors))bad("genel kurallar");
    if(d.global.specialShiftRules!=null&&!Array.isArray(d.global.specialShiftRules))bad("özel vardiyalar");
    for(const[k,M]of Object.entries(d.months)){
      if(!MONTH_RE.test(k)||!obj(M))bad("ay "+k);
      for(const f of["actual","leaves","unavailable","exclusions","ledger"])if(!Array.isArray(M[f]))bad(k+" "+f);
      for(const f of["actualOutside","priorManual","dailyRequirements","manualEdits","auditLog","sourceHistory"])if(M[f]!=null&&!Array.isArray(M[f]))bad(k+" "+f);
      for(const f of["settings","staff","priorOfficial","currentOfficial"])if(!obj(M[f]))bad(k+" "+f);
      if(M.result!=null&&(!obj(M.result)||!Array.isArray(M.result.assignments)))bad(k+" çizelge");
    }
    return true;
  }
  /* Kayıt düzeyindeki kusurlar (ör. yanlış yazılmış izin tarihi) TÜM çalışmayı düşürmez: kusurlu kayıt ayrılır (M.quarantine), etkin ay geçersizse
     boşaltılır; yapılanlar kullanıcıya bildirilmek üzere döner. validateDb'den SONRA çağrılır (FABLE tur13c T13c-1). */
  const MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
  function okDate(s){return C.isYmd(s)&&+s.slice(0,4)>=1900&&+s.slice(0,4)<=2200;}
  function repairDb(d){
    const notes=[];const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
    if(d.activeMonth!=null&&!(typeof d.activeMonth==="string"&&MONTH_RE.test(d.activeMonth))){notes.push("etkin ay geçersizdi ("+String(d.activeMonth).slice(0,20)+"); boşaltıldı");d.activeMonth=null;}
    for(const[k,M]of Object.entries(d.months)){
      const q=[];
      if(M.actual.some(r=>!obj(r))){q.push(...M.actual.filter(r=>!obj(r)).map(r=>({tur:"fiilî kayıt",kayit:r})));M.actual=M.actual.filter(r=>obj(r));}
      for(const r of M.actual)if(r.rawName!=null&&typeof r.rawName!=="string")r.rawName=String(r.rawName);
      for(const f of["leaves","unavailable"]){const good=[],badL=[];for(const l of M[f])(obj(l)&&typeof l.pid==="string"&&okDate(l.start)&&okDate(l.end)?good:badL).push(l);if(badL.length){q.push(...badL.map(l=>({tur:f==="leaves"?"izin":"tercih",kayit:l})));M[f]=good;}}
      if(M.result){if(M.result.issues!=null&&!Array.isArray(M.result.issues))M.result.issues=[];const okA=M.result.assignments.filter(a=>obj(a)&&typeof a.pid==="string"&&typeof a.date==="string");
        if(okA.length!==M.result.assignments.length){q.push(...M.result.assignments.filter(a=>!okA.includes(a)).map(a=>({tur:"çizelge görevi",kayit:a})));M.result.assignments=okA;M.result.stale=true;}}
      if(q.length){M.quarantine=(Array.isArray(M.quarantine)?M.quarantine:[]).concat(q.map(x=>({...x,at:new Date().toISOString()})));notes.push(`${C.monthLabel(k)}: ${q.length} kusurlu kayıt ayrıldı (${[...new Set(q.map(x=>x.tur))].join(", ")})`);}
    }
    return notes;
  }
  function validateCarry(p){
    const bad=w=>{throw new Error("Taşıma verisi beklenen yapıda değil ("+w+"); içe alınmadı, oturum değişmedi.");};
    const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);const str=x=>typeof x==="string"&&x.length>0;const arrOf=(x,f,w)=>{if(x==null)return;if(!Array.isArray(x))bad(w);x.forEach(e=>{if(!f(e))bad(w);});};
    if(!/^\d{4}-\d{2}$/.test(String(p.month)))bad("ay");
    arrOf(p.plan,a=>obj(a)&&str(a.name)&&C.isYmd(a.date)&&String(a.date).startsWith(p.month)&&(a.category==="Servis"||a.category==="Acil"),"çizelge");
    if(p.posted!=null){if(!obj(p.posted))bad("yüklenmiş listeler");for(const L of Object.values(p.posted))arrOf(L,x=>obj(x)&&str(x.name)&&Array.isArray(x.duties)&&x.duties.every(C.isYmd),"yüklenmiş liste");}
    if(p.settings!=null&&!obj(p.settings))bad("ayarlar");
    arrOf(p.leaves,l=>obj(l)&&str(l.name)&&C.isYmd(l.start)&&C.isYmd(l.end),"izinler");arrOf(p.unavailable,l=>obj(l)&&str(l.name)&&C.isYmd(l.start)&&C.isYmd(l.end),"müsait olmama");
    arrOf(p.staff,s=>obj(s)&&str(s.name),"kişi bilgileri");
    arrOf(p.ledger,e=>obj(e)&&str(e.kind)&&str(e.claimId)&&str(e.name)&&Number.isFinite(+e.units),"devir defteri");
    arrOf(p.aliases,a=>obj(a)&&str(a.spelling)&&str(a.name),"isim kararları");arrOf(p.rejected,k=>str(k),"farklı kişi kararları");
    if(p.global!=null){const g=p.global;if(!obj(g))bad("genel kurallar");if(g.fmsTable!=null&&!obj(g.fmsTable))bad("FMS tablosu");if(g.factors!=null&&!obj(g.factors))bad("katsayılar");
      arrOf(g.specialShiftRules,x=>obj(x)&&str(x.start)&&str(x.end)&&obj(x.fms),"özel vardiyalar");}
    return true;
  }
  /* ② geçen ayın son 2 günü: gün başına bilinen resmî nöbetçi sayısı ve bu ayın günlük asgarisine göre beklenen en az sayı (FABLE T13-2) */
  function priorDayCounts(db,M){
    const days=C.priorBoundaryDays(M.month);const by=new Map(days.map(d=>[d,new Set()]));
    for(const cat of["Servis","Acil"]){const s=M.priorOfficial[cat];if(!s)continue;for(const p of s.persons||[])for(const d of p.duties||[])if(by.has(d.date))by.get(d.date).add(resolve(db,p.name));}
    for(const x of M.priorManual||[])if(x.kind==="duty"&&by.has(x.date))by.get(x.date).add(x.pid);
    const st=M.settings||{};const min=(C.num(st.serviceMin)||0)+(C.num(st.emergencyMin)||0);
    return days.map(d=>({date:d,n:by.get(d).size,min,thin:by.get(d).size<min}));
  }

  /* ---------------- v3 yedeğinden göç ---------------- */
  function migrateV3(old){
    const db=newDb();
    for(const[month,m]of Object.entries(old.months||{})){
      const M=ensureMonth(db,month);
      (m.actual||[]).forEach((r,i)=>{if(!r.person||!r.date)return;const f=C.fold(r.subunit||r.unit);const unit=/yenidogan/.test(f)?"Yenidoğan":/yogun bakim/.test(f)?"Yoğun Bakım":/kidemli/.test(f)?"Kıdemli":/acil/.test(f)?"Acil":/servis/.test(f)?"Servis":"";/* bilinmeyen birim tahmin edilmez → kayıt onay bekler */M.actual.push({id:`v3:${r.id||i}`,rawName:r.person,date:r.date,unit,category:C.CATEGORY_OF_UNIT[unit]||null,v3Unit:r.unit||"",shift:null,notes:[r.sourceNote||""].filter(Boolean),orientation:false,flags:["v3"],confidence:"orta",manual:true,status:"active",fmsOverride:r.fmsHours,source:{file:"v3 yedeği",sheet:"",cell:"",cellText:""}});ensurePerson(db,r.person);});
      (m.exclusions||[]).forEach(n=>M.exclusions.push(ensurePerson(db,n)));
      (m.vacations||[]).forEach(v=>M.leaves.push({id:C.uid("izin"),pid:ensurePerson(db,v.person),start:v.start,end:v.end,kind:"yıllık izin",source:"v3",note:v.note||""}));
      (m.priorDuties||[]).forEach(p=>M.priorManual.push({pid:ensurePerson(db,p.person),date:p.date,kind:"duty"}));
      (m.ledger||[]).forEach(e=>{if(e.kind==="claim")M.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),kind:"carry-open",claimId:e.claimId||e.id,pid:ensurePerson(db,e.person),sourceMonth:e.sourceMonth,units:e.units,approvedBy:e.approvedBy||"v3",note:e.note||"v3"});else if(e.kind==="payment")M.ledger.push({id:C.uid("defter"),at:new Date().toISOString(),kind:"payment",claimId:e.claimId,pid:ensurePerson(db,e.person),units:e.units,reference:e.reference||"v3"});});
      M.actualSource={fileName:"v3 yedeğinden aktarıldı",confirmed:false,importedAt:new Date().toISOString(),stats:{},issues:[],format:"v3"};
      log(M,"V3_GOC","Eski sürüm verisi aktarıldı; kontrol edin");
    }
    db.activeMonth=old.activeMonth||Object.keys(db.months)[0]||null;return db;
  }

  return{DB_VERSION,defaultGlobal,newDb,newMonth,ensureMonth,log,resolve,ensurePerson,personName,confirmAlias,rejectAlias,isRejected,aliasSuggestions,
    setActualImport,confirmActualImport,setProbel,probelSignature,actualRows,staffSummary,priorStatus,boundaryBlocks,personBlocks,dailyLimits,preflight,buildProblem,run,manualEdit,pendingManualEdits,reaudit,
    ledgerBalances,openBalance,addLedger,reconcile,postedOfficial,officialForMonth,pullPriorFromPrevious,priorSignature,inputSignature,monthInputSignature,checkStale,carryToNext,carryForwardBasics,nextMonthFirstDuties,stdFms,dayTypeOf,
    newStarterInfo,newStarterFlags,postedDiff,staffingNotes,overBound,INPUT_SIG_V,PRIOR_MANUAL_LABEL,inMonthDate,misplacedActual,recordListModel,LEGACY_ORIGINS,dropLegacyPrior,dropLegacyCurrent,validateDb,validateCarry,priorDayCounts,repairDb,okDate,MONTH_RE,
    CARRY_FORMAT,CARRY_V,nextLedgerEntries,carryPayload,applyCarryPayload,setSpecialDayAnswer,addSpecialDay,priorHolidayInfo,setPriorHolidays,HALF,LEAVE_REASONS,migrateV3};
});
