/* TALİMATNAME — uygulamanın kullandığı tüm parametreler ve kurallar.
   İçerik ELLE YAZILMAZ: sayısal değerler, kodlar ve iletiler tests/talimatname_uret.js tarafından programın kendi
   modüllerinden ve kaynak kodundan çıkarılıp js/talimatname_veri.js dosyasına yazılır (NobetTalimatVeri).
   Bu dosya yalnız o veriyi okunur bir belgeye dönüştürür. Aynı oluşturucu:
   - uygulama içinde (Veri ▸ Talimatname) — o ayın GÜNCEL değerleriyle birlikte,
   - paketlemede TALIMATNAME.html ve TALIMATNAME.pdf üretmek için kullanılır.
   Program değişip talimatname eskirse test paketi (EK24) KALIR; paketleme talimatnameyi kendiliğinden yeniden üretir. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;root.NobetTalimat=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num=v=>v==null||v===""?"—":String(v).replace(".",",");
  const LEVEL={error:"Kesin hata (çizelgeyi durdurur / reddeder)",warning:"Uyarı",info:"Bilgi"};
  /* yetkili kuralı değeri (FMS tablosunun halfday/daytime anahtarı); 3.0 oturumunda anahtar yoksa program varsayılanı kullanır */
  const rule=(g,k)=>g&&g.fmsTable&&k in g.fmsTable?g.fmsTable[k]:"varsayılan";
  const DAYKEY={weekday:"Hafta içi (Pzt–Prş)",friday:"Cuma",saturday:"Cumartesi",sunday:"Pazar",holiday:"Resmî tatil",halfday:"Yarım gün"};
  /* yalnız .tal kapsamlı stil (uygulama içinde sayfanın kendi stilini bozmaz); bağımsız belgede gövde stili ayrıca eklenir */
  const BODY_CSS=`body{font-family:"Segoe UI",Calibri,Arial,sans-serif;color:#1d2b28;font-size:12px;line-height:1.45;margin:0;background:#fff}`;
  const CSS=`.tal{font-family:"Segoe UI",Calibri,Arial,sans-serif;color:#1d2b28;font-size:12px;line-height:1.45}
    .tal{max-width:980px;margin:0 auto;padding:18px 22px}.tal h1{font-size:21px;margin:0 0 4px}.tal h2{font-size:15px;margin:22px 0 6px;padding-bottom:3px;border-bottom:2px solid #1f6f5c;color:#174f43;page-break-after:avoid}
    .tal h3{font-size:13px;margin:12px 0 4px}.tal p{margin:5px 0}.tal .meta{color:#4b5d58;font-size:11px}.tal .box{border:1px solid #c9dcd5;background:#f3f8f6;border-radius:6px;padding:8px 10px;margin:8px 0}
    .tal .warn{border-color:#e7cf8f;background:#fff8e6}.tal table{border-collapse:collapse;width:100%;margin:6px 0;font-size:11px;page-break-inside:auto}.tal tr{page-break-inside:avoid}
    .tal th,.tal td{border:1px solid #c9d6d2;padding:3px 6px;text-align:left;vertical-align:top}.tal th{background:#e6f0ec}.tal code{font-family:Consolas,monospace;font-size:10.5px;background:#eef3f1;padding:0 3px;border-radius:3px}
    .tal ol,.tal ul{margin:4px 0 4px 20px;padding:0}.tal .code{white-space:nowrap}.tal .small{font-size:10.5px;color:#4b5d58}
    @media print{.tal{padding:0;max-width:none}.tal h2{margin-top:14px}}`;
  const table=(head,rows)=>`<table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  function render(d,live){
    if(!d)return`<div class="tal"><p>Talimatname verisi bulunamadı (js/talimatname_veri.js yüklenmedi).</p></div>`;
    const g=d.global,dd=g.defaults||{};const gap=g.minGapDays;const days=["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
    const fmsRows=[1,2,3,4,5,6,0].map(i=>[esc(days[i]),num(g.fmsTable[i])]);
    const w=d.solver.weights,cov=d.solver.coverage;
    const wDesc={over:"Fazla ödeme cezası (eşdeğer saat başına)",short:"Eksik kalan hakediş cezası (yalnız onaylı devir modunda)",day:"Görev günü başına küçük maliyet (gereksiz gün azaltılır)",actual:"Kişinin fiilen çalıştığı güne yazma ödülü",weekend:"Hafta sonu cezası",avoid:"Kişinin “kaçınılsın” dediği gün cezası",prefer:"Kişinin “tercih” ettiği gün ödülü",balanceServis:"Servis günlük yük dengesi",balanceAcil:"Acil günlük yük dengesi",hard:"Günlük sınır ihlalinin başlangıç fiyatı (ihlal sürdükçe artar)",switch:"Kategori değiştirme cezası",posted:"Bu ayın PROBEL'e işlenmiş nöbetini koruma ödülü (yalnız bu ayın PROBEL listesi yüklü ve “koru” açıkken; kesin kural değil)"};
    const imp=d.solver.improve||{};
    let h=`<div class="tal">
    <h1>Pediatri Nöbet Dengeleyici — Talimatname</h1>
    <p class="meta">Sürüm ${esc(d.version)} · Parametre imzası <code>${esc(String(d.signature||"").slice(0,16))}</code> · Bu belge programın <b>kendi kodundan otomatik</b> üretilmiştir; program güncellendikçe yeniden üretilir (elle düzenlenmez).</p>
    <div class="box">Bu talimatname uygulamanın kullandığı <b>tüm parametreleri</b>, sabit kuralları, her ay kullanıcıya sorulan değerleri, içe aktarma ve PROBEL okuma kurallarını, çözücü ayarlarını, Excel çıktısını, depolamayı ve programın gösterebileceği tüm hata/uyarı kodlarını listeler. Uygulama içindeki “Veri ▸ Talimatname” ekranı ayrıca o ayın <b>güncel</b> değerlerini gösterir.</div>

    <h2>1. Değiştirilemeyen (kesin) kurallar</h2>
    ${table(["Kural","Değer"],[
      ["Kişi başı ayda en çok farklı resmî nöbet günü",`<b>${num(g.maxDutyDays)}</b>`],
      ["Nöbet başlangıçları arası en az takvim günü",`<b>${num(gap)}</b> (yani nöbetler arasında en az ${num(gap-1)} tam boş gün); önceki ayın RESMÎ (PROBEL) son nöbetleri ve sonraki ayın resmî ilk nöbetleri dahil`],
      ["Kategori","Her kişi bir ayda tek kategoride: fiilen yalnız Servis çalışan → Servis; yalnız Acil ailesinde çalışan → Acil; ikisinde çalışan → biri"],
      ["Acil ailesi (bölüm → ödeme kategorisi)",Object.entries(d.categoryOfUnit).map(([u,c])=>`${esc(u)} → <b>${esc(c)}</b>`).join(" · ")],
      ["Servis-eşdeğeri saat",Object.entries(g.factors).map(([c,f])=>`${esc(c)} FMS × <b>${num(f)}</b>`).join(" + ")],
      ["Aylık saat tavanı","YOK (120 saat gibi bir üst sınır uygulanmaz)"],
      ["Çalışılmamış nöbet","Ücretli resmî nöbet yazılmaz (fiilî hakedişi olmayana resmî görev yazılmaz)"],
      ["Tahmin","Program klinik/bordro değeri tahmin etmez: bilinmeyen değer “onay bekliyor / veri eksik” gösterilir ve çizelge üretilmez"]])}
    <h3>Standart FMS tablosu (saat)</h3>${table(["Gün","FMS"],fmsRows)}
    <h3>Yetkili kuralları (14.10.2026)</h3>${table(["Kural","FMS"],[
      ["Arefe (yarım gün) 08–08 nöbeti, hafta içine (Pzt–Cuma) denk gelirse — 24 − 5 saat mesai; tek 8'in katı olmayan değer",`<b>${num(rule(g,"halfday"))}</b>`],
      ["Arefe hafta sonuna denk gelirse","o günün normal değeri (mesai yok)"],
      ["Tek başına gündüz mesaisi (08:00–09:00 arası başlar, 16:00–17:00 arası biter; ör. 08–16, 09–17) Cumartesi, Pazar ve resmî tatilde",`<b>${num(rule(g,"daytime"))}</b> (Acil ailesinde × 1,5 eşdeğer)`],
      ["Tek başına gece görevi (gece yarısını geçen, ör. 17–08)","olmaz — uyarı; düzeltilene ya da FMS elle girilene kadar sayılmaz"],
      ["İki yerde çalışma","yalnız Cumartesi/Pazar ve Acil ailesi içinde: o günün tam Acil nöbeti. Hafta içi (tatil dahil) ya da Servis + Acil karışık gün → uyarı, sayılmaz"]])}
    <p class="small">Resmî tatilde FMS, o ay kullanıcının girip onayladığı değerdir (bkz. bölüm 2). Yarım gün (arefe) için değer sorulmaz.</p>

    <h2>2. Her ay kullanıcıya sorulan / girilen değerler</h2>
    ${table(["Değer","Varsayılan","Açıklama"],[
      ["Acil günlük EN FAZLA kişi",num(dd.emergencyCap),"Acil ailesinde aynı gün farklı kişi sayısı üst sınırı; her ay onaylanır"],
      ["Acil günlük EN AZ",num(dd.emergencyMin),"Girilmeden çizelge üretilmez (0 olabilir)"],
      ["Servis günlük EN AZ",num(dd.serviceMin),"Girilmeden çizelge üretilmez (0 olabilir)"],
      ["Servis günlük EN FAZLA",num(dd.serviceMax),"Boş = sınır yok"],
      ["Belirli günler için farklı sınır","—","Tarih bazında Servis/Acil en az–en fazla"],
      ["“Bu ay resmî tatil var mı?”","cevapsız","<b>Her ay sorulur</b>; Evet ise günler ve her günün FMS'i girilip onaylanır"],
      ["“Bu ay yarım gün çalışma var mı?” (ör. bayram arifesi)","cevapsız","<b>Her ay sorulur</b>; Evet ise günler girilir. Nöbet FMS'i sorulmaz (yetkili kuralı, bölüm 1); hafta içi arefede özel vardiyaların yarım gün FMS'i ayrıca istenir"],
      ["Geçen ayın son 2 günündeki resmî nöbetler","girilmedi","Geçen ayın program çıktısı Excel'inden gelir ya da elle işaretlenir; girilen kayıt tam sayılır (bölüm 4)"],
      ["Hakediş modu",d.monthDefaults.mode==="strict"?"Devirsiz":"Onaylı devir","Devirsiz: resmî karşılık fiilî hakedişten az olamaz. Onaylı devir: eksik kalan fark yetkili onayıyla sonraki aya devredilebilir"],
      ["Başlangıç kontrol edildi (kişi)","—","Oryantasyonla başlayan ya da geçen ayın fiilî listesinde olmayan kişi için “yeni mi başladı?” uyarısını kapatır; yeni başladıysa bunun yerine “Henüz başlamadı” izni girilir. Program başlama tarihini tahmin etmez"],
      ["İzin = personelin ÇALIŞMADIĞI her gün","—",`Sebepler (yalnız bilgi; hepsi aynı işlenir, o günlerde resmî nöbet yazılmaz): ${(d.leaveReasons||[]).map(esc).join(", ")}. İşten ayrılış: ayrıldığı günden ay sonuna; henüz başlamadı: ay başından başladığı güne kadar girilir. Ay sınırını aşan izin sonraki aya taşınır. İzinli günde fiilî nöbet varsa uyarı verilir.`],
      ["Hariç tutulanlar, nöbet tercihleri","—","Hariç tutma yalnız ilgili ay için (taşınmaz). “Nöbet istemiyor / istiyor / yalnız bu aralıkta” izin değil, tercihtir"],
      ["Onaylı hakediş (kişi)","—","Satır hesabı yerine onaylı değer; not/kaynak zorunlu; fark uyarı olarak kalır ve uyarı kaynak satırlarını listeler. Önerilen yol kayıt düzeyinde düzeltmedir: hakedişe girmemesi gereken kayıt gerekçesiyle “hakediş dışı” bırakılır (kaynak silinmez), eksik kayıt kaynağıyla elle eklenir"],
      ["Kategori/klinik yetki (kişi)","—","Fiilî kaydı olmayan kişiyi bir kategoriye yazmak için; yetkilendiren adı zorunlu"]])}

    <h2>3. Özel vardiyalar ve oryantasyon</h2>
    <p>Excel'de saat notuyla yazılmış görevler için FMS, gün türüne göre kullanıcı tarafından girilir; değerler kaydedilir ve sonraki aylarda tekrar sorulmaz. Adım 3 tablosunda yalnız o ay gerçekten kaydı olan gün türü sorulur (diğer hücreler “bu ay gerekmiyor”). Boş değer o kaydı “veri eksik” bırakır. İstisnalar (yetkili kuralı, bölüm 1): gündüz mesaisinin Cumartesi/Pazar/resmî tatil değeri sabittir (sorulmaz); gece görevi tek başına sayılmaz.</p>
    ${table(["Gün türü","Açıklama"],Object.entries(DAYKEY).map(([k,v])=>[`<code>${k}</code>`,esc(v)]))}
    <p><b>İki yerde saatli nöbet:</b> aynı kişi <b>Cumartesi ya da Pazar</b> en az iki farklı Acil ailesi bölümünde saatli görev yaptıysa (ör. Acil 17.00–08.00 + Yenidoğan 09.00–17.00) ve o gün saatsiz kaydı yoksa o gün <b>tek tam nöbet</b> sayılır: kategori <b>Acil</b>, FMS günün standart değeri (tatilse onaylı değeri); özel vardiya FMS'i sorulmaz. Hafta içi (resmî tatil dahil) ya da Servis karışan iki yer günü birleştirilmez: uyarı verir ve kayıt düzeltilene (ya da FMS elle girilene) kadar sayılmaz. Elle FMS verilmiş, oryantasyon ya da bölümü belirsiz kayıt içeren gün birleştirilmez.</p>
    <p>Oryantasyon nöbeti <b>her zaman gerçek nöbet</b> gibi sayılır: günün standart FMS'i (kullanıcı kararı 14.10.2026; ayar yok). Oryantasyon kaydı kategori yetkisi doğurmaz.</p>

    <h2>4. Ay sınırı</h2>
    <ul><li>Geçen ayın son <b>3</b> gününün RESMÎ nöbetleri bu ayın ilk günleri için engeldir (fiilî liste değil).</li>
    <li>Bu nöbetler iki yoldan girilir: (1) geçen ayın <b>program çıktısı Excel'i</b> yüklenir (bölüm 6), (2) kişiler <b>elle</b> eklenir. PROBEL listesi yüklenmez (sürüm 3).</li>
    <li>Geçen ayın son 2 günü için aktarılan ya da elle girilen resmî nöbetler tam kayıt sayılır (onay kutusu yok — 3.3.2). Bir kategori yalnız elle girildiyse durum “Tam (elle girildi)” olur. Hiç nöbet girilmemişse sonuç “eksik veri” sayılır; bir günde bu ayın günlük asgarisinden az kişi biliniyorsa uyarı verilir (ilk 2 gün kapatılmaz).</li>
    <li>Elle girilen ay sonu adı bu ayın listesindeki bir adla benzerse (ör. soyadı değişimi) “aynı kişi mi?” kararı istenir; karar verilene kadar benzer ada ay sınırı güvenli tarafta uygulanır ve bağımsız denetçi ihlali kesin hata sayar.</li>
    <li>Ay sonunda sonraki ayın resmî ilk günleri biliniyorsa onlara karşı da dinlenme denetlenir.</li>
    <li>“Sonraki aya devret” (aynı oturumda): resmî son nöbetler, onaylı açık devirler, ay sınırını aşan izinler, başlama/ayrılış ve klinik yetkiler taşınır; hariç tutma ve ödeme durumu taşınmaz; kurallar öneri olarak gelir ve yeniden onay ister.</li></ul>

    <h2>5. Fiilî Excel'in içe aktarılması</h2>
    <ul><li>Hastanenin yatay tablosu olduğu gibi okunur: tarih satırları + bölüm sütunları (${d.units.map(esc).join(", ")}); birleşik tarih hücreleri, alt alta/virgülle yazılmış isimler, saat ve oryantasyon notları, ay dışı satırlar.</li>
    <li>Ayıklanan unvanlar: ${d.importActual.titlePrefixes.map(x=>`<code>${esc(x)}.</code>`).join(" ")} ${d.importActual.titleWords.map(x=>`<code>${esc(x)}</code>`).join(" ")}</li>
    <li>“Uzun biçim” reddi: tekrar eden tarih satırı sayısı &gt; en az <b>${num(d.importActual.longFormatMinDup)}</b> ve tarih satırlarının <b>%${num(d.importActual.longFormatRatio*100)}</b>'si → dosya hastanenin yatay tablosu sayılmaz, başka sayfa denenir.</li>
    <li>Birden fazla sayfa tabloya benziyorsa (puan ≥ ${num(d.importActual.sheetAmbiguousScore)}, fark &lt; ${num(d.importActual.sheetAmbiguousGap)}) uyarı verilir; sayfa elle seçilebilir.</li>
    <li>Ad alanı önekli (ör. <code>&lt;x:sheet&gt;</code>) ve mutlak yollu Excel paketleri de okunur ve biçim korunarak yazılır.</li>
    <li>Aynı kişi aynı gün iki kayıt: ikinci tam nöbet hakedişe tekrar sayılmaz (kontrol uyarısı).</li>
    <li>İsimler: benzer adlar için öneri gösterilir; otomatik birleştirme yapılmaz; kullanıcı kararı kalıcıdır.</li></ul>

    <h2>6. Aydan aya taşıma (${esc(d.carry.sheet)} sayfası)</h2>
    <p>Program kalıcı veri tutmaz. Gelecek ayın ihtiyaç duyduğu bilgi, “Excel indir” ile alınan dosyanın <b>${esc(d.carry.sheet)}</b> sayfasında taşınır (biçim <code>${esc(d.carry.format)}</code>, sürüm ${num(d.carry.v)}; JSON parçaları + SHA-256). Gelecek ay Adım 1 → ② bölümünde bu dosya yüklenir.</p>
    <ul><li>Taşınanlar: ayın resmî çizelgesi (sonraki ayın ay başı kontrolü için), onaylı isim eşleştirmeleri ve “farklı kişi” kararları, özel vardiya FMS değerleri, ay sonunu aşan izinler ve müsait olmama kayıtları, başlama/ayrılış ve klinik yetkiler, devir defterinin açık kayıtları, kurallar (öneri olarak; yeniden onay ister).</li>
    <li>Taşınmayanlar: kimlik/sicil numaraları, hariç tutma (yalnız o ay), ödeme durumu, orijinal Excel dosyası.</li>
    <li>Yalnız bir önceki aya ait dosya kabul edilir. Sayfa değiştirilmişse (SHA-256 tutmuyorsa) içe alınmaz.</li>
    <li>Bu ay boş olan değerler doldurulur; kullanıcının bu ay girdiği değerler ezilmez (fark varsa bildirilir). Aynı dosyayı ikinci kez yüklemek kayıtları çoğaltmaz.</li></ul>

    <h2>7. Çözücü</h2>
    <p>Kişi başına kesin dinamik programlama (en çok ${num(g.maxDutyDays)} gün, başlangıç aralığı ≥ ${num(gap)}, engelli günler, tek kategori, hakediş) + günlük kadro sınırları için uyarlamalı ceza fiyatlı yerel arama. Süre sınırı <b>${num(g.timeLimitSec)} sn</b>. Sonuç ayrıca bağımsız denetimden geçer.</p>
    ${table(["Ağırlık","Değer","Anlamı"],Object.entries(w).map(([k,v])=>[`<code>${esc(k)}</code>`,num(v),esc(wDesc[k]||"")]))}
    <h3>“Çözüm yok” yalnız açık kanıtla söylenir</h3>
    <ol><li><b>Kişi kanıtı:</b> engeller, ${num(g.maxDutyDays)} gün ve dinlenme kuralıyla kişinin hakedişine hiçbir kategoride ulaşılamıyor.</li>
    <li><b>Gün kanıtı:</b> bir günün asgari kadrosu için yazılabilecek kişi sayısı yetmiyor (neden dökümüyle: izin, ay sınırı…).</li>
    <li><b>Kapasite kanıtı:</b> yalnız bir kategoriye yazılabilenlerin en az gün ihtiyacı, o kategorinin günlük üst sınırları toplamını aşıyor.</li>
    <li><b>Kategori kapsama kanıtı:</b> devirsiz modda bir kategoriye ancak hakedişini o kategoride tamamlayabilen kişiler yazılabilir; bunlar asgari kadro isteyen günlerin hepsini kapsayamıyorsa (kesin arama; en çok ${num(cov.ms)} ms, ${num(cov.nodes)} düğüm, ${num(cov.maxCandidates)} aday — aşılırsa iddia edilmez).</li></ol>
    <p>Kanıt yoksa ve süre içinde çözüm bulunamazsa sonuç “bulunamadı (zaman sınırı)” olur — bu bir imkânsızlık kanıtı değildir.</p>
    <h3>Fazla ödeme alt sınırı ve kategori iyileştirme (devirsiz mod)</h3>
    <p><b>Alt sınır:</b> her kişinin hakedişi günlük FMS adımlarıyla karşılanabildiği için kişi başına kaçınılmaz bir fazla vardır (engeller, ${num(g.maxDutyDays)} gün ve dinlenme kuralıyla, izin verilen kategorilerin en küçüğü). Günlük kadro ve diğer kişiler yok sayıldığı için toplamı gerçek en iyi çözümden büyük olamaz. Planın fazlası bu sınıra eşitse “olası en düşük (kanıtlı)” yazılır; değilse fark gösterilir ve en iyi olduğu iddia edilmez.</p>
    <p><b>Kategori iyileştirme:</b> iki kategoride de çalışmış bir kişinin diğer kategorideki kaçınılmaz fazlası şimdikinden küçükse kişi o kategoriye sabitlenip yeniden çözülür; yalnız geçerli ve toplam fazlası kesin azalan sonuç kabul edilir (en çok ${num(imp.rounds)} tur, ${num(imp.ms)} ms; aynı girdi aynı sonucu verir). Onaylı devir modunda yapılmaz.</p>
    ${table(["Durum kodu","Ekranda"],Object.entries(d.statusTr).map(([k,v])=>[`<code>${esc(k)}</code>`,esc(v)]))}

    <h3>Sonuç uyarıları (çizelge kurallara uysa da gösterilir)</h3>
    <ul><li><b>Kadro düşüşü:</b> resmî öneride bir kategorinin günlük kişi sayısı fiilî listede her gün bulunan en az sayının altına düşerse günler listelenir; program yalnız Adım 3'teki günlük asgari değere uyar, kabul edilebilirliği kurum belirler.</li>
    <li><b>Yeni başlayan:</b> resmî öneri kişinin ilk fiilî gününden önceye nöbet yazdıysa bildirilir.</li>
    <li><b>Önceki sürümden gelen PROBEL listesi:</b> sürüm 2.x'te yüklenmiş bu ayın PROBEL listesi oturuma alınmışsa hâlâ hesaba katılır (NSİ engeli, işlenmiş nöbetleri koruma); farklar Excel'de PROBEL FARKI sayfasında listelenir. Adım 3'te kaldırılması önerilir. Sürüm 3'te PROBEL listesi yüklenmez.</li></ul>

    <h2>8. Excel çıktısı</h2>
    <ul><li><b>Orijinal dosya + “RESMİ ÖNERİ” sayfası</b>: kaynak sayfa kopyalanır (stil, birleşik hücre, sütun genişliği, sayfa yapısı aynen), yalnız isim hücreleri değişir; orijinal sayfalar bayt düzeyinde korunur.</li>
    <li><b>Yerinde güncelleme</b>: dosyanın KOPYASINDA kaynak sayfanın isim hücreleri değişir.</li>
    <li>Eklenen rapor sayfaları: ${d.reportSheets.map(x=>`<b>${esc(x)}</b>`).join(", ")}.</li>
    <li>Her çıktıda kullanıcıya gösterilen doğrulamalar: ${d.verifyChecks.map(esc).join("; ")}.</li>
    <li><b>PROBEL giriş listesi</b>: resmî çizelge PROBEL'e elle girilmek üzere ayrı dosya olarak indirilir (PROBEL ekran renkleriyle).</li></ul>
    <h3>PROBEL giriş listesinde tatil etiketi</h3>
    ${table(["Durum","Yazılan etiket"],d.holidayLabels.map(x=>[esc(x.case),`<code>${esc(x.label)}</code>`]))}

    <h2>9. Devir defteri</h2>
    <p>Kayıt türleri: ${d.ledgerKinds.map(k=>`<code>${esc(k)}</code>`).join(", ")}. Devir alacağı açmak için yetkili onayı, ödeme/mahsup için bordro/belge referansı zorunludur; açık bakiyeden fazla ödeme engellenir (çift ödeme engeli). Kayıtlar silinmez.</p>

    <h2>10. Verilerin saklanması</h2>
    ${table(["Öğe","Değer"],[
      ["Çalışma",`yalnız bu sekmenin oturum belleği (sessionStorage), anahtar <code>${esc(d.storage.KEY)}</code>. Sayfa yenilenince kalır; sekme ya da tarayıcı kapanınca tarayıcı siler; “Bitir ve temizle” hemen siler. Kalıcı depo (localStorage, IndexedDB) kullanılmaz.`],
      ["Orijinal dosyalar",`bellekte ve sığarsa oturum belleğinde (önek <code>${esc(d.storage.FILE_PREFIX)}</code>); oturum belleği sınırı yaklaşık ${num(d.storage.SS_LIMIT)} karakter. Sığmazsa yalnız bellekte tutulur ve kullanıcı uyarılır (sayfa yenilenirse dosya yeniden yüklenmelidir).`],
      ["Çalışmayı dosyaya kaydet",`yalnız kullanıcı isterse: JSON dosyası (biçim <code>${esc(d.storage.BACKUP_FORMAT)}</code>, veri sürümü 4; orijinal dosyaları da içerir). Başka cihazda “Kaydedilmiş çalışmadan devam et” ile açılır. Kişisel veri içerir.`],
      ["Ağ","program hiçbir veriyi ağa göndermez; dosyalar ve hesaplar yalnız tarayıcıda işlenir"],
      ["Önceki sürümün (2.x) verisi","bu tarayıcıda bulunursa bildirilir: kullanıcı oturuma alabilir, dosya olarak indirebilir ya da silebilir; program kendiliğinden silmez ve yeni kalıcı veri yazmaz"]])}

    <h2>11. Kişisel veri</h2>
    <ul><li>Program dosyalarında (yayınlanan klasör) personel adı, kimlik ya da sicil numarası yoktur; kurum kararları (hariç tutma, onaylı hakediş, isim eşleştirme) her ay kullanıcı tarafından girilir ya da geçen ayın çıktı Excel'inden gelir.</li>
    <li>Kimlik numarası programa girilmez. Sicil numarası yalnız önceki sürümde yüklenmiş PROBEL listesinden geldiyse PROBEL giriş listesinde görünür; aydan aya taşınmaz.</li>
    <li>Çıktı Excel'i ve çalışma dosyası kişisel veri içerir: yalnız yetkili cihazlarda saklayın, üçüncü taraf hizmetlere yüklemeyin.</li></ul>

    <h2>12. Hata, uyarı ve bilgi kodları (${d.codes.length})</h2>
    <p class="small">Kaynak koddan otomatik çıkarılmıştır. “…” yerine iletide kişi, tarih veya değer gelir.</p>
    ${table(["Kod","Düzey","Modül","İleti (örnek)"],d.codes.map(c=>[`<code class="code">${esc(c.code)}</code>`,esc(c.levels.map(l=>LEVEL[l]||l).join(" / ")||"—"),esc(c.modules.join(", ")),esc(c.message)]))}`;
    if(live&&live.db&&live.month&&live.db.months&&live.db.months[live.month])h+=liveSection(live.db,live.db.months[live.month],live);
    return h+`</div>`;
  }
  /* uygulama içinde: bu ayın güncel değerleri */
  function liveSection(db,M,live){
    const s=M.settings||{},g=db.global||{},sd=s.specialDays||{};const mlabel=live.monthLabel||M.month;
    const list=k=>(s.holidays||[]).filter(h=>(h.kind==="yarım gün")===(k==="half")).map(h=>h.kind==="yarım gün"?`${esc(h.date)} ${esc(h.label)} (FMS yetkili kuralıyla)`:`${esc(h.date)} ${esc(h.label)} FMS ${num(h.fms)}${h.confirmed?"":" (onaysız)"}`).join("; ")||"—";
    return`<h2>13. ${esc(mlabel)} — güncel değerler (bu sekmedeki çalışma)</h2>
    ${table(["Değer","Güncel"],[
      ["Acil günlük en fazla / en az",`${num(s.emergencyCap)} / ${num(s.emergencyMin)}`],["Servis günlük en az / en fazla",`${num(s.serviceMin)} / ${num(s.serviceMax)}`],
      ["Belirli günler için farklı sınır",String((M.dailyRequirements||[]).length)],
      ["Resmî tatil var mı?",sd.holiday==null?"CEVAPLANMADI":sd.holiday?"Evet: "+list("hol"):"Hayır"],["Yarım gün var mı?",sd.halfDay==null?"CEVAPLANMADI":sd.halfDay?"Evet: "+list("half"):"Hayır"],
      ["Hakediş modu",s.mode==="defer"?"onaylı devir":"devirsiz"],
      ["Hariç tutulan kişi",String((M.exclusions||[]).length)],["İzin / müsait olmama kaydı",`${(M.leaves||[]).length} / ${(M.unavailable||[]).length}`],
      ["Özel vardiya kuralları",(g.specialShiftRules||[]).map(r=>`${esc(r.start)}–${esc(r.end)}: ${Object.entries(r.fms||{}).map(([k,v])=>`${esc(DAYKEY[k]||k)} ${num(v)}`).join(", ")}`).join("<br>")||"—"],
      ["Oryantasyon nöbeti","gerçek nöbet (sabit kural)"],
      ["FMS tablosu (Pzt…Paz)",[1,2,3,4,5,6,0].map(i=>num((g.fmsTable||{})[i])).join(" / ")],["Arefe nöbeti (hafta içi) / gündüz mesaisi (Cts/Paz/tatil)",`${num(rule(g,"halfday"))} / ${num(rule(g,"daytime"))}`],["Katsayılar",Object.entries(g.factors||{}).map(([c,f])=>`${esc(c)} ×${num(f)}`).join(", ")]])}`;
  }
  function documentHtml(d,live){return`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Talimatname — Pediatri Nöbet Dengeleyici ${esc(d&&d.version)}</title><style>${BODY_CSS}${CSS}</style></head><body>${render(d,live)}</body></html>`;}
  return{render,documentHtml,CSS};
});
