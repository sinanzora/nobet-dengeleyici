/* Oturum deposu (sürüm 3): program KALICI veri tutmaz. Çalışma yalnız bu sekmenin oturum belleğinde (sessionStorage) durur:
   sayfa yenilenirse kaybolmaz, sekme ya da tarayıcı kapanınca tarayıcı tarafından silinir; “Bitir ve temizle” hemen siler.
   Yüklenen orijinal dosyalar (Excel'in biçimini koruyarak çıktı üretmek için gerekir) bellekte ve sığdığı kadarıyla oturum belleğinde tutulur.
   Aydan aya gereken bilgi tarayıcıda DEĞİL, programın ürettiği çıktı Excel'inin “PROGRAM VERİSİ” sayfasında taşınır.
   Çalışmayı dosyaya kaydetme (JSON) kullanıcının kendi isteğiyle yapılır; dosya kullanıcıdadır.
   Eski sürümlerin (2.x) bu tarayıcıda bıraktığı kalıcı veri bulunursa yalnız okunur: kullanıcı oturuma alabilir ya da silebilir. */
(function(root){
  "use strict";
  const KEY="pediatri-nobet-v4",FILE_PREFIX=KEY+".dosya.";
  /* eski sürümlerin (2.x) kalıcı veri yerleri — yalnız okuma/silme için */
  const OLD={LS_KEY:"pediatri-nobet-v4",LS_V3:"pediatri-nobet-v3",IDB:"pediatri-nobet-dosyalar",IDB_STORE:"files"};
  /* sessionStorage için tarayıcıların ortak sınırı ≈5 milyon karakter */
  const SS_LIMIT_APPROX=5000000;
  const mem=new Map();
  const ss=()=>{try{return root.sessionStorage||null;}catch(e){return null;}};
  const ls=()=>{try{return root.localStorage||null;}catch(e){return null;}};
  function b64(u8){let s="";const CH=0x8000;for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));return btoa(s);}
  function unb64(s){const bin=atob(s);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return u8;}
  /* ---- oturum verisi ---- */
  function loadDb(){const S=ss();if(!S)return{db:null,error:"Tarayıcı oturum belleğine erişilemiyor; çalışma yalnız bu sayfa açıkken bellekte tutulur (sayfayı yenilemeyin)."};
    let raw=null;try{raw=S.getItem(KEY);}catch(e){return{db:null,error:"Oturum belleği okunamadı."};}
    if(!raw)return{db:null};
    try{const obj=JSON.parse(raw);if(obj&&obj.version===4&&obj.months)return{db:obj};return{db:null,error:"Oturumdaki veri bu sürümle açılamadı; yeni oturum başlatıldı."};}catch(e){return{db:null,error:"Oturumdaki veri bozuk; yeni oturum başlatıldı."};}}
  function saveDb(db){const S=ss();if(!S)return{ok:false,memoryOnly:true,error:"Oturum belleği yok: sayfa yenilenirse çalışma kaybolur."};
    try{S.setItem(KEY,JSON.stringify(db));return{ok:true};}catch(e){return{ok:false,memoryOnly:true,error:/quota/i.test(String(e&&e.name||e))?"Oturum belleği doldu: çalışma bu sayfada sürüyor ama sayfa yenilenirse kaybolur. “Çalışmayı dosyaya kaydet” ile güvenceye alın.":"Oturum belleğine yazılamadı: "+(e&&e.message||e)};}}
  /* ---- orijinal dosyalar ---- */
  async function putFile(hash,rec){mem.set(hash,rec);const S=ss();if(!S)return{ok:true,session:false};
    try{S.setItem(FILE_PREFIX+hash,JSON.stringify({name:rec.name,type:rec.type,addedAt:rec.addedAt,role:rec.role,b64:b64(new Uint8Array(rec.bytes))}));return{ok:true,session:true};}
    catch(e){try{S.removeItem(FILE_PREFIX+hash);}catch(e2){}return{ok:true,session:false};}}
  function fromSession(hash){const S=ss();if(!S)return null;try{const v=S.getItem(FILE_PREFIX+hash);if(!v)return null;const o=JSON.parse(v);const rec={name:o.name,type:o.type,addedAt:o.addedAt,role:o.role,bytes:unb64(o.b64).buffer};mem.set(hash,rec);return rec;}catch(e){return null;}}
  async function getFile(hash){return mem.get(hash)||fromSession(hash)||null;}
  async function allFiles(){const out={};const S=ss();if(S){try{for(let i=0;i<S.length;i++){const k=S.key(i);if(k&&k.startsWith(FILE_PREFIX)){const h=k.slice(FILE_PREFIX.length);if(!mem.has(h))fromSession(h);}}}catch(e){}}for(const[k,v]of mem)out[k]=v;return out;}
  /* dosyanın sayfa yenilemesine dayanıp dayanmayacağı (oturum belleğinde mi, yalnız bellekte mi) */
  function fileInSession(hash){const S=ss();try{return!!(S&&S.getItem(FILE_PREFIX+hash));}catch(e){return false;}}
  /* ---- bitir ve temizle ---- */
  function clearSession(){mem.clear();const S=ss();if(!S)return;try{const ks=[];for(let i=0;i<S.length;i++){const k=S.key(i);if(k&&(k===KEY||k.startsWith(FILE_PREFIX)))ks.push(k);}ks.forEach(k=>S.removeItem(k));}catch(e){}}
  function sessionUsage(){const S=ss();let n=0;try{if(S)for(let i=0;i<S.length;i++){const k=S.key(i);if(k&&(k===KEY||k.startsWith(FILE_PREFIX)))n+=k.length+(S.getItem(k)||"").length;}}catch(e){}return{chars:n,limit:SS_LIMIT_APPROX,ratio:n/SS_LIMIT_APPROX};}
  /* ---- çalışmayı dosyaya kaydet / dosyadan devam et (kullanıcının dosyası) ---- */
  async function exportBackup(db){const files=await allFiles();const enc={};for(const[k,v]of Object.entries(files))enc[k]={name:v.name,type:v.type,addedAt:v.addedAt,role:v.role,b64:b64(new Uint8Array(v.bytes))};return{format:"pediatri-nobet-yedek",version:4,createdAt:new Date().toISOString(),db,files:enc};}
  async function importBackup(obj){if(!obj||obj.format!=="pediatri-nobet-yedek"||!obj.db||!obj.db.months)throw new Error("Bu dosya Nöbet Dengeleyici çalışma dosyası değil.");if(obj.db.version!==4)throw new Error(`Dosya farklı bir veri sürümüne ait (${obj.db.version}); açılmadı.`);let n=0;for(const[k,v]of Object.entries(obj.files||{})){await putFile(k,{name:v.name,type:v.type,addedAt:v.addedAt,role:v.role,bytes:unb64(v.b64).buffer});n++;}return{db:obj.db,files:n};}
  /* ---- eski sürümlerin (2.x) kalıcı verisi: yalnız bulma, okuma ve kullanıcının isteğiyle silme ---- */
  async function idbExists(){try{if(root.indexedDB&&root.indexedDB.databases){const l=await root.indexedDB.databases();return l.some(d=>d&&d.name===OLD.IDB);}}catch(e){}return null;/* bilinmiyor: veritabanı oluşturmamak için açılmaz */}
  async function findOldData(){const L=ls();let raw=null,rawV3=null,snaps=0;try{if(L){raw=L.getItem(OLD.LS_KEY);rawV3=L.getItem(OLD.LS_V3);for(let i=0;i<L.length;i++){const k=L.key(i);if(k&&k.startsWith(OLD.LS_KEY+"."))snaps++;}}}catch(e){}
    const idb=await idbExists();return{found:!!(raw||rawV3||snaps||idb),raw,rawV3,snaps,idb};}
  function readOldFiles(){return new Promise(res=>{try{const r=root.indexedDB.open(OLD.IDB);r.onupgradeneeded=()=>{try{r.transaction.abort();}catch(e){}};r.onerror=()=>res({});r.onblocked=()=>res({});
      r.onsuccess=()=>{const d=r.result;if(!d.objectStoreNames.contains(OLD.IDB_STORE)){d.close();return res({});}const out={};const tx=d.transaction(OLD.IDB_STORE,"readonly");const q=tx.objectStore(OLD.IDB_STORE).openCursor();q.onsuccess=()=>{const c=q.result;if(c){out[c.key]=c.value;c.continue();}};tx.oncomplete=()=>{d.close();res(out);};tx.onerror=()=>{d.close();res(out);};};}catch(e){res({});}});}
  async function importOldData(){const o=await findOldData();let db=null;if(o.raw){try{const obj=JSON.parse(o.raw);if(obj&&obj.version===4&&obj.months)db=obj;}catch(e){}}
    let files=0;if(db&&o.idb){const all=await readOldFiles();for(const[k,v]of Object.entries(all)){if(v&&v.bytes){await putFile(k,v);files++;}}}
    return{db,files,v3:o.rawV3?(()=>{try{return JSON.parse(o.rawV3);}catch(e){return null;}})():null};}
  async function deleteOldData(){const L=ls();try{if(L){const ks=[];for(let i=0;i<L.length;i++){const k=L.key(i);if(k&&(k===OLD.LS_KEY||k===OLD.LS_V3||k.startsWith(OLD.LS_KEY+".")))ks.push(k);}ks.forEach(k=>L.removeItem(k));}}catch(e){}
    if(await idbExists()!==false){await new Promise(res=>{try{const r=root.indexedDB.deleteDatabase(OLD.IDB);r.onsuccess=r.onerror=r.onblocked=()=>res();}catch(e){res();}});}
    const left=await findOldData();return{ok:!left.found||(left.idb===null&&!left.raw&&!left.rawV3&&!left.snaps),left};}
  root.NobetStorage={KEY,FILE_PREFIX,OLD,SS_LIMIT:SS_LIMIT_APPROX,BACKUP_FORMAT:"pediatri-nobet-yedek",mode:"oturum",
    loadDb,saveDb,putFile,getFile,allFiles,fileInSession,clearSession,sessionUsage,exportBackup,importBackup,findOldData,importOldData,deleteOldData,b64,unb64};
})(typeof globalThis!=="undefined"?globalThis:this);
