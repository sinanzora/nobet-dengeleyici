/* Dışa aktarma: resmî çizelgeyi ORİJİNAL hastane tablosunun hücre düzenine yerleştirir + denetim/rapor sayfaları. */
(function(root,factory){const api=factory(root.NobetCore,root.NobetEngine,root.NobetXlsx);if(typeof module==="object"&&module.exports)module.exports=api;root.NobetExport=api;})(typeof globalThis!=="undefined"?globalThis:this,function(C,E,XP){
  "use strict";
  if(typeof require==="function"){C=C||require("./core.js");E=E||require("./engine.js");XP=XP||require("./xlsx-preserve.js");}
  const LABEL=["Pazar","H.İçi","H.İçi","H.İçi","H.İçi","Cuma","C.tesi"];
  /* Resmî tatil nöbetinin PROBEL etiketi. Kanıt: hafta içi tatil (Çarşamba 15.07.2026) PROBEL'de “Pazar” yazılmış.
     Pazar zaten “Pazar”. Cuma/Cumartesiye denk gelen tatilin etiketi kaynakta GÖRÜLMEDİ → tahmin edilmez (FABLE N4).
     Onaysız tatil her zaman işaretlenir. */
  /* PROBEL ekranındaki renkler (kullanıcının PROBEL ekran görüntüleri; 3.3.3'te 15.10.2026 görüntüsüyle düzeltildi): nöbet H.İçi sarı, Cuma mor,
     C.tesi turuncu, Pazar mavi; 08:00-16:00 yeşil; Yİz. açık mavi; Bşl. (başlamadı) turuncu-kırmızı; hafta sonu sütunu gri (H.S., NSİ ve öteki kodlar); NSİ hafta içinde renksiz.
     Doğrulanmamış etiket kırmızı. Öteki izin kodlarının rengi görülmedi: hafta içinde renksiz. */
  function probelStyle(t,weekend){if(/ONAY BEKLİYOR/.test(t))return"error";if(/H\.İçi$/.test(t))return"pHici";if(/Cuma$/.test(t))return"pCuma";if(/C\.tesi$/.test(t))return"pCtesi";if(/Pazar$/.test(t))return"pPazar";if(/^08:00-1[36]:00$/.test(t))return"pMesai";if(t==="Yİz.")return"pYiz";if(t==="Bşl.")return"pBsl";if(t==="Rpr.")return"pRpr";if(t==="GÖREV")return"pGorev";if(t==="R.T.")return"pRt";return weekend?"pHs":null;}
  const PROBEL_LEGEND="Renkler PROBEL ekranındaki gibi: nöbet H.İçi sarı · Cuma mor · C.tesi turuncu · Pazar mavi; 08:00-16:00 yeşil; Yİz. açık mavi; Rpr. mor; GÖREV turkuaz; Bşl. (başlamadı) turuncu-kırmızı; R.T. (resmî tatil) kırmızı, hafta sonuna denk gelirse “H.S. R.T.”; hafta sonu sütunu (H.S., NSİ) gri; NSİ hafta içinde renksiz; ONAY BEKLİYOR kırmızı (etiket doğrulanmadı). Arefe mesaisi 08:00-13:00 ve öteki izinler (Ayr. …) PROBEL'de görülmedi (renksiz).";
  /* 3.3.3 (kullanıcı isteği 15.10.2026): nöbetsiz günler de PROBEL yazımıyla gösterilir. Kanıt: PROBEL metin dökümleri (Temmuz/Ağustos 2026) —
     hafta içi “08:00-16:00”, hafta sonu “H.S.”, izinler “Yİz.”, “Rpr.”, “GÖREV”, “Ayr.”, başlama öncesi “Bşl.”, resmî tatil “R.T.” (hafta sonunda “H.S. R.T.”) (kullanıcının PROBEL ekran görüntüleri); izin hafta sonuna taşarsa
     hafta sonu da izin kodu (Yİz., Rpr., Bşl.) — görevlendirme hariç: GÖREV hafta sonu H.S. kalır. PROBEL’de görülmeyen kodlar tahmin edilmez: öteki izinler programdaki adıyla. */
  const LEAVE_CODE={"yıllık izin":"Yİz.","rapor":"Rpr.","görevlendirme":"GÖREV","işten ayrıldı":"Ayr.","görevi sona erdi":"Ayr.","henüz başlamadı":"Bşl.","doğum sonrası izni":"Doğum sonrası izni","mazeret izni":"Mazeret izni"};
  function leaveCode(kind){const k=String(kind||"").toLocaleLowerCase("tr").trim();return LEAVE_CODE[k]||(k&&k!=="diğer"?String(kind):"İzin");}
  function offDayText(db,M,pid,d){
    const wd=C.weekday(d),we=wd===0||wd===6;const h=(M.settings.holidays||[]).find(x=>x.date===d);const hs=h&&h.kind!=="yarım gün"?"H.S. R.T.":"H.S.";
    for(const l of M.leaves||[])if(l.pid===pid&&d>=l.start&&d<=l.end){const code=leaveCode(l.kind);return code==="GÖREV"&&we?hs:code;}
    const st=M.staff?.[pid]||{};if(st.startDate&&d<st.startDate)return"Bşl.";if(st.endDate&&d>st.endDate)return"Ayr.";
    if(we)return hs;
    if(h&&h.kind==="yarım gün")return"08:00-13:00";if(h)return"R.T.";
    return"08:00-16:00";}
  /* geçen ayın son günü resmî nöbeti olanın NSİ’si bu ayın 1. günüdür */
  function priorLastDayDuty(db,M){const last=C.monthDates(C.prevMonth(M.month)).slice(-1)[0];const out=new Set();
    for(const cat of["Servis","Acil"])for(const p of(M.priorOfficial?.[cat]?.persons||[]))if((p.duties||[]).some(x=>x.date===last))out.add(E.resolve(db,p.name));
    for(const x of M.priorManual||[])if(x.kind==="duty"&&x.date===last)out.add(x.pid);return out;}
  function holidayLabel(h,d){if(h.kind==="yarım gün")return"ONAY BEKLİYOR (yarım gün — PROBEL etiketi doğrulanmadı)";if(!h.confirmed)return"ONAY BEKLİYOR (tatil)";const wd=C.weekday(d);if(wd>=0&&wd<=4)return"Pazar";return`ONAY BEKLİYOR (${wd===6?"Cumartesi":"Cuma"} tatili — PROBEL etiketi doğrulanmadı)`;}
  const STATUS_TR={valid_complete:"GEÇERLİ — bağımsız denetimden geçti",valid_incomplete:"KURALLARA UYGUN — EKSİK VERİ (tam denetlendi değil)",invalid:"GEÇERSİZ — denetimde reddedildi",infeasible:"ÇÖZÜM YOK (kanıtlı)",not_found:"ÇÖZÜM BULUNAMADI (zaman sınırı)",data_missing:"VERİ/ONAY EKSİK"};
  /* kişinin kaynaktaki en sık yazımı (resmî sayfada tanıdık görünsün) */
  function spellingMap(db,M){const cnt=new Map();for(const r of M.actual||[]){const pid=E.resolve(db,r.rawName);const m=cnt.get(pid)||cnt.set(pid,new Map()).get(pid);m.set(r.rawName,(m.get(r.rawName)||0)+1);}const out={};for(const[pid,m]of cnt)out[pid]=[...m.entries()].sort((a,b)=>b[1]-a[1])[0][0];return out;}
  function displayFor(db,M,pid,sp){return(sp&&sp[pid])||E.personName(db,pid);}

  function officialCellUpdates(db,M,result,opts={}){
    const src=M.actualSource;if(!src||!src.header||!src.blocks)throw new Error("Orijinal tablo düzeni bilinmiyor (içe aktarma bilgisi yok).");
    const sp=spellingMap(db,M);const units=src.header.units;const merged=opts.mergedNonTopLeft||new Set();
    const updates=new Map();const put=(r,c,text)=>{const ref=C.a1(r,c);if(merged.has(ref))return;updates.set(ref,{text:text==null?null:text,lines:text?String(text).split("\n").length:1});};
    const month=M.month;const prev=C.prevMonth(month);
    const priorNames=(date,cat)=>{const s=M.priorOfficial?.[cat];if(!s)return null;return s.persons.filter(p=>p.duties.some(d=>d.date===date)).map(p=>p.name);};
    for(const b of src.blocks){
      let byUnit={};
      if(b.date.startsWith(month)){const a=(result.assignments||[]).filter(x=>x.date===b.date);byUnit.Servis=a.filter(x=>x.category==="Servis").map(x=>displayFor(db,M,x.pid,sp));byUnit.Acil=a.filter(x=>x.category==="Acil").map(x=>displayFor(db,M,x.pid,sp));}
      else if(b.date.startsWith(prev)){for(const cat of["Servis","Acil"]){const n=priorNames(b.date,cat);byUnit[cat]=n==null?["(önceki ay resmî liste yüklenmedi)"]:n.length?n:[];}}
      else{byUnit={};}
      for(const[unit,col]of Object.entries(units)){
        const names=unit==="Servis"?(byUnit.Servis||[]):unit==="Acil"?(byUnit.Acil||[]):[];
        const rows=b.rows;
        if(rows.length===1){put(rows[0],col,names.length?names.join("\n"):null);}
        else{rows.forEach((r,i)=>{if(i<rows.length-1)put(r,col,names[i]??null);else put(r,col,names.slice(i).join("\n")||null);});}
      }
    }
    if(src.titleRef&&!opts.keepTitle){const t=String(src.title||"").trim();updates.set(src.titleRef,{text:`${t} — RESMÎ (PROBEL) ÇİZELGE ÖNERİSİ (Acil ailesi tek kategori: ACİL sütunu)`,lines:1});}
    return updates;
  }
  function probelEntryRows(db,M,result,cat){
    const dates=C.monthDates(M.month);const sp=spellingMap(db,M);
    const by=new Map();for(const a of(result.assignments||[]).filter(x=>x.category===cat)){(by.get(a.pid)||by.set(a.pid,[]).get(a.pid)).push(a);}
    const head=["Personel","Sicil No",...dates.map(d=>{const w=C.weekday(d);return w===0||w===6?{v:String(+d.slice(8)),s:"pHsHead"}:String(+d.slice(8));}),"Nöbet günü","FMS (plan)","Servis-eşdeğeri saat"];
    const isWe=d=>{const w=C.weekday(d);return w===0||w===6;};
    const head2=["","",...dates.map(d=>isWe(d)?{v:C.dayShort(d),s:"pHsHead"}:C.dayShort(d)),"","",""];
    const rows=[[{v:`${C.monthLabel(M.month)} — ${C.trUpper(cat)} RESMÎ NÖBET LİSTESİ (PROBEL GİRİŞ TASLAĞI)`,s:"title"}],head,head2];
    const people=[...by.keys()].sort((a,b)=>displayFor(db,M,a,sp).localeCompare(displayFor(db,M,b,sp),"tr"));const priorLast=priorLastDayDuty(db,M);
    for(const pid of people){const arr=by.get(pid);const set=new Map(arr.map(a=>[a.date,a]));
      const hol=d=>(M.settings.holidays||[]).find(h=>h.date===d);
      const cells=dates.map((d,i)=>{let t="";if(set.has(d)){const h=hol(d);t=`08:00-08:00 ${h?holidayLabel(h,d):LABEL[C.weekday(d)]}`;}else if(set.has(C.addDays(d,-1))||(i===0&&priorLast.has(pid)))t="NSİ";if(!t)t=offDayText(db,M,pid,d);return{v:t,s:probelStyle(t,isWe(d))};});
      rows.push([displayFor(db,M,pid,sp),db.people[pid]?.sicil||"",...cells,arr.length,arr.reduce((z,a)=>z+(a.fms||0),0),C.round2(arr.reduce((z,a)=>z+(a.eq||0),0))]);}
    rows.push([]);rows.push([{v:PROBEL_LEGEND,s:"warn"}]);rows.push([{v:"Not: NSİ = nöbet ertesi izin (ücretli nöbet değildir). Ay sonundaki nöbetin NSİ'si sonraki ayın 1. günüdür. Bu taslağı PROBEL'e girmeden önce kontrol edin.",s:"warn"}]);
    return{rows,widths:[26,10,...dates.map(()=>9),10,10,12],header:true,headerRow:1,freeze:3};
  }
  /* ay sonu kaydının durumu — ekran, rapor ve PROBEL giriş dosyasında aynı ifade */
  function priorText(db,M){const ps=E.priorStatus(db,M);return`Servis: ${M.priorOfficial.Servis?"var ("+(M.priorOfficial.Servis.origin==="app-plan"?"uygulama planı":M.priorOfficial.Servis.fileName)+")":"YOK"} · Acil: ${M.priorOfficial.Acil?"var ("+(M.priorOfficial.Acil.origin==="app-plan"?"uygulama planı":M.priorOfficial.Acil.fileName)+")":"YOK"}${(M.priorManual||[]).some(x=>x.kind==="duty")?` · elle girilen ay sonu nöbeti: ${M.priorManual.filter(x=>x.kind==="duty").length}`:""}${ps.complete?(ps.manualFill?" → "+E.PRIOR_MANUAL_LABEL:" → tam"):" → ay başı sınırı TAM DOĞRULANMADI"}`;}
  function postedRows(r){const pd=r.postedDiff;if(!pd)return null;return[["Tarih","Gün","Personel","Kategori","Değişiklik"],...pd.removed.map(x=>[C.fmtDate(x.date),C.dayName(x.date),x.name,x.category,"KALDIRILACAK (PROBEL'de var, öneride yok)"]),...pd.added.map(x=>[C.fmtDate(x.date),C.dayName(x.date),x.name,x.category,"EKLENECEK (öneride var, PROBEL'de yok)"]),[],[`Özet: PROBEL'e işlenmiş ${pd.posted} nöbetin ${pd.kept} tanesi aynen korunuyor; ${pd.removed.length} kaldırılacak, ${pd.added.length} eklenecek. “İşlenmiş nöbetleri koru”: ${pd.keepPosted?"açık":"kapalı"}.`]];}
  /* AYDAN AYA TAŞIMA (sürüm 3): program kalıcı veri tutmaz; gelecek ayın ihtiyaç duyduğu bilgi bu sayfada (JSON parçaları + SHA-256) taşınır.
     Hücre başına en çok 32.767 karakter olduğundan veri 30.000 karakterlik parçalara bölünür. Sayfa değiştirilirse içe alınmaz. */
  const CARRY_SHEET="PROGRAM VERİSİ",CARRY_CHUNK=30000;
  /* metni en çok n karakterlik parçalara böler; vekil çifti (ör. emoji) iki parçaya ayrılmaz (FABLE T13-6) */
  function chunkText(s,n){const out=[];let i=0;while(i<s.length){let e=Math.min(i+n,s.length);if(e<s.length&&e>i+1){const c=s.charCodeAt(e-1);if(c>=0xD800&&c<=0xDBFF)e--;}out.push(s.slice(i,e));i=e;}return out;}
  /* JSON'da Excel/XML'in taşıyamayacağı karakterler \uXXXX kaçışıyla yazılır (JSON aynı metne çözülür; SHA bozulmaz) */
  const jsonForXml=j=>j.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uFFFE\uFFFF\uD800-\uDFFF]/g,(m,c)=>c||"\\u"+m.charCodeAt(0).toString(16).padStart(4,"0"));
  function carrySheet(db,M,r,o={}){const p=E.carryPayload(db,M.month,r);const json=jsonForXml(JSON.stringify(p));const sha=C.sha256Text(json);const parts=chunkText(json,o.chunk||CARRY_CHUNK);
    return{name:CARRY_SHEET,header:false,titleRow:true,widths:[18,140],rows:[[{v:"PROGRAM VERİSİ — bu sayfayı DEĞİŞTİRMEYİN. Gelecek ay programda “Geçen ayın program çıktısı” olarak bu dosyayı yükleyin: ay sonu nöbetleri, isim kararları, vardiya FMS değerleri, ay sonunu aşan izinler ve devirler buradan gelir.",s:"title"}],
      ["Biçim",E.CARRY_FORMAT],["Biçim sürümü",E.CARRY_V],["Ay",M.month],["Program sürümü",C.VERSION],["SHA-256",sha],["Parça sayısı",parts.length],...parts.map((x,i)=>["Parça "+(i+1),x])]};}
  /* Çıktı Excel'inden taşıma verisini okur. Döner: {payload, sha} ya da hata fırlatır. */
  function readCarry(XLSX,bytes){const wb=XLSX.read(bytes,{type:"array",sheets:[CARRY_SHEET]});const ws=wb.Sheets[CARRY_SHEET];
    if(!ws)throw new Error("Bu dosyada “"+CARRY_SHEET+"” sayfası yok. Geçen ay bu programın “Excel indir” düğmesiyle aldığınız dosyayı (orijinal + RESMİ ÖNERİ) yükleyin; PROBEL giriş listesi değil.");
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:""});const get=k=>{const r=rows.find(x=>String(x[0]).trim()===k);return r?r[1]:undefined;};
    if(get("Biçim")!==E.CARRY_FORMAT)throw new Error("“"+CARRY_SHEET+"” sayfası tanınmadı.");
    const n=+get("Parça sayısı");if(!(n>0))throw new Error("Taşıma verisi eksik (parça sayısı yok).");
    let json="";for(let i=1;i<=n;i++){const v=get("Parça "+i);if(typeof v!=="string")throw new Error("Taşıma verisinin "+i+". parçası eksik.");json+=v;}
    const sha=C.sha256Text(json);if(sha!==String(get("SHA-256")))throw new Error("“"+CARRY_SHEET+"” sayfası değiştirilmiş görünüyor (SHA-256 tutmuyor); içe alınmadı. Programın ürettiği dosyayı değiştirmeden yükleyin.");
    let payload;try{payload=JSON.parse(json);}catch(e){throw new Error("Taşıma verisi okunamadı.");}return{payload,sha};}
  function reportSheets(db,M,result){
    const sheets=[];const r=result;const errs=(r.issues||[]).filter(i=>i.level==="error"),warns=(r.issues||[]).filter(i=>i.level==="warning");
    const ps=E.priorStatus(db,M);const st=M.settings;
    sheets.push({name:"ÖZET",header:false,titleRow:true,widths:[34,90],rows:[
      [{v:`${C.monthLabel(M.month)} — Resmî nöbet çizelgesi önerisi ve hakediş mutabakatı`,s:"title"}],
      ["Durum",{v:STATUS_TR[r.status]||r.status,s:r.status==="valid_complete"?"ok":r.status==="valid_incomplete"?"warn":"error"}],["Açıklama",r.statusText||""],
      ["Kesin kural hatası",errs.length],["Uyarı",warns.length],["Resmî görev sayısı",(r.assignments||[]).length],
      ["Önceki ay resmî listeleri",priorText(db,M)],
      ["Fazla ödeme (plan)",r.overBound?`${r.overBound.total} eşdeğer saat; kişi bazlı kaçınılmaz alt sınır ${r.overBound.lowerBound}${r.overBound.atBound?" — olası en düşük değer (kanıtlı)":""}`:(st.mode==="defer"?"onaylı devir modunda alt sınır hesaplanmaz":"—")],
      ...(r.postedDiff?[["Bu ayın PROBEL kaydına göre",`${r.postedDiff.kept}/${r.postedDiff.posted} işlenmiş nöbet korunuyor; ${r.postedDiff.removed.length} kaldırılacak, ${r.postedDiff.added.length} eklenecek (ayrıntı: PROBEL FARKI sayfası)`]]:[]),
      ["Fiilî kaynak dosya",`${M.actualSource?.fileName||"—"} / sayfa '${M.actualSource?.sheetName||"—"}' / SHA-256 ${M.actualSource?.fileHash||"—"}`],
      ["Kurallar",`Kişi başı en çok ${db.global.maxDutyDays} farklı resmî gün; nöbet başlangıçları arası en az ${db.global.minGapDays} gün (2 tam boş gün); tek kategori; Acil günlük üst ${st.emergencyCap}; Acil asgari ${st.emergencyMin}; Servis asgari ${st.serviceMin}; Servis üst ${st.serviceMax??"yok"}; mod ${st.mode==="defer"?"onaylı devir":"devirsiz kesin koruma"}`],
      ["Resmî tatil / yarım gün (kullanıcı cevabı)",`Tatil: ${st.specialDays?.holiday==null?"CEVAPLANMADI":st.specialDays.holiday?(st.holidays||[]).filter(h=>h.kind!=="yarım gün").map(h=>`${C.fmtDate(h.date)} ${h.label} FMS ${h.fms??"?"}${h.confirmed?"":" (onaysız)"}`).join("; "):"yok"} · Yarım gün: ${st.specialDays?.halfDay==null?"CEVAPLANMADI":st.specialDays.halfDay?(st.holidays||[]).filter(h=>h.kind==="yarım gün").map(h=>`${C.fmtDate(h.date)} ${h.label} FMS ${h.fms??"?"}${h.confirmed?"":" (onaysız)"}`).join("; "):"yok"}`],
      ["FMS tablosu",`Pzt–Prş ${db.global.fmsTable[1]}, Cuma ${db.global.fmsTable[5]}, Cts ${db.global.fmsTable[6]}, Pazar ${db.global.fmsTable[0]}; yetkili kuralı: hafta içi arefe nöbeti ${C.tableFms(db.global.fmsTable,"halfday")}, tek başına gündüz mesaisi (Cts/Paz/tatil) ${C.tableFms(db.global.fmsTable,"daytime")}; Servis ×${db.global.factors.Servis}, Acil ×${db.global.factors.Acil} = Servis-eşdeğeri saat`],
      ["Çözücü",r.solver?`${r.solver.engine}; ${r.solver.elapsedMs} ms; ${r.solver.persons} kişi`:"—"],
      ["Oluşturulma",new Date(r.generatedAt||Date.now()).toLocaleString("tr-TR")],["Uygulama sürümü",C.VERSION],
      ["Önemli","Bu dosya idarî planlama ve denetim desteğidir; klinik/bordro onayı yerine geçmez. Fiilî kayıt, resmî çizelge ve bordro/devir ayrı tutulur."]]});
    const rec=r.reconciliation||E.reconcile(db,M,r);
    sheets.push({name:"KİŞİ HAKEDİŞ",header:true,freeze:1,widths:[26,7,8,10,10,12,11,10,11,8,10,11,11,11,18,9,10,30,9,10],rows:[["Personel","Hariç","Fiilî gün","Fiilî Servis FMS","Fiilî Acil FMS","Hesaplanan eşdeğer","Onaylı hakediş","Hedef eşdeğer","Resmî kategori","Resmî gün","Resmî FMS (plan)","Resmî eşdeğer (plan)","PROBEL FMS (yüklenen)","PROBEL eşdeğer","Karşılaştırma esası","Fark (eşd. saat)","Önceki açık devir","Mutabakat kararı","Devreden","Kapanış açık"],
      ...rec.map(x=>[x.name,x.excluded?"EVET":"",x.actualDays,x.servisFms,x.acilFms,x.earnedComputed??"eksik",x.earnedOverride??"",x.earnedTarget??"eksik",x.plannedCategory,x.plannedDays,x.plannedFms,x.plannedEq,x.postedFms??"",x.postedEq??"",x.basis,x.difference??"",x.openingOpen,{v:x.decision,s:/bekliyor/.test(x.decision)?"warn":x.decision==="onaylı açık devir"?"ok":undefined},x.carry,x.closingOpen])]});
    const dates=C.monthDates(M.month);
    sheets.push({name:"RESMİ LİSTE",header:true,freeze:1,widths:[12,11,60,8,90,8],rows:[["Tarih","Gün","Servis","Servis kişi","Acil ailesi (Acil/YB/YD/Kıdemli tek kategori)","Acil kişi"],...dates.map(d=>{const a=(r.assignments||[]).filter(x=>x.date===d);const s=a.filter(x=>x.category==="Servis").map(x=>x.name),c=a.filter(x=>x.category==="Acil").map(x=>x.name);return[C.fmtDate(d),C.dayName(d),s.join(", "),s.length,c.join(", "),c.length];})]});
    for(const cat of["Servis","Acil"])sheets.push({name:`PROBEL GİRİŞ ${C.trUpper(cat)}`,...probelEntryRows(db,M,r,cat)});
    const rows=E.actualRows(db,M);
    sheets.push({name:"FİİLÎ KAYNAK İZİ",header:true,freeze:1,widths:[11,10,26,26,12,8,12,26,7,26,7,9,12,9,24],rows:[["Tarih","Gün","Kaynaktaki yazım","Eşleşen personel","Bölüm","Kategori","Vardiya notu","Not","FMS","FMS kaynağı","Katsayı","Eşdeğer","Kaynak hücre","Güven","İşaretler"],...rows.map(x=>[C.fmtDate(x.date),C.dayName(x.date),x.rawName,E.personName(db,x.pid),x.unit,x.category,x.shift?`${x.shift.start}-${x.shift.end}`:"",(x.notes||[]).join("; "),x.fms??"eksik",x.fmsSource||x.problems.join("; "),x.factor??"",x.eq??"eksik",`${x.source?.sheet||""}!${x.source?.cell||""}`,x.confidence||"",(x.flags||[]).join(", ")]),
      ...E.misplacedActual(db,M).map(x=>[x.date?(C.isYmd(x.date)?C.fmtDate(x.date):String(x.date)):"BOŞ",C.isYmd(x.date)?C.dayName(x.date):"",x.rawName,E.personName(db,E.resolve(db,x.rawName)),x.unit,x.category,x.shift?`${x.shift.start}-${x.shift.end}`:"",{v:"AY DIŞI (düzeltme sonrası) — hakedişe KATILMADI; tarihi düzeltin ya da Yok say",s:"error"},"","","","",x.manual?"elle":`${x.source?.sheet||""}!${x.source?.cell||""}`,x.confidence||"",(x.flags||[]).join(", ")]),
      ...(M.actual||[]).filter(x=>x.status==="ignored").map(x=>[C.isYmd(x.date)?C.fmtDate(x.date):(x.date||"BOŞ"),C.isYmd(x.date)?C.dayName(x.date):"",x.rawName,E.personName(db,E.resolve(db,x.rawName)),x.unit,x.category,x.shift?`${x.shift.start}-${x.shift.end}`:"",{v:`HAKEDİŞ DIŞI (Yok say)${x.ignoreReason?" — gerekçe: "+x.ignoreReason:" — gerekçe girilmemiş (eski kayıt)"}`,s:"warn"},"","","","",x.manual?"elle":`${x.source?.sheet||""}!${x.source?.cell||""}`,x.confidence||"",(x.flags||[]).join(", ")]),
      ...(M.actualOutside||[]).map(x=>[C.fmtDate(x.date),C.dayName(x.date),x.rawName,E.personName(db,E.resolve(db,x.rawName)),x.unit,x.category,"","AY DIŞI — hakedişe katılmadı","","","","",`${x.source?.sheet||""}!${x.source?.cell||""}`,"",x.outside||""])]});
    const staff=E.staffSummary(db,M);const bnd=E.boundaryBlocks(db,M,staff);
    sheets.push({name:"AY SINIRI",header:true,freeze:1,widths:[26,40,14,60],rows:[["Personel","Kapalı gün(ler)","Tür","Neden"],...[...bnd.blocks.entries()].map(([pid,arr])=>[E.personName(db,pid),arr.map(b=>C.fmtDate(b.date)).join(", "),C.uniq(arr.map(b=>b.kind)).join("/"),C.uniq(arr.map(b=>b.reason)).join(" · ")])]});
    {const pr=postedRows(r);if(pr)sheets.push({name:"PROBEL FARKI",header:true,freeze:1,widths:[12,11,28,10,48],rows:pr});}
    sheets.push({name:"DENETİM",header:true,freeze:1,widths:[10,26,120],rows:[["Seviye","Kod","Açıklama"],...(r.issues||[]).map(i=>[{v:i.level==="error"?"HATA":i.level==="warning"?"UYARI":"BİLGİ",s:i.level==="error"?"error":i.level==="warning"?"warn":undefined},i.code,i.message])]});
    sheets.push(carrySheet(db,M,r));
    sheets.push({name:"DEVİR DEFTERİ",header:true,freeze:1,widths:[20,18,26,26,10,12,18,50],rows:[["Zaman","İşlem","Alacak ID","Personel","Kaynak ay","Eşdeğer saat","Belge/referans","Not"],...(M.ledger||[]).map(e=>[e.at,e.kind,e.claimId||"",E.personName(db,e.pid||""),e.sourceMonth||"",e.units??"",e.reference||e.approvedBy||"",e.note||""]),[],["Açık bakiyeler"],["Alacak ID","Personel","Kaynak ay","Tutar","Ödenen/mahsup","Açık"],...E.ledgerBalances(M).map(c=>[c.claimId,E.personName(db,c.pid),c.sourceMonth,c.units,c.settled,c.open])]});
    return sheets;
  }
  function mergedNonTopLeft(XLSX,bytes,sheetName){const wb=XLSX.read(bytes,{type:"array",sheets:[sheetName],bookFiles:false});const ws=wb.Sheets[sheetName];const set=new Set();for(const m of(ws&&ws["!merges"])||[])for(let r=m.s.r;r<=m.e.r;r++)for(let c=m.s.c;c<=m.e.c;c++)if(!(r===m.s.r&&c===m.s.c))set.add(C.a1(r,c));return set;}
  function buildPreserved(XLSX,origBytes,db,M,result,mode="clone"){
    const merged=mergedNonTopLeft(XLSX,origBytes,M.actualSource.sheetName);
    const updates=officialCellUpdates(db,M,result,{mergedNonTopLeft:merged,keepTitle:false});
    const out=XP.exportPreserving(XLSX,origBytes,{mode,sourceSheet:M.actualSource.sheetName,newSheetName:"RESMİ ÖNERİ",updates,reports:reportSheets(db,M,result),lineHeight:14});
    const verify=XP.verifyPreservation(XLSX,origBytes,out.bytes,M.actualSource.sheetName,out.report.officialSheet,mode);
    return{bytes:out.bytes,report:out.report,verify};
  }
  /* .xlsx olmayan kaynak (ör. .xls/.csv/elle giriş): biçim KORUNAMAZ — açıkça belirtilir */
  /* SheetJS ile yazılan sayfalarda da geçersiz XML karakterleri süzülür (FABLE T13-5) */
  const aoaSafe=(XLSX,rows)=>XLSX.utils.aoa_to_sheet(rows.map(r=>(r||[]).map(c=>typeof c==="string"?XP.xmlText(c):c)));
  function buildFallback(XLSX,db,M,result){
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,aoaSafe(XLSX,[["BİÇİM UYARISI"],["Kaynak dosya .xlsx olmadığı (veya elle girildiği) için orijinal renk/kenarlık/birleşik hücre biçimi korunamadı."],["Biçimi korumak için hastanenin dosyasını Excel'de .xlsx olarak kaydedip tekrar yükleyin."]]),"BİÇİM UYARISI");
    const dates=C.monthDates(M.month);const grid=[["Tarih","SERVİS","ACİL (Acil ailesi tek kategori)"]];for(const d of dates){const a=(result.assignments||[]).filter(x=>x.date===d);grid.push([C.fmtDate(d),a.filter(x=>x.category==="Servis").map(x=>x.name).join("\n"),a.filter(x=>x.category==="Acil").map(x=>x.name).join("\n")]);}
    const ws=aoaSafe(XLSX,grid);ws["!cols"]=[{wch:12},{wch:30},{wch:40}];XLSX.utils.book_append_sheet(wb,ws,"RESMİ ÖNERİ");
    for(const s of reportSheets(db,M,result)){const ws2=aoaSafe(XLSX,s.rows.map(r=>r.map(c=>c&&typeof c==="object"?c.v:c)));ws2["!cols"]=(s.widths||[]).map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws2,s.name.slice(0,31));}
    return new Uint8Array(XLSX.write(wb,{type:"array",bookType:"xlsx",compression:true}));
  }
  /* Ayrı PROBEL giriş dosyası — PROBEL ekranındaki renklerle. SheetJS topluluk sürümü stil yazamadığı için: bilgi sayfalı boş kitap
     SheetJS ile yazılır, PROBEL sayfaları biçimli rapor sayfası olarak XML düzeyinde eklenir (styles.xml'e yalnız sona ekleme). */
  function probelOnly(XLSX,db,M,result){
    const info=[[`PROBEL GİRİŞ TASLAĞI — ${C.monthLabel(M.month)}`],["Bu dosya programın önerdiği resmî nöbetleri PROBEL'e elle girmeyi kolaylaştırır; girmeden önce kontrol edin."],[PROBEL_LEGEND],[`Çizelge durumu: ${STATUS_TR[result.status]||result.status}`],[`Önceki ay ay sonu kaydı: ${priorText(db,M)}`],...(result.overBound?[[`Fazla ödeme (plan): ${result.overBound.total} eşdeğer saat; kaçınılmaz alt sınır ${result.overBound.lowerBound}${result.overBound.atBound?" (olası en düşük, kanıtlı)":""}`]]:[]),[`Sayfalar: PROBEL SERVİS, PROBEL ACİL${result.postedDiff?", PROBEL FARKI":""}`]];
    const wb=XLSX.utils.book_new();const ws=aoaSafe(XLSX,info);ws["!cols"]=[{wch:120}];XLSX.utils.book_append_sheet(wb,ws,"BİLGİ");
    {const pr=postedRows(result);if(pr){const w2=aoaSafe(XLSX,pr);w2["!cols"]=[{wch:12},{wch:11},{wch:28},{wch:10},{wch:48}];XLSX.utils.book_append_sheet(wb,w2,"PROBEL FARKI");}}
    const zip=XP.openZip(XLSX,new Uint8Array(XLSX.write(wb,{type:"array",bookType:"xlsx",compression:true})));const info2=XP.workbookInfo(zip);const styles=XP.appendStyles(zip)||{};
    for(const cat of["Servis","Acil"]){const s=probelEntryRows(db,M,result,cat);XP.addSheetPart(zip,info2,`PROBEL ${C.trUpper(cat)}`,XP.reportSheetXml(s.rows,{...s,styles}));}
    return zip.out();}
  function fileName(M,result,kind){const ok=result.status==="valid_complete"?"DENETIMLI":result.status==="valid_incomplete"?"EKSIK_VERILI":"GECERSIZ";return`resmi_cizelge_${M.month}_${kind}_${ok}.xlsx`;}
  return{officialCellUpdates,probelEntryRows,holidayLabel,priorText,postedRows,reportSheets,carrySheet,readCarry,CARRY_SHEET,chunkText,jsonForXml,buildPreserved,buildFallback,probelOnly,fileName,STATUS_TR,mergedNonTopLeft};
});
