/* Hastanenin ORİJİNAL yatay fiilî nöbet Excel'ini içe aktarır.
   Beklenen yapı: başlık(lar) + bir başlık satırı (Tarih | SERVİS | ACİL | YOĞUN BAKIM | YENİDOĞAN | KIDEMLİ) + her gün için satır(lar).
   Bir hücrede alt alta (Alt+Enter) veya virgülle birden çok isim; '(09.00-17.00)', '(17.00-08.00)', '(Oryantasyon nöbeti)' notları;
   birleştirilmiş tarih hücreleri; önceki ayın son günü satırı olabilir. Hücre DEĞERİ okunur (OCR yok); her kayıt kaynak hücreye bağlanır. */
(function(root,factory){const api=factory(root.NobetCore);if(typeof module==="object"&&module.exports)module.exports=api;root.NobetActual=api;})(typeof globalThis!=="undefined"?globalThis:this,function(C){
  "use strict";
  if(!C&&typeof require==="function")C=require("./core.js");
  const UNIT_PATTERNS=[
    ["Yenidoğan",f=>/yenidogan|(^| )yd( |$)|neonat/.test(f)],
    ["Yoğun Bakım",f=>/yogun bakim|(^| )yb( |$)|(^| )ybu( |$)|(^| )cybu( |$)/.test(f)],
    ["Kıdemli",f=>/kidemli/.test(f)],
    ["Acil",f=>/(^| )acil( |$)|^acil/.test(f)],
    ["Servis",f=>/(^| )servis( |$)|^servis|yatakli/.test(f)]
  ];
  const NOT_NAME_WORDS=new Set(["oryantasyon","nobet","nobeti","izin","izinli","rapor","raporlu","gunduz","gece","bos","yok","nobetci","not","aciklama","degisiklik","x","tatil","bayram","oryantasyon nobeti"]);
  /* İçe aktarma eşikleri (talimatnamede listelenir) */
  const PARAMS=Object.freeze({titlePrefixes:["prof","doç","doc","uzm","op","yrd","dr","arş","ars","ar","öğr","ogr","gör","gor"],titleWords:["üyesi"],longFormatMinDup:3,longFormatRatio:0.2,sheetAmbiguousScore:20,sheetAmbiguousGap:10});
  /* unvan ayıklama kalıbı PARAMS listesinden üretilir (ör. "Dr. Öğr. Üyesi Ad Soyad" → "Ad Soyad") */
  const TITLE_RE=new RegExp(`^(?:(?:${PARAMS.titlePrefixes.join("|")})\\.\\s*|(?:${PARAMS.titleWords.join("|")})\\s+)+`,"i");
  function unitOfHeader(text){const f=C.fold(text);if(!f||f.length>40)return null;for(const[u,t]of UNIT_PATTERNS)if(t(f))return u;return null;}
  function cellText(cell){if(!cell)return"";if(cell.t==="s"||cell.t==="str")return String(cell.v??"");if(cell.w!=null)return String(cell.w);return cell.v==null?"":String(cell.v);}

  /* ---- hücre metni -> isim kayıtları ---- */
  function splitOutsideParens(s,seps){const out=[];let depth=0,cur="";for(const ch of s){if(ch==="(")depth++;if(ch===")")depth=Math.max(0,depth-1);if(depth===0&&seps.includes(ch)){out.push(cur);cur="";continue;}cur+=ch;}out.push(cur);return out;}
  function parseShift(text){const m=String(text).match(/(\d{1,2})\s*[.:]\s*(\d{2})\s*[-–—]\s*(\d{1,2})\s*[.:]\s*(\d{2})/);if(!m)return null;const start=`${m[1].padStart(2,"0")}:${m[2]}`,end=`${m[3].padStart(2,"0")}:${m[4]}`;const s=+m[1]*60+ +m[2],e=+m[3]*60+ +m[4];let hours=(e-s)/60;if(hours<=0)hours+=24;return{start,end,hours,overnight:e<=s,raw:m[0]};}
  function parseCellText(raw){
    const text=String(raw??"").replace(/\r\n?/g,"\n").replace(/[\u00a0\u2007\u202f]/g," ");
    const entries=[],issues=[];
    const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
    lines.forEach((line,li)=>{
      const frags=splitOutsideParens(line,[",",";"]).map(x=>x.trim()).filter(Boolean);
      frags.forEach((frag,fi)=>{
        const notes=[];let shift=null;
        let namePart=frag.replace(/\(([^)]*)\)?/g,(m,inner)=>{const t=C.cleanSpaces(inner);if(t)notes.push(t);return" ";});
        /* parantezsiz saat aralığı (ör. 'Ad Soyad 09.00-17.00') */
        namePart=namePart.replace(/(\d{1,2}\s*[.:]\s*\d{2}\s*[-–—]\s*\d{1,2}\s*[.:]\s*\d{2})/g,m=>{notes.push(C.cleanSpaces(m));return" ";});
        for(const n of notes){const sh=parseShift(n);if(sh&&!shift)shift=sh;}
        namePart=C.cleanSpaces(namePart).replace(/^[-–—_*•.:/\\]+|[-–—_*•.:/\\]+$/g,"").trim();
        /* unvanlar kimliğin parçası değildir: 'Dr.', 'Uzm. Dr.', 'Arş. Gör.', 'Prof. Dr.', 'Öğr. Üyesi' … */
        const titled=namePart.replace(TITLE_RE,"").trim();
        if(titled&&titled!==namePart){notes.push(`unvan: ${namePart.slice(0,namePart.length-titled.length).trim()}`);namePart=titled;}
        if(!namePart&&!notes.length)return;/* yalnız tire/nokta gibi işaretler: boş hücre */
        const orientation=notes.some(n=>/oryantasyon/i.test(C.fold(n)))||/oryantasyon/.test(C.fold(namePart));
        const fname=C.fold(namePart);
        const isNoteOnly=!fname||NOT_NAME_WORDS.has(fname)||/^(oryantasyon|nobet|izin|rapor)/.test(fname)&&fname.split(" ").length<=3&&!/[A-ZÇĞİÖŞÜ]{3,}/.test(namePart);
        if(isNoteOnly){
          if(namePart)notes.push(namePart);
          const prev=entries[entries.length-1];
          if(prev){prev.notes.push(...notes);if(shift&&!prev.shift)prev.shift=shift;if(orientation)prev.orientation=true;prev.flags.push("note-line");}
          else issues.push({level:"warning",code:"ORPHAN_NOTE",message:`İsimsiz not satırı: '${line}'`});
          return;
        }
        const words=fname.split(" ");
        if(words.length===1){
          const prev=entries[entries.length-1];
          if(prev&&prev.line===li-1&&fi===0){prev.rawName=`${prev.rawName} ${namePart}`;prev.notes.push(...notes);if(shift&&!prev.shift)prev.shift=shift;if(orientation)prev.orientation=true;prev.flags.push("joined-line");prev.confidence="orta";return;}
          entries.push({rawName:namePart,notes,shift,orientation,flags:["single-word"],confidence:"düşük",line:li});return;
        }
        entries.push({rawName:namePart,notes,shift,orientation,flags:[],confidence:"yüksek",line:li});
      });
    });
    entries.forEach(e=>{e.rawName=C.cleanSpaces(e.rawName);if(e.flags.includes("single-word"))issues.push({level:"warning",code:"SINGLE_WORD",message:`Tek kelimelik isim: '${e.rawName}'`});if(e.flags.includes("joined-line"))issues.push({level:"warning",code:"JOINED_LINE",message:`İki satıra bölünmüş isim birleştirildi: '${e.rawName}'`});});
    return{entries,issues,lines};
  }

  /* ---- sayfa analizi ---- */
  function sheetRange(XLSX,ws){if(!ws||!ws["!ref"])return null;return XLSX.utils.decode_range(ws["!ref"]);}
  function mergeMap(ws){const map=new Map();for(const m of ws["!merges"]||[]){for(let r=m.s.r;r<=m.e.r;r++)for(let c=m.s.c;c<=m.e.c;c++)map.set(`${r},${c}`,{r:m.s.r,c:m.s.c,range:m});}return map;}
  function findHeader(XLSX,ws,rng){
    let best=null;
    for(let r=rng.s.r;r<=Math.min(rng.e.r,rng.s.r+40);r++){
      const units={};let count=0;
      for(let c=rng.s.c;c<=rng.e.c;c++){const cell=ws[C.a1(r,c)];const u=unitOfHeader(cellText(cell));if(u&&units[u]==null){units[u]=c;count++;}}
      if(count>=2&&(!best||count>best.count))best={row:r,units,count};
    }
    return best;
  }
  function analyzeSheet(XLSX,ws,opts={}){
    const rng=sheetRange(XLSX,ws);if(!rng)return{score:0};
    const hdr=opts.mapping&&opts.mapping.headerRow!=null?{row:opts.mapping.headerRow,units:opts.mapping.units,count:Object.keys(opts.mapping.units||{}).length}:findHeader(XLSX,ws,rng);
    if(!hdr)return{score:0,rng};
    let dateCount=0;const firstUnitCol=Math.min(...Object.values(hdr.units));const months={};
    /* yılsız tarihler için ipucu: başlıktaki ay adı + çalışılan ayın yılı */
    let title="";for(let r=rng.s.r;r<hdr.row;r++)for(let c=rng.s.c;c<=rng.e.c;c++){const t=cellText(ws[C.a1(r,c)]);if(t)title+=" "+t;}
    const tm=C.monthFromName(title);const hint=opts.month||(tm?`${String(opts.preferMonth||"").slice(0,4)||new Date().getFullYear()}-${String(tm).padStart(2,"0")}`:undefined);
    for(let r=hdr.row+1;r<=Math.min(rng.e.r,hdr.row+200);r++)for(let c=rng.s.c;c<firstUnitCol;c++){const cell=ws[C.a1(r,c)];const p=cell&&C.parseDateValue(cell.t==="n"?cell.v:cellText(cell),{month:hint});if(p){dateCount++;const m=p.ymd.slice(0,7);months[m]=(months[m]||0)+1;}}
    const dominant=Object.entries(months).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    /* aynı dosyada birden çok ay sayfası varsa çalışılan aya uyan sayfa tercih edilir */
    const bonus=opts.preferMonth&&dominant===opts.preferMonth?100:0;
    return{score:hdr.count*10+dateCount+bonus,header:hdr,dateCount,rng,dominant};
  }
  function analyzeWorkbook(XLSX,wb,opts={}){
    const sheets=wb.SheetNames.map(name=>{const a=analyzeSheet(XLSX,wb.Sheets[name],opts);return{name,score:a.score||0,month:a.dominant||null,units:a.header?Object.keys(a.header.units):[],dates:a.dateCount||0,hidden:!!(wb.Workbook&&wb.Workbook.Sheets&&(wb.Workbook.Sheets.find(s=>s.name===name)||{}).Hidden)};});
    const ranked=[...sheets].sort((a,b)=>b.score-a.score);
    const best=ranked[0]&&ranked[0].score>0?ranked[0].name:null;
    const ambiguous=ranked.length>1&&ranked[1].score>=PARAMS.sheetAmbiguousScore&&ranked[0].score-ranked[1].score<PARAMS.sheetAmbiguousGap;
    return{sheets,best,ambiguous};
  }

  function parseSheet(XLSX,ws,opts={}){
    const sheetName=opts.sheetName||"Sayfa1";const fileName=opts.fileName||"";
    const res={sheetName,fileName,header:null,dateCol:null,unitCols:{},month:null,title:"",blocks:[],records:[],outside:[],issues:[],grid:null,stats:{}};
    const rng=sheetRange(XLSX,ws);
    if(!rng){res.issues.push({level:"error",code:"EMPTY_SHEET",message:`'${sheetName}' sayfası boş.`});return res;}
    const merges=mergeMap(ws);
    const valueAt=(r,c)=>{const m=merges.get(`${r},${c}`);const rr=m?m.r:r,cc=m?m.c:c;return{cell:ws[C.a1(rr,cc)],r:rr,c:cc,merged:!!m,isTopLeft:!m||(m.r===r&&m.c===c)};};
    const hdr=opts.mapping&&opts.mapping.headerRow!=null?{row:opts.mapping.headerRow,units:opts.mapping.units}:findHeader(XLSX,ws,rng);
    if(!hdr){res.issues.push({level:"error",code:"HEADER_NOT_FOUND",message:`'${sheetName}' sayfasında SERVİS / ACİL / YOĞUN BAKIM / YENİDOĞAN / KIDEMLİ başlıklarından en az ikisini içeren satır bulunamadı. Doğru sayfayı seçin veya sütunları elle eşleyin.`});return res;}
    res.header={row:hdr.row,units:hdr.units};res.unitCols=hdr.units;
    const missingUnits=C.UNITS.filter(u=>hdr.units[u]==null);
    if(missingUnits.length)res.issues.push({level:"warning",code:"UNIT_MISSING",message:`Bulunamayan bölüm sütunu: ${missingUnits.join(", ")}. Bu bölümler için kayıt alınmadı.`});
    /* başlık metni (ay adı) */
    const titleParts=[];let titleRef=null;for(let r=rng.s.r;r<hdr.row;r++)for(let c=rng.s.c;c<=rng.e.c;c++){const t=cellText(ws[C.a1(r,c)]);if(t){titleParts.push(t);if(!titleRef)titleRef=C.a1(r,c);}}res.titleRef=titleRef;
    res.title=C.cleanSpaces(titleParts.join(" "));
    const titleMonth=C.monthFromName(res.title);
    /* tarih sütunu: birim sütunlarının solunda en çok tarih içeren sütun */
    const unitColSet=new Set(Object.values(hdr.units));
    let dateCol=opts.mapping&&opts.mapping.dateCol!=null?opts.mapping.dateCol:null;
    let monthHint=opts.month;
    const detectDateCol=hint=>{let col=null,bestCount=0;for(let c=rng.s.c;c<=rng.e.c;c++){if(unitColSet.has(c))continue;let n=0;for(let r=hdr.row+1;r<=rng.e.r;r++){const v=valueAt(r,c);if(!v.isTopLeft)continue;const cell=v.cell;if(!cell)continue;if(C.parseDateValue(cell.t==="n"?cell.v:cellText(cell),{month:hint}))n++;}if(n>bestCount){bestCount=n;col=c;}}return{col,bestCount};};
    if(dateCol==null){let d=detectDateCol(monthHint);
      /* Tarih hücrelerinde yıl/ay yoksa (yalnız gün numarası veya '1 Eylül'): ay başlıktan, yıl çalışılan aydan alınır */
      if((d.col==null||d.bestCount<10)&&!monthHint&&titleMonth){const y=String(opts.preferMonth||"").slice(0,4)||String(new Date().getFullYear());const guess=`${y}-${String(titleMonth).padStart(2,"0")}`;const d2=detectDateCol(guess);if(d2.bestCount>d.bestCount){d=d2;monthHint=guess;res.issues.push({level:"warning",code:"YEAR_ASSUMED",message:`Tarih hücrelerinde yıl yok; ay başlıktan (${C.MONTHS_TR[titleMonth-1]}), yıl çalışılan aydan (${y}) alındı. Doğru değilse ayı değiştirip yeniden yükleyin.`});}}
      dateCol=d.col;}
    if(dateCol==null){res.issues.push({level:"error",code:"DATE_COL_NOT_FOUND",message:"Tarih sütunu bulunamadı (01/09/2026, 01.09.2026 veya Excel tarihi bekleniyor)."});return res;}
    res.dateCol=dateCol;
    /* satırları tarih bloklarına ayır */
    const blocks=[];let cur=null;let blankRun=0;const trailing=[];
    for(let r=hdr.row+1;r<=rng.e.r;r++){
      const dv=valueAt(r,dateCol);
      let parsed=null,rawDate="";
      if(dv.cell){rawDate=cellText(dv.cell);parsed=C.parseDateValue(dv.cell.t==="n"?dv.cell.v:rawDate,{month:monthHint,date1904:opts.date1904});}
      const unitTexts={};let any=false;
      for(const[u,c]of Object.entries(hdr.units)){const v=valueAt(r,c);if(!v.isTopLeft){unitTexts[u]=null;continue;}const t=cellText(v.cell).trim();unitTexts[u]=t?{text:t,ref:C.a1(r,c),r,c}:null;if(t)any=true;}
      if(parsed&&(dv.isTopLeft)){cur={date:parsed.ymd,how:parsed.how,rawDate,dateRef:C.a1(dv.r,dv.c),rows:[r],cells:{},continuation:false};blocks.push(cur);blankRun=0;}
      else if(parsed&&!dv.isTopLeft&&cur&&cur.dateRef===C.a1(dv.r,dv.c)){cur.rows.push(r);}
      else if(!parsed&&any){
        if(cur&&blankRun===0){cur.rows.push(r);cur.continuation=true;}
        else{trailing.push({row:r,texts:Object.values(unitTexts).filter(Boolean).map(x=>x.text)});}
      }
      else if(!any&&!rawDate){blankRun++;if(blankRun>=1)cur=cur&&cur.rows.length?cur:null;}
      else if(rawDate&&!parsed){if(any)res.issues.push({level:"error",code:"DATE_UNPARSED",message:`${C.a1(dv.r,dv.c)}: '${rawDate}' tarih olarak okunamadı; bu satırdaki isimler alınmadı.`});}
      for(const[u,info]of Object.entries(unitTexts)){if(info&&cur&&cur.rows.includes(r))(cur.cells[u]??=[]).push(info);}
    }
    /* tablo altında/dışında kalan metin: tablodaki bir kişinin adını içeriyorsa veri olabilir → hata (açık onay ister) */
    const knownKeys=new Set();blocks.forEach(b=>Object.values(b.cells).forEach(infos=>infos.forEach(info=>parseCellText(info.text).entries.forEach(e=>knownKeys.add(C.personKey(e.rawName))))));
    const trailingNames=trailing.filter(t=>t.texts.some(x=>parseCellText(x).entries.some(e=>knownKeys.has(C.personKey(e.rawName)))));
    if(trailingNames.length)res.issues.push({level:"error",code:"TRAILING_NAMES",message:`Tablonun dışında, tablodaki kişilerin adlarını içeren ${trailingNames.length} satır var (ör. ${trailingNames[0].texts.join(" | ").slice(0,80)}). Tarihsiz olduğu için içe alınmadı; nöbet verisiyse tabloya taşıyın veya sütunları elle eşleyin.`});
    if(trailing.length)res.issues.push({level:"warning",code:"TRAILING_TEXT",message:`Tablo dışında kalan ${trailing.length} satır metni yok sayıldı: ${trailing.slice(0,3).map(t=>t.texts.join(" | ")).join(" · ")}`});
    if(!blocks.length){res.issues.push({level:"error",code:"NO_DATES",message:"Başlık altında tarihli satır bulunamadı."});return res;}
    /* ay tespiti */
    const monthCount={};blocks.forEach(b=>{const m=b.date.slice(0,7);monthCount[m]=(monthCount[m]||0)+1;});
    let month=opts.month||Object.entries(monthCount).sort((a,b)=>b[1]-a[1])[0][0];
    if(titleMonth&&Number(month.slice(5))!==titleMonth)res.issues.push({level:"warning",code:"TITLE_MONTH_MISMATCH",message:`Başlıkta ${C.MONTHS_TR[titleMonth-1]} yazıyor, tarihler ${C.monthLabel(month)} gösteriyor.`});
    if(opts.month&&!monthCount[opts.month])res.issues.push({level:"error",code:"MONTH_MISMATCH",message:`Seçili ay ${C.monthLabel(opts.month)}, dosyadaki tarihler ${Object.keys(monthCount).map(C.monthLabel).join(", ")}.`});
    res.month=month;
    /* blok kontrolleri */
    const seen=new Map();let prevDate=null;const dups=[],disorder=[];
    blocks.forEach(b=>{
      if(seen.has(b.date))dups.push(`${C.fmtDate(b.date)} (${seen.get(b.date)} ve ${b.dateRef})`);else seen.set(b.date,b.dateRef);
      if(prevDate&&b.date<prevDate)disorder.push(`${b.dateRef}: ${C.fmtDate(prevDate)} → ${C.fmtDate(b.date)}`);prevDate=b.date;
      if(b.how==="gg/aa/yy")b.note="2 haneli yıl";
      b.inMonth=b.date.startsWith(month);
    });
    /* Hastanenin YATAY tablosunda her gün bir kez geçer. Tarihlerin çoğu tekrarlıyorsa bu “satır başına bir kişi” (uzun) biçimdir — sessizce içe alınmaz. */
    if(dups.length>Math.max(PARAMS.longFormatMinDup,blocks.length*PARAMS.longFormatRatio)){res.issues.push({level:"error",code:"LONG_FORMAT",message:`'${sheetName}' sayfası hastanenin yatay nöbet tablosu gibi görünmüyor: ${blocks.length} tarih satırının ${dups.length} tanesi tekrar ediyor (her satırda bir kişi olan liste/rapor biçimi). Doğru dosyayı veya sayfayı seçin.`});res.records=[];res.outside=[];return res;}
    if(dups.length)res.issues.push({level:"error",code:"DUP_DATE",message:`${dups.length} tarih birden fazla satırda başlıyor: ${dups.slice(0,5).join("; ")}${dups.length>5?" …":""}.`});
    if(disorder.length)res.issues.push({level:"warning",code:"DATE_ORDER",message:`Tarih sırası ${disorder.length} yerde geriye gidiyor: ${disorder.slice(0,4).join("; ")}${disorder.length>4?" …":""}.`});
    const dates=C.monthDates(month);const missing=dates.filter(d=>!seen.has(d));
    if(missing.length)res.issues.push({level:"error",code:"DAYS_MISSING",message:`${C.monthLabel(month)} için ${missing.length} gün satırı yok: ${missing.map(C.fmtDate).join(", ")}. Eksik gün '0 nöbet' sayılmaz.`});
    /* kayıtlar */
    let seq=0;
    for(const b of blocks){
      let any=false;
      for(const[unit,infos]of Object.entries(b.cells)){
        for(const info of infos){
          const parsed=parseCellText(info.text);
          parsed.issues.forEach(is=>res.issues.push({...is,message:`${sheetName}!${info.ref} (${C.fmtDate(b.date)} ${unit}): ${is.message}`,cell:info.ref}));
          parsed.entries.forEach((e,k)=>{
            any=true;
            const rec={id:`a:${sheetName}!${info.ref}#${k}`,rawName:e.rawName,date:b.date,unit,category:C.CATEGORY_OF_UNIT[unit],shift:e.shift,notes:e.notes,orientation:!!e.orientation,flags:[...e.flags,...(b.continuation?["continuation-row"]:[])],confidence:b.continuation&&e.confidence==="yüksek"?"orta":e.confidence,source:{file:fileName,sheet:sheetName,cell:info.ref,line:e.line+1,cellText:info.text,dateCell:b.dateRef,rawDate:b.rawDate},seq:seq++};
            if(b.inMonth)res.records.push(rec);else{rec.outside=b.date<dates[0]?"önceki ay":"sonraki ay";res.outside.push(rec);}
          });
        }
      }
      if(!any&&b.inMonth)res.issues.push({level:"warning",code:"EMPTY_DAY",message:`${C.fmtDate(b.date)}: hiçbir bölümde isim yok.`});
      if(b.continuation)res.issues.push({level:"info",code:"CONTINUATION",message:`${b.dateRef} (${C.fmtDate(b.date)}): tarihsiz devam satırları bu güne bağlandı (${b.rows.length} satır).`});
    }
    res.outside.length&&res.issues.push({level:"info",code:"OUTSIDE_MONTH",message:`${res.outside.length} kayıt seçili ay dışında (${C.uniq(res.outside.map(r=>C.fmtDate(r.date))).join(", ")}); hakedişe katılmadı, ayrı referans olarak saklandı.`});
    res.blocks=blocks.map(b=>({date:b.date,dateRef:b.dateRef,rows:b.rows,inMonth:b.inMonth,continuation:b.continuation}));
    /* dairesel önizleme ızgarası (tablo bölgesi) */
    const lastRow=Math.max(...blocks.map(b=>Math.max(...b.rows)));
    const cols=[dateCol,...Object.values(hdr.units)].sort((a,b)=>a-b);
    const minC=Math.min(rng.s.c,...cols),maxC=Math.max(...cols);
    const grid=[];for(let r=rng.s.r;r<=lastRow;r++){const row=[];for(let c=minC;c<=maxC;c++){const m=merges.get(`${r},${c}`);if(m&&!(m.r===r&&m.c===c)){row.push(null);continue;}const cell=ws[C.a1(r,c)];row.push({ref:C.a1(r,c),text:cell?(cell.t==="n"&&c===dateCol?(C.parseDateValue(cell.v)||{}).ymd||cellText(cell):cellText(cell)):"",rowspan:m?m.range.e.r-m.range.s.r+1:1,colspan:m?m.range.e.c-m.range.s.c+1:1});}grid.push(row);}
    res.grid={firstRow:rng.s.r,firstCol:minC,rows:grid,headerRow:hdr.row,dateCol};
    const byUnit={};res.records.forEach(r=>byUnit[r.unit]=(byUnit[r.unit]||0)+1);
    res.stats={days:dates.length,daysFound:dates.length-missing.length,unitsFound:Object.keys(hdr.units).length,records:res.records.length,outside:res.outside.length,byUnit,lowConfidence:res.records.filter(r=>r.confidence!=="yüksek").length,names:C.uniq(res.records.map(r=>C.personKey(r.rawName))).length};
    return res;
  }
  function parseWorkbook(XLSX,wb,opts={}){
    const an=analyzeWorkbook(XLSX,wb,opts);
    const sheetName=opts.sheetName||an.best;
    if(!sheetName)return{analysis:an,result:{sheetName:"",records:[],outside:[],issues:[{level:"error",code:"NO_ROSTER_SHEET",message:`Hiçbir sayfada nöbet tablosu başlığı bulunamadı. Sayfalar: ${wb.SheetNames.join(", ")}. Dosya CSV ise veya farklı biçimdeyse sütunları elle eşleyin.`}],stats:{}}};
    const date1904=!!(wb.Workbook&&wb.Workbook.WBProps&&wb.Workbook.WBProps.date1904);
    let result=parseSheet(XLSX,wb.Sheets[sheetName],{...opts,sheetName,date1904});
    /* seçilen sayfa uzun (satır başına kişi) biçimdeyse ve kullanıcı sayfa seçmediyse: diğer aday sayfaları dene */
    if(!opts.sheetName&&result.issues.some(i=>i.code==="LONG_FORMAT")){
      for(const s of[...an.sheets].sort((a,b)=>b.score-a.score)){if(s.name===sheetName||s.score<=0)continue;const r2=parseSheet(XLSX,wb.Sheets[s.name],{...opts,sheetName:s.name,date1904});if(r2.records.length&&!r2.issues.some(i=>i.code==="LONG_FORMAT")){r2.issues.unshift({level:"warning",code:"SHEET_SWITCHED",message:`'${sheetName}' sayfası uzun (satır başına kişi) biçimde; yatay tablo olan '${s.name}' sayfası kullanıldı. Doğruysa onaylayın.`});result=r2;break;}}
    }
    if(an.ambiguous&&!opts.sheetName)result.issues.unshift({level:"warning",code:"SHEET_AMBIGUOUS",message:`Birden fazla sayfa nöbet tablosuna benziyor (${an.sheets.filter(s=>s.score>=20).map(s=>s.name).join(", ")}). '${sheetName}' seçildi; doğruysa onaylayın.`});
    return{analysis:an,result};
  }
  return{parseCellText,parseShift,unitOfHeader,analyzeWorkbook,parseSheet,parseWorkbook,PARAMS};
});
