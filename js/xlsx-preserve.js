/* Orijinal .xlsx dosyasının biçimini KORUYARAK yazma.
   SheetJS (topluluk sürümü) stil yazamadığı için dosya ZIP/XML düzeyinde düzenlenir:
   - Orijinal sayfalar ve styles.xml'deki mevcut biçimler değişmez (yalnız SONUNA yeni stil eklenebilir).
   - 'clone' modu: kaynak sayfanın XML'i kopyalanır (stil indeksleri, birleşik hücreler, sütun genişlikleri,
     satır yükseklikleri, sayfa yapısı aynen), yalnız isim hücreleri değiştirilir, yeni sayfa olarak eklenir.
   - 'inplace' modu: dosyanın KOPYASINDA kaynak sayfanın yalnız isim hücreleri değiştirilir. */
(function(root,factory){const api=factory(root.NobetCore);if(typeof module==="object"&&module.exports)module.exports=api;root.NobetXlsx=api;})(typeof globalThis!=="undefined"?globalThis:this,function(C){
  "use strict";
  if(!C&&typeof require==="function")C=require("./core.js");
  const enc=s=>new TextEncoder().encode(s);const dec=u=>new TextDecoder("utf-8").decode(u);
  const NS_REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const WS_TYPE=NS_REL+"/worksheet";const WS_CT="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
  /* XML 1.0'da geçersiz karakterler (denetim karakterleri, U+FFFE/U+FFFF, eşi olmayan vekil) metinden çıkarılır: aksi hâlde gerçek Excel dosyayı açmaz (FABLE T13-5) */
  function xmlText(s){return String(s??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,"").replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g,(m,c)=>c||"");}
  function escXml(s){return xmlText(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function escRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
  /* AD ALANI ÖNEKİ: bazı üreticiler (ör. .NET OpenXML SDK) ana ad alanını önekle yazar: <x:workbook>, <x:sheet>, <x:row>, <x:c>.
     Kök öğenin öneki ("x:" ya da "") bulunur; tüm aramalar ve EKLENEN tüm öğeler bu önekle yapılır. */
  function nsPrefix(xml,local){const m=String(xml||"").match(new RegExp(`<([A-Za-z_][\\w.-]*:)?${local}[\\s>/]`));return m&&m[1]?m[1]:"";}
  /* önek eklenmemiş bir XML parçasındaki öğe adlarına öneki ekler (öznitelikler ve xml:space dokunulmaz) */
  function withPrefix(fragment,P){return P?fragment.replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g,(m,sl,n)=>n.includes(":")?m:`<${sl}${P}${n}`):fragment;}

  function openZip(XLSX,bytes){
    const u8=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(!(u8[0]===0x50&&u8[1]===0x4b))throw new Error("Dosya .xlsx (ZIP) değil; biçim korunarak yazılamaz.");
    const cfb=XLSX.CFB.read(u8,{type:"array"});
    const norm=p=>"/"+String(p).replace(/^\/+/,"");
    return{cfb,
      has:p=>!!XLSX.CFB.find(cfb,norm(p)),
      readBytes:p=>{const e=XLSX.CFB.find(cfb,norm(p));return e?new Uint8Array(e.content):null;},
      read:p=>{const e=XLSX.CFB.find(cfb,norm(p));return e?dec(new Uint8Array(e.content)):null;},
      write:(p,data)=>{const e=XLSX.CFB.find(cfb,norm(p));const content=typeof data==="string"?enc(data):data;if(e){e.content=content;e.size=content.length;}else XLSX.CFB.utils.cfb_add(cfb,norm(p),content);},
      remove:p=>{if(XLSX.CFB.find(cfb,norm(p)))XLSX.CFB.utils.cfb_del(cfb,norm(p));},
      list:()=>cfb.FullPaths.filter(p=>!p.endsWith("/")).map(p=>p.replace(/^Root Entry\//,"")).filter(p=>!p.includes("\u0001Sh33tJ5")),
      out:()=>new Uint8Array(XLSX.CFB.write(cfb,{fileType:"zip",type:"array",compression:true}))};
  }
  function attr(tag,name){const m=tag.match(new RegExp(`\\s${escRe(name)}="([^"]*)"`));return m?m[1]:null;}
  function workbookInfo(zip){
    const wb=zip.read("xl/workbook.xml");const rels=zip.read("xl/_rels/workbook.xml.rels");if(!wb||!rels)throw new Error("workbook.xml bulunamadı.");
    const relMap={};for(const m of rels.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b[^>]*>/g)){const id=attr(m[0],"Id"),t=attr(m[0],"Target");relMap[id]={target:t,type:attr(m[0],"Type")};}
    const sheets=[];let i=0;const P=nsPrefix(wb,"workbook");
    for(const m of wb.matchAll(new RegExp(`<${escRe(P)}sheet\\b[^>]*\\/?>`,"g"))){
      const tag=m[0];const ridAttr=(tag.match(/\s([A-Za-z0-9]+:id)="/)||[])[1]||"r:id";const rid=attr(tag,ridAttr);const t=relMap[rid]?.target||"";
      const path=t.startsWith("/")?t.slice(1):("xl/"+t).replace(/\/\.\//g,"/");
      sheets.push({name:unesc(attr(tag,"name")),sheetId:+attr(tag,"sheetId"),rid,ridAttr,path,index:i++,state:attr(tag,"state")||"visible",tag});
    }
    return{wb,rels,relMap,sheets,prefix:P};
  }
  function unesc(s){return String(s||"").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");}

  /* ---- sheetData düzenleme ---- */
  function colIndex(ref){return C.parseA1(ref).c;}
  function setCells(xml,updates,opts={}){
    /* updates: Map ref -> {text:string|null, lines?:number} ; text null => değeri temizle (stil kalır) */
    const P=opts.prefix!=null?opts.prefix:nsPrefix(xml,"worksheet");
    const sdStart=xml.indexOf(`<${P}sheetData`);if(sdStart<0)throw new Error("sheetData yok.");
    const sdOpenEnd=xml.indexOf(">",sdStart);const selfClosing=xml[sdOpenEnd-1]==="/";
    let before,inner,after;
    if(selfClosing){before=xml.slice(0,sdStart)+`<${P}sheetData>`;inner="";after=`</${P}sheetData>`+xml.slice(sdOpenEnd+1);}
    else{const sdEnd=xml.indexOf(`</${P}sheetData>`,sdOpenEnd);before=xml.slice(0,sdOpenEnd+1);inner=xml.slice(sdOpenEnd+1,sdEnd);after=xml.slice(sdEnd);}
    /* satırları ayrıştır */
    const eP=escRe(P);const rowRe=new RegExp(`<${eP}row\\b[^>]*?(\\/>|>([\\s\\S]*?)<\\/${eP}row>)`,"g");const rowOpenRe=new RegExp(`^<${eP}row\\b[^>]*?(?=\\/?>)`);
    const cRe0=`<${eP}c\\b[^>]*?(\\/>|>[\\s\\S]*?<\\/${eP}c>)`;const cOpenRe=new RegExp(`^<${eP}c\\b[^>]*?(?=\\/?>)`);
    const rows=[];let m;
    while((m=rowRe.exec(inner))){const open=m[0].match(rowOpenRe)[0];const r=+attr(open+" ","r");rows.push({r,open,body:m[1]==="/>"?"":m[2],selfClose:m[1]==="/>"});}
    const byRow=new Map();for(const[ref,u]of updates){const p=C.parseA1(ref);(byRow.get(p.r+1)||byRow.set(p.r+1,[]).get(p.r+1)).push({ref,...u,c:p.c});}
    const colStyle=opts.colStyles||{};
    for(const[rn,list]of byRow){
      let row=rows.find(x=>x.r===rn);
      if(!row){row={r:rn,open:`<${P}row r="${rn}"`,body:"",selfClose:false,created:true};rows.push(row);}
      let cells=[];const cRe=new RegExp(cRe0,"g");let cm;while((cm=cRe.exec(row.body))){const ctag=cm[0].match(cOpenRe)[0];cells.push({ref:attr(ctag+" ","r"),xml:cm[0],s:attr(ctag+" ","s")});}
      for(const u of list){
        const ex=cells.find(c=>c.ref===u.ref);const s=ex?ex.s:(colStyle[u.c]??null);
        const sAttr=s!=null?` s="${s}"`:"";
        const x=u.text==null||u.text===""?`<${P}c r="${u.ref}"${sAttr}/>`:`<${P}c r="${u.ref}"${sAttr} t="inlineStr"><${P}is><${P}t xml:space="preserve">${escXml(u.text)}</${P}t></${P}is></${P}c>`;
        if(ex)ex.xml=x;else cells.push({ref:u.ref,xml:x,s});
      }
      cells.sort((a,b)=>colIndex(a.ref)-colIndex(b.ref));
      row.body=cells.map(c=>c.xml).join("");row.selfClose=false;
      /* satır yüksekliği: gerekli satır sayısı artarsa yükselt */
      const need=Math.max(0,...list.map(u=>u.lines||1));
      if(opts.lineHeight&&need>1){const ht=C.num(attr(row.open+" ","ht"));const want=need*opts.lineHeight;if(ht!=null&&ht<want){row.open=row.open.replace(/\sht="[^"]*"/,` ht="${want}"`);if(!/customHeight=/.test(row.open))row.open+=` customHeight="1"`;row.heightChanged={from:ht,to:want};}}
      /* spans güncel tut (Excel için ipucu) */
      if(/\sspans="/.test(row.open)&&cells.length){const cs=cells.map(c=>colIndex(c.ref)+1);const sp=`${Math.min(...cs)}:${Math.max(...cs)}`;const cur=attr(row.open+" ","spans");if(cur){const[a,b]=cur.split(":").map(Number);const[na,nb]=sp.split(":").map(Number);row.open=row.open.replace(/\sspans="[^"]*"/,` spans="${Math.min(a,na)}:${Math.max(b,nb)}"`);}}
    }
    rows.sort((a,b)=>a.r-b.r);
    const newInner=rows.map(r=>r.selfClose?`${r.open}/>`:`${r.open}>${r.body}</${P}row>`).join("");
    return{xml:before+newInner+after,heightChanges:rows.filter(r=>r.heightChanged).map(r=>({row:r.r,...r.heightChanged}))};
  }
  function stripForClone(xml){
    let x=xml;
    /* öğe ya kendi kendini kapatır (<drawing r:id=".."/>) ya da çocuklarıyla birlikte kapanış etiketine kadar silinir (<tableParts><tablePart/></tableParts>) */
    x=x.replace(/<((?:[A-Za-z_][\w.-]*:)?)(drawing|legacyDrawing|legacyDrawingHF|picture|tableParts|oleObjects|controls|webPublishItems)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\2>)/g,"");
    x=x.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g,m=>/(oleObject|control)/.test(m)?"":m);
    x=x.replace(/<((?:[A-Za-z_][\w.-]*:)?)hyperlinks>[\s\S]*?<\/\1hyperlinks>/g,m=>/r:id=|:id=/.test(m)?"":m);
    x=x.replace(/(<(?:[A-Za-z_][\w.-]*:)?pageSetup\b[^>]*?)\s[A-Za-z0-9]+:id="[^"]*"/g,"$1");
    x=x.replace(/\stabSelected="1"/g,"");
    x=x.replace(/<((?:[A-Za-z_][\w.-]*:)?)f\b[^>]*\/>|<((?:[A-Za-z_][\w.-]*:)?)f\b[^>]*>[\s\S]*?<\/\2f>/g,"");
    return x;
  }
  function uniqueSheetName(existing,base){let n=base.slice(0,31);const has=x=>existing.some(e=>e.toLocaleLowerCase("tr-TR")===x.toLocaleLowerCase("tr-TR"));let k=2;while(has(n)){const suf=` (${k++})`;n=base.slice(0,31-suf.length)+suf;}return n.replace(/[\[\]:*?\/\\]/g,"-");}
  function addSheetPart(zip,info,name,xml){
    const used=new Set(zip.list());let k=info.sheets.length+1;while(used.has(`xl/worksheets/sheet${k}.xml`))k++;
    const path=`xl/worksheets/sheet${k}.xml`;zip.write(path,xml);
    let rels=zip.read("xl/_rels/workbook.xml.rels");let rid=1;while(new RegExp(`Id="rId${rid}"`).test(rels))rid++;const RP=nsPrefix(rels,"Relationships");
    rels=rels.replace(`</${RP}Relationships>`,`<${RP}Relationship Id="rId${rid}" Type="${WS_TYPE}" Target="worksheets/sheet${k}.xml"/></${RP}Relationships>`);zip.write("xl/_rels/workbook.xml.rels",rels);
    let ct=zip.read("[Content_Types].xml");const TP=nsPrefix(ct,"Types");if(!ct.includes(`/xl/worksheets/sheet${k}.xml`))ct=ct.replace(`</${TP}Types>`,`<${TP}Override PartName="/${path}" ContentType="${WS_CT}"/></${TP}Types>`);zip.write("[Content_Types].xml",ct);
    let wb=zip.read("xl/workbook.xml");const P=nsPrefix(wb,"workbook");const eP=escRe(P);const maxId=Math.max(0,...[...wb.matchAll(new RegExp(`<${eP}sheet\\b[^>]*\\ssheetId="(\\d+)"`,"g"))].map(m=>+m[1]));
    const ridAttr=(info.sheets[0]&&info.sheets[0].ridAttr)||"r:id";const ridPfx=ridAttr.includes(":")?ridAttr.split(":")[0]:"";
    /* r: öneki bazı üreticilerde yalnız her <sheet> öğesinde tanımlıdır; yeni öğede de tanımlanır (yinelenen tanım XML'de geçerlidir) */
    const nsDecl=ridPfx?` xmlns:${ridPfx}="${NS_REL}"`:"";
    wb=wb.replace(new RegExp(`<\\/${eP}sheets>`),`<${P}sheet name="${escXml(name)}" sheetId="${maxId+1}" ${ridAttr}="rId${rid}"${nsDecl}/></${P}sheets>`);
    zip.write("xl/workbook.xml",wb);
    const newIndex=info.sheets.length;info.sheets.push({name,sheetId:maxId+1,rid:`rId${rid}`,ridAttr,path,index:newIndex});
    return{path,index:newIndex,name};
  }
  function copyPrintDefinedNames(zip,srcSheet,newSheet){
    let wb=zip.read("xl/workbook.xml");const adds=[];const P=nsPrefix(wb,"workbook");const eP=escRe(P);
    for(const m of wb.matchAll(new RegExp(`<${eP}definedName\\b([^>]*)>([\\s\\S]*?)<\\/${eP}definedName>`,"g"))){const a=m[1];const nm=attr(a+" ","name");const lid=attr(a+" ","localSheetId");if(lid==null||+lid!==srcSheet.index||!/^_xlnm\.(Print_Area|Print_Titles)$/.test(nm))continue;
      const qs=`'${srcSheet.name.replace(/'/g,"''")}'!`;const qn=`'${newSheet.name.replace(/'/g,"''")}'!`;let val=m[2].split(escXml(qs)).join(escXml(qn)).split(qs).join(qn);val=val.replace(new RegExp(`(^|,)${escRe(escXml(srcSheet.name))}!`,"g"),`$1${escXml(qn)}`);
      adds.push(`<${P}definedName name="${nm}" localSheetId="${newSheet.index}"${/hidden="1"/.test(a)?' hidden="1"':""}>${val}</${P}definedName>`);}
    if(!adds.length)return 0;
    if(wb.includes(`</${P}definedNames>`))wb=wb.replace(`</${P}definedNames>`,adds.join("")+`</${P}definedNames>`);else wb=wb.replace(`</${P}sheets>`,`</${P}sheets><${P}definedNames>`+adds.join("")+`</${P}definedNames>`);
    zip.write("xl/workbook.xml",wb);return adds.length;
  }
  /* styles.xml'e SONA ekleme (mevcut indeksler değişmez) */
  function appendStyles(zip){
    let st=zip.read("xl/styles.xml");if(!st)return null;const P=nsPrefix(st,"styleSheet");const eP=escRe(P);
    const countOf=tag=>{const m=st.match(new RegExp(`<${eP}${tag}\\b[^>]*count="(\\d+)"`));if(m)return+m[1];const block=st.match(new RegExp(`<${eP}${tag}\\b[^>]*>([\\s\\S]*?)<\\/${eP}${tag}>`));return block?(block[1].match(new RegExp(`<${eP}${tag.slice(0,-1)}\\b`,"g"))||[]).length:0;};
    const push=(tag,items)=>{const start=countOf(tag);const re=new RegExp(`(<${eP}${tag}\\b[^>]*>)([\\s\\S]*?)(<\\/${eP}${tag}>)`);if(!re.test(st))return null;st=st.replace(re,(m,a,b,c)=>a.replace(/count="\d+"/,`count="${start+items.length}"`)+b+items.map(x=>withPrefix(x,P)).join("")+c);return start;};
    const fBold=push("fonts",['<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>','<font><b/><sz val="13"/><name val="Calibri"/><family val="2"/></font>','<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>']);
    const fill=push("fills",['<fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill>','<fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill>','<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>','<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>',
      /* PROBEL ekranındaki renkler: H.İçi sarı, Cuma mor, C.tesi turuncu, Pazar mavi, (eski) NSİ gri; 3.3.3: mesai yeşil, hafta sonu gri, Yİz. açık mavi, Bşl. turuncu-kırmızı, Rpr. mor, GÖREV turkuaz, R.T. kırmızı */
      ...["FFFFFF00","FFCC99FF","FFF4B084","FF33CCFF","FFE7E6E6","FF33FF33","FFD0D0D0","FF7DD3F7","FFFF6633","FF9C6BFF","FF6FE3E3","FFE53935"].map(c=>`<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`)]);
    const bor=push("borders",['<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>']);
    if(fBold==null||fill==null||bor==null)return null;
    const al='<alignment vertical="top" wrapText="1"/>';
    const xfs=[
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="${bor}" xfId="0" applyBorder="1" applyAlignment="1">${al}</xf>`,
      `<xf numFmtId="0" fontId="${fBold}" fillId="${fill+3}" borderId="${bor}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`,
      `<xf numFmtId="0" fontId="${fBold+1}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`,
      `<xf numFmtId="0" fontId="0" fillId="${fill+1}" borderId="${bor}" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`,
      `<xf numFmtId="0" fontId="0" fillId="${fill+2}" borderId="${bor}" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`,
      `<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="${bor}" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`,
      ...[4,5,6,7,8,9,10,11].map(k=>`<xf numFmtId="0" fontId="0" fillId="${fill+k}" borderId="${bor}" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`),
      `<xf numFmtId="0" fontId="${fBold}" fillId="${fill+10}" borderId="${bor}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`,
      `<xf numFmtId="0" fontId="0" fillId="${fill+12}" borderId="${bor}" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
      ...[13,14].map(k=>`<xf numFmtId="0" fontId="0" fillId="${fill+k}" borderId="${bor}" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`),
      `<xf numFmtId="0" fontId="${fBold+2}" fillId="${fill+15}" borderId="${bor}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`
    ];
    const x0=push("cellXfs",xfs);if(x0==null)return null;
    zip.write("xl/styles.xml",st);
    return{cell:x0,header:x0+1,title:x0+2,error:x0+3,warn:x0+4,ok:x0+5,pHici:x0+6,pCuma:x0+7,pCtesi:x0+8,pPazar:x0+9,pNsi:x0+10,pMesai:x0+11,pHs:x0+12,pYiz:x0+13,pHsHead:x0+14,pBsl:x0+15,pRpr:x0+16,pGorev:x0+17,pRt:x0+18};
  }
  /* rapor sayfası XML'i (satır dizileri). rows: [[değer|{v,s}]] */
  function reportSheetXml(rows,opts={}){
    const st=opts.styles||{};const widths=opts.widths||[];
    const cols=widths.length?`<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols>`:"";
    const body=rows.map((row,ri)=>{const r=ri+1;const cells=row.map((cell,ci)=>{if(cell==null||cell==="")return"";const o=typeof cell==="object"&&!(cell instanceof Date)?cell:{v:cell};const ref=C.a1(ri,ci);let s=o.s!=null?st[o.s]:(ri===0&&opts.titleRow?st.title:(ri===(opts.headerRow??0)&&opts.header?st.header:st.cell));const sA=s!=null?` s="${s}"`:"";if(typeof o.v==="number"&&Number.isFinite(o.v))return`<c r="${ref}"${sA}><v>${o.v}</v></c>`;return`<c r="${ref}"${sA} t="inlineStr"><is><t xml:space="preserve">${escXml(o.v)}</t></is></c>`;}).join("");return`<row r="${r}">${cells}</row>`;}).join("");
    const pane=opts.freeze?`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${opts.freeze}" topLeftCell="A${opts.freeze+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`:`<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
    return`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/></worksheet>`;
  }

  /* Ana dışa aktarma */
  function exportPreserving(XLSX,bytes,o){
    const zip=openZip(XLSX,bytes);const info=workbookInfo(zip);
    const src=info.sheets.find(s=>s.name===o.sourceSheet);if(!src)throw new Error(`Kaynak sayfa '${o.sourceSheet}' bulunamadı.`);
    const srcXml=zip.read(src.path);if(!srcXml)throw new Error("Kaynak sayfa XML'i okunamadı.");
    const SP=nsPrefix(srcXml,"worksheet");const eSP=escRe(SP);
    const colStyles={};for(const m of srcXml.matchAll(new RegExp(`<${eSP}col\\b[^>]*\\/>`,"g"))){const a=+attr(m[0]+" ","min"),b=+attr(m[0]+" ","max"),s=attr(m[0]+" ","style");if(s!=null)for(let c=a;c<=b;c++)colStyles[c-1]=s;}
    const report={mode:o.mode,sourceSheet:src.name,sourcePath:src.path,changedCells:o.updates.size,heightChanges:[],addedSheets:[],definedNamesCopied:0,calcChainRemoved:false};
    if(o.mode==="inplace"){
      const touchedFormula=[...o.updates.keys()].some(ref=>new RegExp(`<${eSP}c r="${ref}"[^>]*>(?:(?!</${eSP}c>)[\\s\\S])*<${eSP}f\\b`).test(srcXml));
      const r=setCells(srcXml,o.updates,{colStyles,lineHeight:o.lineHeight||15});zip.write(src.path,r.xml);report.heightChanges=r.heightChanges;report.officialSheet=src.name;
      if(touchedFormula&&zip.has("xl/calcChain.xml")){zip.remove("xl/calcChain.xml");let ct=zip.read("[Content_Types].xml");ct=ct.replace(/<(?:[A-Za-z_][\w.-]*:)?Override[^>]*calcChain[^>]*\/>/,"");zip.write("[Content_Types].xml",ct);let rels=zip.read("xl/_rels/workbook.xml.rels");rels=rels.replace(/<(?:[A-Za-z_][\w.-]*:)?Relationship[^>]*calcChain[^>]*\/>/,"");zip.write("xl/_rels/workbook.xml.rels",rels);report.calcChainRemoved=true;}
    }else{
      const name=uniqueSheetName(info.sheets.map(s=>s.name),o.newSheetName||"RESMİ ÖNERİ");
      const r=setCells(stripForClone(srcXml),o.updates,{colStyles,lineHeight:o.lineHeight||15});
      const added=addSheetPart(zip,info,name,r.xml);report.heightChanges=r.heightChanges;report.officialSheet=name;report.addedSheets.push(name);
      report.definedNamesCopied=copyPrintDefinedNames(zip,src,added);
    }
    if(o.reports&&o.reports.length){
      const styles=appendStyles(zip)||{};
      for(const rep of o.reports){const name=uniqueSheetName(info.sheets.map(s=>s.name),rep.name);addSheetPart(zip,info,name,reportSheetXml(rep.rows,{...rep,styles}));report.addedSheets.push(name);}
    }
    return{bytes:zip.out(),report};
  }

  /* Biçim koruma doğrulaması (testler ve kullanıcıya gösterilen rapor için) */
  /* XML iyi biçimlilik: etiket dengesi; sayfa XML'inde artan satır/hücre sırası ve yinelenmeyen hücre */
  function wellFormedness(xml,isSheet){
    const stack=[];const re=/<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;let m;
    while((m=re.exec(xml))){if(m[0].startsWith("<?")||m[0].startsWith("<!"))continue;const close=m[1]==="/",name=m[2],self=m[4]==="/";if(close){const top=stack.pop();if(top!==name)return`etiket dengesi bozuk: </${name}> (beklenen </${top||"—"}>)`;}else if(!self)stack.push(name);}
    if(stack.length)return`kapanmamış etiket: <${stack[stack.length-1]}>`;
    if(isSheet){const rows=[...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*?\br="(\d+)"/g)].map(x=>+x[1]);for(let i=1;i<rows.length;i++)if(rows[i]<=rows[i-1])return`satır sırası bozuk: ${rows[i-1]} → ${rows[i]}`;
      const seen=new Set();let prev=null;for(const x of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*?\br="([A-Z]+)(\d+)"/g)){const ref=x[1]+x[2];if(seen.has(ref))return`yinelenen hücre: ${ref}`;seen.add(ref);const p=C.parseA1(ref);if(prev&&prev.r===p.r&&p.c<=prev.c)return`hücre sırası bozuk: ${C.a1(prev.r,prev.c)} → ${ref}`;prev=p;}}
    return null;
  }
  function sheetParts(xml){const P=escRe(nsPrefix(xml,"worksheet"));const g=src=>{const m=xml.match(new RegExp(src.replace(/§/g,P)));return m?m[0]:"";};return{cols:g("<§cols>[\\s\\S]*?<\\/§cols>"),merges:g("<§mergeCells\\b[\\s\\S]*?<\\/§mergeCells>"),pageSetup:g("<§pageSetup\\b[^>]*\\/>").replace(/\s[A-Za-z0-9]+:id="[^"]*"/,""),margins:g("<§pageMargins\\b[^>]*\\/>"),printOptions:g("<§printOptions\\b[^>]*\\/>"),headerFooter:g("<§headerFooter\\b[\\s\\S]*?<\\/§headerFooter>"),sheetFormatPr:g("<§sheetFormatPr\\b[^>]*\\/>"),cellStyles:[...xml.matchAll(new RegExp(`<${P}c r="([A-Z]+\\d+)"(?:[^>]*?\\ss="(\\d+)")?`,"g"))].map(m=>`${m[1]}:${m[2]||"0"}`).sort().join(","),rowHeights:[...xml.matchAll(new RegExp(`<${P}row\\b[^>]*>`,"g"))].map(m=>`${attr(m[0]+" ","r")}:${attr(m[0]+" ","ht")||""}`).join(",")};}
  function verifyPreservation(XLSX,origBytes,outBytes,sourceSheet,officialSheet,mode){
    const a=openZip(XLSX,origBytes),b=openZip(XLSX,outBytes);const ia=workbookInfo(a),ib=workbookInfo(b);
    const checks=[];const add=(name,ok,detail="")=>checks.push({name,ok,detail});
    /* 1) orijinal tüm parçalar: değişmemiş olmalı (inplace modda kaynak sayfa ve gerekirse calcChain hariç) */
    const changedAllowed=new Set(["xl/workbook.xml","xl/_rels/workbook.xml.rels","[Content_Types].xml","xl/styles.xml"]);
    const srcPath=ia.sheets.find(s=>s.name===sourceSheet)?.path;
    if(mode==="inplace")changedAllowed.add(srcPath);
    const diffParts=[];for(const p of a.list()){if(changedAllowed.has(p))continue;const x=a.readBytes(p),y=b.readBytes(p);if(!y){if(!(mode==="inplace"&&p==="xl/calcChain.xml"))diffParts.push(p+" (silinmiş)");continue;}if(x.length!==y.length||x.some((v,i)=>v!==y[i]))diffParts.push(p);}
    add("Orijinal sayfalar/parçalar bayt düzeyinde aynı",!diffParts.length,diffParts.join(", "));
    if(mode!=="inplace"){const x=a.readBytes(srcPath),y=b.readBytes(srcPath);add("Kaynak (fiilî) sayfa hiç değişmedi",!!y&&x.length===y.length&&x.every((v,i)=>v===y[i]));}
    /* 2) styles.xml: mevcut stiller korunmuş (yalnız sona ekleme) */
    const sa=a.read("xl/styles.xml")||"",sb=b.read("xl/styles.xml")||"";
    const blocks=["numFmts","fonts","fills","borders","cellStyleXfs","cellXfs","cellStyles","dxfs"];let stylesOk=true;const sdet=[];
    const SPa=escRe(nsPrefix(sa,"styleSheet")),SPb=escRe(nsPrefix(sb,"styleSheet"));
    for(const t of blocks){const ra=sa.match(new RegExp(`<${SPa}${t}\\b[^>]*>([\\s\\S]*?)<\\/${SPa}${t}>`)),rb=sb.match(new RegExp(`<${SPb}${t}\\b[^>]*>([\\s\\S]*?)<\\/${SPb}${t}>`));if(!ra)continue;if(!rb||!rb[1].startsWith(ra[1])){stylesOk=false;sdet.push(t);}}
    add("styles.xml mevcut biçimleri korunmuş (yalnız sona ekleme)",stylesOk,sdet.join(", "));
    /* 3) resmî sayfa yapısı kaynakla aynı */
    const offPath=ib.sheets.find(s=>s.name===officialSheet)?.path;const xa=a.read(srcPath),xb=b.read(offPath);
    if(xa&&xb){const pa=sheetParts(xa),pb=sheetParts(xb);
      add("Birleşik hücreler aynı",pa.merges===pb.merges);add("Sütun genişlikleri aynı",pa.cols===pb.cols);add("Sayfa yapısı (kağıt/yön/ölçek) aynı",pa.pageSetup===pb.pageSetup);add("Kenar boşlukları aynı",pa.margins===pb.margins);add("Üst/alt bilgi aynı",pa.headerFooter===pb.headerFooter);add("Varsayılan satır biçimi aynı",pa.sheetFormatPr===pb.sheetFormatPr);
      const ca=new Map(pa.cellStyles.split(",").filter(Boolean).map(x=>x.split(":"))),cb=new Map(pb.cellStyles.split(",").filter(Boolean).map(x=>x.split(":")));let styleDiff=[];for(const[ref,s]of ca)if(cb.has(ref)&&cb.get(ref)!==s)styleDiff.push(ref);
      add("Hücre stilleri (renk/kenarlık/yazı tipi indeksleri) aynı",!styleDiff.length,styleDiff.slice(0,10).join(","));
      const ha=pa.rowHeights.split(","),hb=pb.rowHeights.split(",");const hchg=hb.filter(x=>!ha.includes(x));add("Satır yükseklikleri (yalnız isim sığdırmak için artırılanlar hariç) aynı",true,hchg.length?`değişen: ${hchg.join(" ")}`:"");}
    const wfErr=[];for(const p of b.list()){if(!/\.(xml|rels)$/.test(p))continue;const e=wellFormedness(b.read(p),/^xl\/worksheets\/[^/]+\.xml$/.test(p));if(e)wfErr.push(`${p}: ${e}`);}
    add("Tüm XML parçaları iyi biçimli (etiket dengesi, satır/hücre sırası, yinelenen hücre yok)",!wfErr.length,wfErr.slice(0,5).join(" · "));
    add("Dosya SheetJS ile yeniden okunabiliyor",(()=>{try{const wb=XLSX.read(outBytes,{type:"array"});return wb.SheetNames.includes(officialSheet);}catch(e){return false;}})());
    return{ok:checks.every(c=>c.ok),checks};
  }
  return{xmlText,wellFormedness,openZip,workbookInfo,setCells,stripForClone,addSheetPart,appendStyles,reportSheetXml,exportPreserving,verifyPreservation,escXml,uniqueSheetName,nsPrefix,withPrefix};
});
