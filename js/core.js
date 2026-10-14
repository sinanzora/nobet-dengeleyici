/* Pediatri Nöbet Dengeleyici — çekirdek yardımcılar (tarih, isim, FMS, özet).
   Tüm tarih hesapları YYYY-AA-GG metinleri ve UTC üzerinden yapılır; yerel saat dilimi kayması olmaz. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;root.NobetCore=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const VERSION="3.1.1";
  const UNITS=["Servis","Acil","Yoğun Bakım","Yenidoğan","Kıdemli"];
  const CATEGORY_OF_UNIT={"Servis":"Servis","Acil":"Acil","Yoğun Bakım":"Acil","Yenidoğan":"Acil","Kıdemli":"Acil"};
  const MONTHS_TR=["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
  const DAYS_TR=["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
  /* Kullanıcının bildirdiği standart ücrete esas FMS (JS getUTCDay: 0=Pazar). */
  const DEFAULT_FMS_TABLE={0:16,1:8,2:8,3:8,4:8,5:16,6:24,halfday:19,daytime:8};

  /* ---------- metin ---------- */
  const TR_MAP={"ı":"i","İ":"i","ş":"s","Ş":"s","ğ":"g","Ğ":"g","ü":"u","Ü":"u","ö":"o","Ö":"o","ç":"c","Ç":"c","â":"a","Â":"a","î":"i","Î":"i","û":"u","Û":"u"};
  function fold(v){
    let s=String(v??"");
    s=s.replace(/[ıİşŞğĞüÜöÖçÇâÂîÎûÛ]/g,c=>TR_MAP[c]);
    s=s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    return s.replace(/[^a-z0-9]+/g," ").trim();
  }
  function cleanSpaces(v){return String(v??"").replace(/[\u00a0\u2007\u202f\t]/g," ").replace(/ {2,}/g," ").trim();}
  function trLower(s){return String(s).toLocaleLowerCase("tr-TR");}
  function trUpper(s){return String(s).toLocaleUpperCase("tr-TR");}
  /* "ADI İKİNCİADI SOYADI" -> "Adı İkinciadı Soyadı"; Türkçe büyük/küçük harf kurallarıyla. */
  function displayName(raw){
    return cleanSpaces(raw).split(" ").filter(Boolean).map(w=>{const l=trLower(w);return trUpper(l.charAt(0))+l.slice(1);}).join(" ");
  }
  function personKey(name){return fold(name);}
  function personIdOf(name){const k=personKey(name);return k?`p:${k}`:"";}
  function levenshtein(a,b){if(a===b)return 0;const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let prev=new Array(n+1),cur=new Array(n+1);for(let j=0;j<=n;j++)prev[j]=j;for(let i=1;i<=m;i++){cur[0]=i;for(let j=1;j<=n;j++){cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));}[prev,cur]=[cur,prev];}return prev[n];}
  /* İsim benzerliği: yalnız ÖNERİ üretir; birleştirme kararı kullanıcıya aittir. */
  function nameSimilarity(a,b){
    const ka=personKey(a),kb=personKey(b);if(!ka||!kb)return null;if(ka===kb)return{kind:"same",score:1};
    const ta=ka.split(" "),tb=kb.split(" ");
    const setA=new Set(ta),setB=new Set(tb);
    const inter=ta.filter(t=>setB.has(t)).length;
    const sub=(x,y)=>x.every(t=>y.includes(t));
    if(inter>=2&&(sub(ta,tb)||sub(tb,ta)))return{kind:"subset",score:0.9,reason:"Bir isim diğerinin tüm kelimelerini içeriyor (ikinci ad / ek soyad farkı)."};
    if(ta[0]===tb[0]&&inter>=1&&ta.length>=2&&tb.length>=2){
      const la=ta[ta.length-1],lb=tb[tb.length-1];
      const d=levenshtein(la,lb);
      if(d>0&&d<=2&&Math.min(la.length,lb.length)>=5)return{kind:"typo",score:0.8,reason:`Soyadında ${d} harf farkı (yazım hatası olabilir).`};
      if(la!==lb&&(la.startsWith(lb)||lb.startsWith(la))&&Math.min(la.length,lb.length)>=4)return{kind:"suffix",score:0.85,reason:"Soyadı diğerinin başlangıcı (ör. “Soyad” / “Soyadoğlu”)."};
      if(ta.length>=2&&tb.length>=2&&ta.slice(0,-1).join(" ")===tb.slice(0,-1).join(" ")&&ta.length>=3)return{kind:"surname",score:0.6,reason:"Ad aynı, soyadı farklı (evlilik/soyadı değişimi olabilir)."};
      if(ta.length===2&&tb.length===2&&ta[0]===tb[0]&&la!==lb)return{kind:"surname",score:0.5,reason:"Ad aynı, soyadı farklı (soyadı değişimi olabilir)."};
    }
    return null;
  }

  /* ---------- tarih (UTC, YYYY-AA-GG) ---------- */
  const pad=n=>String(n).padStart(2,"0");
  function ymd(y,m,d){return`${y}-${pad(m)}-${pad(d)}`;}
  function isYmd(s){return typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&validYmd(s);}
  function parts(s){const[y,m,d]=String(s).split("-").map(Number);return{y,m,d};}
  function validYmd(s){const{y,m,d}=parts(s);if(!y||!m||!d||m<1||m>12||d<1)return false;return d<=daysInMonth(`${y}-${pad(m)}`);}
  function toUtcMs(s){const{y,m,d}=parts(s);return Date.UTC(y,m-1,d);}
  function fromUtcMs(ms){const t=new Date(ms);return ymd(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());}
  function addDays(s,n){return fromUtcMs(toUtcMs(s)+n*86400000);}
  function dateDiff(a,b){return Math.round((toUtcMs(b)-toUtcMs(a))/86400000);}
  function weekday(s){return new Date(toUtcMs(s)).getUTCDay();}
  function dayName(s){return DAYS_TR[weekday(s)];}
  const DAYS_SHORT=["Paz","Pzt","Sal","Çar","Per","Cum","Cmt"];
  function dayShort(s){return DAYS_SHORT[weekday(s)];}
  function daysInMonth(month){const[y,m]=String(month).split("-").map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();}
  function monthDates(month){if(!/^\d{4}-\d{2}$/.test(month||""))return[];const n=daysInMonth(month),out=[];for(let d=1;d<=n;d++)out.push(`${month}-${pad(d)}`);return out;}
  function prevMonth(month){const[y,m]=month.split("-").map(Number);return m===1?`${y-1}-12`:`${y}-${pad(m-1)}`;}
  function nextMonth(month){const[y,m]=month.split("-").map(Number);return m===12?`${y+1}-01`:`${y}-${pad(m+1)}`;}
  function monthLabel(month){const[y,m]=month.split("-").map(Number);return`${MONTHS_TR[m-1]} ${y}`;}
  function fmtDate(s){if(!isYmd(s))return String(s||"");const{y,m,d}=parts(s);return`${pad(d)}.${pad(m)}.${y}`;}
  function monthFromName(text){const f=fold(text);const names=MONTHS_TR.map(fold);for(let i=0;i<12;i++){if(new RegExp(`(^| )${names[i]}( |$)`).test(f))return i+1;}return null;}
  /* Excel seri tarihi (1900 sistemi, 1899-12-30 tabanı; Lotus 1900 artık yıl hatası dahil). */
  function excelSerialToYmd(n,date1904=false){if(typeof n!=="number"||!Number.isFinite(n))return"";const days=Math.floor(n)+(date1904?1462:0);return fromUtcMs(Date.UTC(1899,11,30)+days*86400000);}
  /* Tarih hücresi ayrıştırma: sayı (seri), Date, '01/09/2026', '01.09.2026', '1-9-26', '2026-09-01', '1 Eylül 2026'. */
  function parseDateValue(v,opts={}){
    if(v==null||v==="")return null;
    if(v instanceof Date&&!Number.isNaN(v.getTime())){/* SheetJS cellDates: yerel saat dilimi kayması riskine karşı 12:00'ye yuvarla */const t=new Date(v.getTime()+12*3600000);return{ymd:ymd(t.getFullYear(),t.getMonth()+1,t.getDate()),how:"date-object"};}
    if(typeof v==="number"){if(v>20000&&v<80000)return{ymd:excelSerialToYmd(v,opts.date1904),how:"excel-seri"};return null;}
    const s=cleanSpaces(v);if(!s)return null;
    let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
    if(m){const r=ymd(+m[1],+m[2],+m[3]);return validYmd(r)?{ymd:r,how:"yyyy-aa-gg"}:null;}
    m=s.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})(?!\d)/);
    if(m){let y=+m[3];if(m[3].length===2)y=2000+y;else if(m[3].length===3)return null;const r=ymd(y,+m[2],+m[1]);return validYmd(r)?{ymd:r,how:m[3].length===2?"gg/aa/yy":"gg/aa/yyyy"}:null;}
    m=s.match(/^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
    if(m){const mo=monthFromName(m[2]);if(mo){const r=ymd(+m[3],mo,+m[1]);return validYmd(r)?{ymd:r,how:"gg ay yyyy"}:null;}}
    /* yılsız '1 Eylül' / '01 Eylül Salı': yıl ipucu aydan alınır (Aralık↔Ocak geçişi düzeltilir) */
    m=s.match(/^(\d{1,2})\s*\.?\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)/);
    if(m&&opts.month){const mo=monthFromName(m[2]);if(mo){let y=+opts.month.slice(0,4);const hm=+opts.month.slice(5,7);if(mo-hm>6)y--;else if(hm-mo>6)y++;const r=ymd(y,mo,+m[1]);return validYmd(r)?{ymd:r,how:"gg ay (yılsız)"}:null;}}
    if(/^\d{1,2}$/.test(s)&&opts.month){const r=`${opts.month}-${pad(+s)}`;return validYmd(r)?{ymd:r,how:"gün-no"}:null;}
    if(/^\d+(\.\d+)?$/.test(s)){const n=Number(s);if(n>20000&&n<80000)return{ymd:excelSerialToYmd(n,opts.date1904),how:"excel-seri-metin"};}
    return null;
  }

  /* ---------- FMS ---------- */
  /* Resmî/ücrete esas FMS: tatil onaylı değeri > kural tablosu. Tatil onaysızsa null (tahmin yok). */
  /* YETKİLİ KURALLARI (14.10.2026): arefe (yarım gün) HAFTA İÇİNE denk gelirse 08–08 nöbeti 19 FMS (24 − 5 saat mesai);
     hafta sonuna denk gelirse o günün normal değeri (mesai yok). Tek başına gündüz mesaisi (08–16 / 09–17 biçimi) Cumartesi, Pazar ve
     resmî tatilde 8 FMS. Değerler FMS tablosunda (halfday, daytime) durur; 3.0 oturumlarında anahtar yoksa varsayılan kullanılır. */
  const RULE_KEYS=["halfday","daytime"];
  function tableFms(table,key){const t=table||DEFAULT_FMS_TABLE;const k=String(key);const has=Object.prototype.hasOwnProperty.call(t,k);return num(has?t[k]:(RULE_KEYS.includes(k)?DEFAULT_FMS_TABLE[k]:null));}
  /* saat "SS:DD" — gündüz mesaisi: 08:00–09:00 arası başlar, 16:00–17:00 arası biter; gece: gece yarısını geçer (bitiş ≤ başlangıç, 08–08 tam nöbet hariç) */
  function isDaytimeShift(s){return!!s&&/^\d\d:\d\d$/.test(s.start||"")&&/^\d\d:\d\d$/.test(s.end||"")&&s.start>="08:00"&&s.start<="09:00"&&s.end>="16:00"&&s.end<="17:00";}
  function isNightShift(s){return!!s&&/^\d\d:\d\d$/.test(s.start||"")&&/^\d\d:\d\d$/.test(s.end||"")&&!(s.start==="08:00"&&s.end==="08:00")&&s.end<=s.start;}
  function standardFms(date,cfg={}){
    const hol=(cfg.holidays||[]).find(h=>h.date===date);const table=cfg.fmsTable||DEFAULT_FMS_TABLE;const wd=weekday(date);
    if(hol&&hol.kind==="yarım gün")return wd>=1&&wd<=5?tableFms(table,"halfday"):tableFms(table,wd);
    if(hol){const v=num(hol.fms);return v==null?null:v;}
    return tableFms(table,wd);
  }
  function num(v){if(v===""||v==null)return null;const n=Number(String(v).replace(",","."));return Number.isFinite(n)?n:null;}
  function round2(v){return Math.round(v*100)/100;}
  function fmtNum(v){if(v==null||Number.isNaN(v))return"—";return new Intl.NumberFormat("tr-TR",{maximumFractionDigits:2}).format(v);}

  /* Türkiye resmî tatilleri — ÖNERİ listesidir; FMS etkisi kurum tarafından doğrulanmadan kullanılmaz. Dini bayram tarihleri Diyanet takviminden teyit edilmelidir. */
  /* Resmî tatil ve yarım gün günleri programa GÖMÜLÜ DEĞİLDİR: her ay kullanıcıya sorulur (tahmin yok). */

  /* ---------- SHA-256 (saf JS; file:// ve eski tarayıcılarda da çalışır) ---------- */
  function sha256Hex(bytes){
    const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const len=u8.length,bitLenHi=Math.floor(len/0x20000000),bitLenLo=(len<<3)>>>0;
    const total=((len+9+63)>>6)<<6;const buf=new Uint8Array(total);buf.set(u8);buf[len]=0x80;
    const dv=new DataView(buf.buffer);dv.setUint32(total-8,bitLenHi);dv.setUint32(total-4,bitLenLo);
    const W=new Uint32Array(64);
    for(let off=0;off<total;off+=64){
      for(let i=0;i<16;i++)W[i]=dv.getUint32(off+i*4);
      for(let i=16;i<64;i++){const x=W[i-15],y=W[i-2];const s0=((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3);const s1=((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10);W[i]=(W[i-16]+s0+W[i-7]+s1)>>>0;}
      let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for(let i=0;i<64;i++){const S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));const ch=(e&f)^(~e&g);const t1=(h+S1+ch+K[i]+W[i])>>>0;const S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));const mj=(a&b)^(a&c)^(b&c);const t2=(S0+mj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
      H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
    }
    return Array.from(H).map(x=>x.toString(16).padStart(8,"0")).join("");
  }
  function sha256Text(s){return sha256Hex(new TextEncoder().encode(String(s)));}

  /* ---------- Excel hücre adresi ---------- */
  function colLetter(c){let s="";c=c+1;while(c>0){const m=(c-1)%26;s=String.fromCharCode(65+m)+s;c=Math.floor((c-1)/26);}return s;}
  function a1(r,c){return`${colLetter(c)}${r+1}`;}
  function parseA1(ref){const m=String(ref).match(/^([A-Z]+)(\d+)$/);if(!m)return null;let c=0;for(const ch of m[1])c=c*26+(ch.charCodeAt(0)-64);return{r:+m[2]-1,c:c-1};}

  let uidCounter=0;
  function uid(prefix="id"){uidCounter=(uidCounter+1)%1e6;return`${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
  function clone(o){return o==null?o:JSON.parse(JSON.stringify(o));}
  function uniq(arr){return[...new Set(arr)];}

  return{VERSION,UNITS,CATEGORY_OF_UNIT,MONTHS_TR,DAYS_TR,DEFAULT_FMS_TABLE,fold,cleanSpaces,displayName,personKey,personIdOf,levenshtein,nameSimilarity,
    ymd,isYmd,validYmd,addDays,dateDiff,weekday,dayName,dayShort,daysInMonth,monthDates,prevMonth,nextMonth,monthLabel,fmtDate,monthFromName,excelSerialToYmd,parseDateValue,
    standardFms,tableFms,isDaytimeShift,isNightShift,num,round2,fmtNum,sha256Hex,sha256Text,colLetter,a1,parseA1,uid,clone,uniq,trLower,trUpper};
});
