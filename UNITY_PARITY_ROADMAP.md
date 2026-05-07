# Engine Project Roadmap ve Mimari Handoff

Bu dokuman iki amac icin tutulur:

- urunun parity roadmap'ini ve aktif fazini gostermek
- projeyi yeni devralan bir yazilimcinin mimariyi hizli anlayip gelistirmeye devam edebilmesini saglamak

Bu proje bir web demo degil. Cekirdek hedef, Unity benzeri editor deneyimini Electron tabanli bir desktop app olarak urunlestirmektir.

## Su An Neredeyiz

Bugun itibariyla durum:

- Faz 1 tamamlandi: Editor chrome parity
- Faz 2 tamamlandi: Layout ve windowing
- Faz 3 tamamlandi: Asset pipeline
- Faz 4 tamamlandi: Scene ve GameObject workflow
- Faz 5 tamamlandi: Serialization parity
- Faz 6 tamamlandi: Inspector parity
- Faz 7 tamamlandi: Runtime ve play mode
- Faz 8 tamamlandi: Rendering, physics, UI
- Faz 9 aktif: Desktop App Productization

Guncel kalite kapilari:

- `node test_all_phases.cjs` = `593/593`
- `node verify_phase9_desktop_productization.cjs` = `16/16`
- `npm.cmd run build` = basarili

Pratik yorum:

- Unity-benzeri editor/runtime omurgasi artik buyuk olcude mevcut.
- Asil acik alan artik parity degil, desktop shell ve productization tarafidir.
- En kritik aktif konu Electron guvenligi ve renderer-main process ayrimini sertlestirmektir.

## Session Bazli Faz Backloglari

Bu bolum, her session tek bir faza odaklanmak icin tutulur. Mantik su:

1. O fazin mevcut durumunu oku
2. Asagidaki backlog maddelerini sirayla ele al
3. Bitirdikce verify/build calistir
4. Roadmap'te o fazin maddelerini guncelle

### Faz 1 Session Backlogu: Editor Chrome

Amac:

- Editorun ilk gorunus ve ilk kullanim hissini daha tutarli hale getirmek
- Yeni gelen kullanicinin arayuzde kaybolma ihtimalini azaltmak
- Toolbar/menu/panel/status alanlarini tek bir tasarim dili altinda toplamak

Mevcut durum:

- Faz 1 parity olarak kapanmis durumda
- Temel chrome mevcut
- Ama polish ve standardizasyon turlari hala yapilabilir

Gelistirme maddeleri:

1. Menu bar standardizasyonu
- Menu basliklari, siralamasi ve aralarindaki kavramsal tutarlilik gozden gecirilecek
- Gereksiz veya tekrarli menu entry'leri temizlenecek
- Kisayolu olan aksiyonlarin menu uzerinde tutarli gorunmesi saglanacak
- Durum notu:
- Ilk tur tamamlandi
- Menu item label/shortcut/check hizasi normalize edildi
- Dinamik Window menu item metinleri tek helper uzerinden guncelleniyor
- Disabled menu item tiklanabilirligi artik tek yerden engelleniyor
- Menu ve submenu elemanlarina role/aria-disabled/aria-checked/aria-expanded semantigi eklendi
- Sonraki alt is: ust menu baslik dili ve redundant entry temizligi

2. Toolbar hizalama ve buton dili
- Toolbar buton boyutlari, bosluklari ve aktif/pasif state dilleri standardize edilecek
- Play/Pause/Step ve transform tool butonlari tek bir gorsel hiyerarsiye alinacak
- Ikon varsa ikon, text varsa text mantigi degil; ayni grupta ayni dil korunacak
- Durum notu:
- Ilk tur tamamlandi
- Transform toolbar kisa harflerden tam aksiyon adlarina gecirildi
- Sol/orta/sag toolbar gruplari ortak siniflarla hizalandi
- Play/Pause/Step state dili daha net hale getirildi, pause ve step artik play mode disinda disabled
- Pivot/Space/Snap tooltip dili runtime state ile senkron tutuluyor
- Sonraki alt is: utility butonlari ve viewport ic toolbarlarla ortak gorsel dil turu

3. Panel baslik ve tab dili
- Hierarchy, Inspector, Project, Console, Render gibi panellerin header yukseklikleri ve bosluklari esitlenecek
- Aktif tab, hover tab, pasif tab state renkleri ve border dili teklestirilecek
- Kapatilmis/bos panel senaryolari icin daha okunur empty-state metinleri eklenecek
- Durum notu:
- Ilk tur tamamlandi
- Ana panel header yapisi ortak `panel-header-main` ve `panel-tab-strip` siniflarina toplandi
- Tab aktif/pasif gorunumu artik inline style yerine CSS state siniflariyla yonetiliyor
- Header bosluk ve hizalama dili Hierarchy, Viewport, Inspector ve alt panelde tek kaliba yaklasti
- Sonraki alt is: console/project/search satiri ve bos panel empty-state metinleri

4. Status bar iyilestirmesi
- Sol ve sag bilgi bloklari netlestirilecek
- FPS/MS, secim bilgisi, play mode durumu ve hata/advisory metinleri icin gorsel oncelik duzeni kurulacak
- Status bar update akisinda gereksiz gorsel titresim veya metin ziplamasi varsa temizlenecek
- Durum notu:
- Ilk tur tamamlandi
- Status bar sol/orta/sag bilgi gruplarina ayrildi
- Log, selection, scene, FPS, MS, draw call ve play mode artik ayri alanlarda okunuyor
- Her tick tum HTML yeniden yazilmak yerine alan bazli text guncellemesi yapiliyor
- Play mode pill rengi artik editing/playing/paused durumunu daha belirgin veriyor
- Sonraki alt is: advisory/severity dili ve secimsiz/bos scene mesajlarini rafine etmek

5. Tooltip ve yardim dili
- Sik kullanilan toolbar/menu butonlarina tutarli tooltip verilecek
- Tooltip formatinda aksiyon + kisayol standardi uygulanacak
- Yeni kullanici icin belirsiz kisaltmalar azaltilacak
- Durum notu:
- Ilk tur tamamlandi
- Menu item title degerleri label + shortcut standardina getirildi
- Toolbar title dili aksiyon odakli hale getirildi
- Inspector bos secimde sahne ayarlarina gecildigi daha net anlatiliyor
- Sonraki alt is: viewport ic toolbar ve context aksiyonlari icin ayni tooltip standardini yaymak

6. Theme ve kontrast turu
- Secili, hover, disabled, border ve background kontrastlari gozden gecirilecek
- Dark theme icindeki okunurluk sorunlari temizlenecek
- Focus state'leri daha belirgin hale getirilecek
- Durum notu:
- Kapanis turu tamamlandi
- Aktif panel header ve border kontrasti guclendirildi
- Hover state ve tab kontrasti netlestirildi
- Menu, toolbar, tab, input, select ve scene view icin ortak focus-visible dili eklendi

7. Empty state ve ilk acilis hissi
- Bos scene, bos project, bos console, secimsiz inspector gibi alanlarda daha net bilgilendirme saglanacak
- Editor ilk acildiginda kullanicinin nereye bakacagini anlatan hafif yonlendirmeler eklenebilir
- Durum notu:
- Ilk tur tamamlandi
- Bos console, bos project/search sonucu ve secimsiz inspector icin ortak empty-state dili eklendi
- Empty-state kartlari ortak stil sinifina baglandi
- Kapanis turu tamamlandi
- Bos hierarchy ve scene view onboarding ipuclari eklendi
- Yeni kullanici icin ilk aksiyonlar artik Hierarchy ve Scene tarafinda daha gorunur

Faz 1 kapanis durumu:

- Faz 1 session backlogu tamamlandi
- Menu, toolbar, panel header/tab, status bar, tooltip, theme ve empty-state turlari kapatildi
- Kalan iyilestirmeler artik Faz 2+ kapsaminda veya genel polish backlogunda ele alinabilir

Oncelik sirasi:

1. Toolbar + menu standardizasyonu
2. Panel/tab/header polish
3. Status bar iyilestirmesi
4. Tooltip ve empty-state turu
5. Theme/kontrast son polish

Riskli noktalar:

- Faz 1 degisiklikleri Faz 2 layout davranisini yanlislikla bozmamali
- Header/tab yukseklik degisiklikleri docking hesaplarini etkilememeli
- Fazla gorsel degisiklik yaparken mevcut muscle memory bozulmamali

Session kapanis kriterleri:

- Menu/toolbar/panel/tab/status alanlari tutarli gorunmeli
- Layout bozulmamali
- Mevcut parity testleri kirilmamali
- `npm run build` temiz gecmeli

Session sonunda calistirilacaklar:

- `node verify_phase1_editor_chrome.cjs`
- `node test_all_phases.cjs`
- `npm.cmd run build`

### Faz 2 Session Backlogu: Layout ve Windowing

Amac:

- Docking, floating, splitter ve tab tasima davranislarini daha ongorulebilir hale getirmek
- Uzun kullanim sessionlarinda layout bozulmalarini ve state kaymalarini azaltmak
- Unity benzeri panel hareketi hissini daha saglam bir taban uzerine oturtmak

Mevcut durum:

- Faz 2 parity olarak kapanmis durumda
- Docking, floating panel, tear-off ve layout persistence ana olarak calisiyor
- Ancak sistem artik daha buyuk ve cok-host lu oldugu icin edge-case sertlestirme ve UX polish turlari mantikli

Kod gozlemi:

- Layout state’i `EditorSettings` + `dockGraph` + `floatingPanels` + tab order listeleri uzerinden tutuluyor
- Legacy ve normalized state birlikte yasiyor; bu guclu ama hata oldugunda debug maliyeti yukseliyor
- Tab host sistemi artik `viewport`, `bottom`, `center-secondary`, `center-tertiary`, `hierarchy`, `inspector` arasinda dagiliyor
- Floating panel drag/resize ve dock preview altyapisi var, yani Faz 2’nin ana riskleri artik ozellik eksigi degil, tutarlilik ve toparlanma davranisi

Gelistirme maddeleri:

1. Dock/undock edge-case sertlestirme
- Ayni panelin hizli sekilde float/dock yapildigi akislarda state kaymasi kontrol edilecek
- `assets-panel` ile dockable view host hareketi arasindaki ozel durumlar sadelestirilecek
- Floating durumdan host’a donuste aktif tab secimi daha deterministik hale getirilecek
- Durum notu:
- Ilk tur tamamlandi
- Layout mutation kapanis akisi tek helper altinda toplandi
- Dock/undock ve detached-view restore sonlarinda ortak normalize + visible-panel fallback calisiyor
- `activeViewportFocusHost` artik layout degisiminden sonra gorunur hostlara geri oturuyor
- Ikinci tur tamamlandi
- Floating drag-drop birakma akisinda gereksiz manuel `apply/save/resize` zinciri kaldirildi
- `dockViewToHost` artik tab tasima + reveal sonrasinda tek `finalizeLayoutMutation` ile kapanis yapiyor
- Sonraki alt is: splitter/clamp tarafinda bos host ve gizli panel sicrama senaryolarini sertlestirmek

2. Splitter ve clamp davranisi polish
- Sol/sag/alt/center splitlerde minimum boyut clamp davranisi gozden gecirilecek
- Gizli panel, floating panel veya bos host durumlarinda splitter gorunurlugu daha akilli hale getirilecek
- Layout degisimi sirasinda gereksiz ani sicrama olup olmadigi kontrol edilecek
- Durum notu:
- Ilk tur tamamlandi
- Center dock splitter gorunurlugu artik gercek komsuluk iliskisine gore hesaplanıyor
- Bosalan center host genislikleri default degerlere geri donuyor; yeniden acilis hissi daha stabil hale geldi
- Sonraki alt is: side/bottom clamp davranisinda ani sicrama yapan dar pencere ve gizli-panel senaryolarini hedefli test etmek

3. Tab drag-drop ve reorder tutarliligi
- Hostlar arasi tab tasima sirasi test edilip hedef host secimi daha netlestirilecek
- `hierarchy` ve `inspector` root tab’lerinin korunma kurali daha acik hale getirilecek
- Drag preview / drop target hissi daha belirginlestirilecek
- Durum notu:
- Ilk tur tamamlandi
- Dockable tab drop karar agaci tek helper altinda toplandi; ayni-host reorder ve hostlar arasi tasima daha deterministik hale geldi
- `hierarchy` ve `inspector` kok tab’lerine birakilan view’lar artik kokun onune degil hemen arkasina yerlestiriliyor
- Ikinci tur tamamlandi
- Host tab strip’leri drag sirasinda artik daha okunur highlight aliyor
- Ayni host icinde bos alana birakilan dockable tab artik host sonunda konumlaniyor; drop bosa gitmiyor
- Sonraki alt is: layout save/load dayanikliligina gecip bozuk snapshot ve eksik DOM toparlanmasini sertlestirmek

4. Layout save/load dayanikliligi
- Slot save/load ve preset load akislarinda eksik DOM/state durumlarina karsi guard’lar artirilacak
- Bozuk veya eski layout snapshot’larinda graceful fallback iyilestirilecek
- `resetLayout` sonrasi aktif panel ve aktif tab restore mantigi tekrar gozden gecirilecek
- Durum notu:
- Ilk tur tamamlandi
- Layout snapshot yukleme oncesi sanitize ediliyor; eksik veya bozuk alanlar mevcut gecerli state ile dolduruluyor
- Layout slot yukleme sirasinda hata olursa editor onceki snapshot’a geri donecek sekilde rollback kazandi
- Ikinci tur tamamlandi
- `resetLayout` ve layout preset gecisleri artik ayni guvenli snapshot uygulama hattini kullaniyor
- `applyStoredLayout` eksik root DOM durumunda sessizce cikarak agresif hata zincirini kesiyor
- Sonraki alt is: floating panel UX turuna gecip baslik aksiyonlari, z-index ve keyboard focus hissini polish etmek

5. Floating panel UX turu
- Floating panel baslik aksiyonlari, z-index davranisi ve resize hissi gozden gecirilecek
- Dock preview rehberleri daha tutarli kontrast ve yerlesimle polish edilecek
- Floating panel keyboard focus ve active-panel iliskisi netlestirilecek
- Durum notu:
- Ilk tur tamamlandi
- Floating panel artik pointer ile odak alinca one geliyor ve aktif panel olarak isaretleniyor
- Floating panel aksiyon butonlari `aria-label` / `aria-pressed` ile daha net durum dili tasiyor
- Aktif floating panel icin ayri header ve border vurgusu eklendi; z-index davranisi gorsel olarak daha okunur hale geldi
- Ikinci tur tamamlandi
- Drag sirasinda dock guide ve dock preview kontrasti guclendirildi; hedef alanlar daha kolay okunuyor
- Floating resize sirasinda panel ve handle ayri bir aktiflik hissi aliyor; resize davranisi daha belirgin hale geldi
- Ucuncu tur tamamlandi
- Floating panel klavye odagi artik aktif panel durumuna baglaniyor; `focus-within` hissi ile keyboard navigation daha gorunur hale geldi
- Sonraki alt is: Window menu parity kontrolu yalnizca istersek ek bir polish olarak donebilir; Faz 2 kapanis kriterleri teknik olarak saglandi

6. Window menu ve layout komut parity kontrolu
- Window menu icindeki layout/dock komutlarinin disabled/available state’leri yeniden gozden gecirilecek
- Layout presets ile gercek runtime state arasinda fark olusuyorsa menu yansimasi duzeltilecek
- Saved layout slot checkmark mantigi dogrulanacak

7. Recovery ve self-healing turu
- Kayip host, bos tab order veya gecersiz floating panel state’lerinde otomatik toparlama eklenebilecek yerler notlanacak
- Layout system’in debug edilmesini kolaylastiran hafif status/dev hooks dusunulecek

Oncelik sirasi:

1. Dock/undock edge-case sertlestirme
2. Tab drag-drop ve reorder tutarliligi
3. Layout save/load dayanikliligi
4. Splitter ve clamp polish
5. Floating panel UX turu
6. Window menu parity kontrolu
7. Recovery/self-healing

Riskli noktalar:

- Faz 2 degisiklikleri Faz 1 chrome polish’ini ve Faz 4 scene workflow’unu dolayli bozabilir
- Tab host mantiginda yapilacak degisiklikler `Project/Console/Render` icerik mount akisini etkileyebilir
- Layout persistence formatina dokunulursa eski snapshot/preset davranisi kirilabilir

Session kapanis kriterleri:

- Docking/floating/tab reorder akislari beklenen hostlara deterministik donmeli
- Layout reset/save/load akislari bozuk state uretmemeli
- Splitter clamp davranisi minimum boyutlari korumali
- `verify_phase1_editor_chrome` ve build temiz gecmeli

Kapanis notu:

- Tamamlandi. Docking, floating, tab reorder, layout persistence, splitter/clamp ve floating UX sertlestirme turlari kapatildi.
- Son dogrulama:
- `node verify_phase2_layout_mock.cjs` -> `39/39`
- `node verify_phase1_editor_chrome.cjs` -> `41/41`
- `npm.cmd run build` -> basarili

Session sonunda calistirilacaklar:

- `node verify_phase1_editor_chrome.cjs`
- `node test_all_phases.cjs`
- `npm.cmd run build`

## Urun Tanimi

Engine Project su anda su urun kimligine sahiptir:

- `Three.js` tabanli editor viewport ve render omurgasi
- `cannon-es` tabanli fizik omurgasi
- Unity benzeri `GameObject/Component/Scene/Prefab` modeli
- Editor tarafinda hierarchy, inspector, project, console, render settings, layout/docking, gizmo ve play mode akislari
- Electron shell uzerinde dosya sistemi ve native dialog entegrasyonu

Bu nedenle projeyi anlarken iki urun katmani ayri dusunulmelidir:

1. Engine/editor parity katmani
2. Desktop app productization katmani

## Ana Mimari

Proje ana olarak bes katmana ayrilir:

1. Electron shell
2. Platform bridge katmani
3. Editor uygulamasi
4. Engine/runtime katmani
5. Verify ve build/tooling katmani

### 1. Electron Shell

Ana dosyalar:

- `electron/main.js`
- `electron/preload.js`

Sorumluluk:

- pencereyi yaratmak
- preload bridgeâ€™i enjekte etmek
- native dialog ve dosya sistemi IPC'lerini sunmak
- recent projects store'u `userData` altinda tutmak

Mevcut durum:

- preload kullanimi artik canonical
- sync file-system IPC hatti eklendi
- ama shell halen tam secure modda degil

Bugunku teknik not:

- `nodeIntegration: true`
- `contextIsolation: false`
- `webSecurity: false`

Yani Faz 9'un ana riski burada duruyor. Kod parityâ€™si yuksek ama shell security hala gecis modunda.

### 2. Platform Bridge Katmani

Ana dosyalar:

- `src/platform/DesktopBridge.ts`
- `src/platform/DesktopFileSystem.ts`
- `src/platform/PathUtils.ts`

Sorumluluk:

- renderer tarafinin Electron detaylarini dogrudan bilmesini engellemek
- editor ve engine koduna daha stabil API vermek
- ileride `nodeIntegration: false` gecisinde degisim alanini daraltmak

Katman mantigi:

- `DesktopBridge` async native islemler icin kullanilir
- `DesktopFileSystem` sync dosya sistemi ihtiyaclarini preload/main IPC ustunden verir
- `PathUtils` renderer-safe path yardimcisidir

Bu katman Faz 9'un merkezidir. Yeni gelistirme yaparken renderer icinde dogrudan Node/Electron kullanmak yerine once burada API acilmalidir.

### 3. Editor Uygulamasi

Ana giris:

- `src/main.ts`
- `src/editor/Editor.ts`

Editor tarafinin ana gorevleri:

- uygulama bootstrap
- viewport ve gizmo kurulumu
- scene/hierarchy/inspector/project pencereleri
- command history ve undo/redo
- menu, toolbar, play mode ve editor state

Onemli editor modulleri:

- `src/editor/Editor.ts`: editor orkestratoru
- `src/editor/HierarchyWindow.ts`: hierarchy UI ve secim akislar
- `src/editor/InspectorWindow.ts`: secim/asset inspector host'u
- `src/editor/EditorInspectors.ts`: component/property inspector cizimi
- `src/editor/ProjectWindow.ts`: asset browser, context menu, create/reimport/rename/delete akislar
- `src/editor/Command.ts` ve `src/editor/LifecycleCommands.ts`: undo/redo omurgasi
- `src/editor/EditorSettings.ts`: layout, panel, tab ve editor persistence

Editor veri akislarinin mantigi:

- secim editor merkezinde tutulur
- hierarchy ve inspector editor state'i ile senkron calisir
- command history her mutasyonda canonical yol olmaya calisir
- asset/project islemleri AssetDatabase + ProjectWindow + Prefab/Scene dosya yazimi etrafinda doner

### 4. Engine ve Runtime Katmani

Ana dosyalar:

- `src/engine/Scene.ts`
- `src/engine/SceneManager.ts`
- `src/engine/GameObject.ts`
- `src/engine/Component.ts`
- `src/engine/Serialization.ts`
- `src/engine/Prefab.ts`
- `src/engine/AssetDatabase.ts`
- `src/engine/AssetImporter.ts`
- `src/engine/PhysicsSystem.ts`
- `src/engine/Time.ts`
- `src/engine/CoroutineManager.ts`
- `src/engine/ProjectSettings.ts`

Runtime model:

- `GameObject` Unity benzeri temel entityâ€™dir
- `Component` davranis birimidir
- `Scene` canli runtime dunya nesnesidir
- `SceneManager` scene create/load/save akislarini yonetir
- `Serialization` scene ve prefab verisinin normalize edilmis canonical bicimidir
- `PrefabManager` prefab dosyalarini ve apply/revert akislarini yonetir

Onemli alt alanlar:

- Components: `src/engine/components`
- Script registry: `src/engine/ScriptRegistry.ts`
- Input: `src/engine/Input.ts`
- Layers/tags: `src/engine/LayerManager.ts`, `src/engine/TagManager.ts`

#### Render ve Scene Bilesenleri

Ornek ana componentler:

- `src/engine/components/Camera.ts`
- `src/engine/components/Light.ts`
- `src/engine/components/MeshRenderer.ts`
- `src/engine/Material.ts`

Bu alan Faz 8'de buyuk olcude kapanmistir. Kamera stack, clear flags, viewport, culling mask, material depth/write/order ve sorting taraflari mevcut.

#### Physics Katmani

Ana dosyalar:

- `src/engine/PhysicsSystem.ts`
- `src/engine/components/RigidBody.ts`
- collider bilesenleri: `BoxCollider`, `SphereCollider`, `CapsuleCollider`

Bu katman fixed-step, gravity, constraints, interpolation, CCD ve project settings senkronu destekler.

#### UI Katmani

Ana dosyalar:

- `src/engine/components/Canvas.ts`
- `src/engine/components/GraphicRaycaster.ts`
- `src/engine/components/EventSystem.ts`
- `src/engine/components/Selectable.ts`
- `UIButton`, `UIToggle`, `UISlider`, `UIScrollbar`, `UIScrollRect`, `UIInputField`, `UIDropdown`

Bu alan Faz 8 sonunda artik parity seviyesinde kullanilabilir durumdadir.

### 5. Verify ve Tooling Katmani

Ana dosyalar:

- `test_all_phases.cjs`
- `verify_phase8_ui_rendering.cjs`
- `verify_phase9_desktop_productization.cjs`
- `package.json`

Scripts:

- `npm run dev`: Vite + Electron dev
- `npm run build`: TypeScript + Vite build
- `npm run test:parity`: tum faz verify
- `npm run test:phase8`: Faz 8 verify
- `npm run test:phase9`: Faz 9 verify
- `npm run electron:build`: paketleme baslangic script'i

Verify felsefesi:

- Bu projede testlerin onemli bir kismi runtime UI testi degil, source-backed verify seklindedir.
- Yani belirli parity ve productization kapilari kaynak kodda beklenen omurganin varligini kontrol eder.
- Bu hizli iteration icin faydalidir ama tum runtime hatalarini tek basina garanti etmez.

## Klasor Haritasi

Yeni gelen bir gelistirici icin hizli klasor ozetleri:

- `electron/`
  Electron main process ve preload bridge
- `src/main.ts`
  uygulama bootstrap
- `src/editor/`
  editor UI, command history, layout, inspector, hierarchy, project window
- `src/engine/`
  runtime, scene, serialization, prefab, asset, physics, time
- `src/engine/components/`
  Unity benzeri component ailesi
- `src/platform/`
  renderer-main process abstraction
- `src/scripts/`
  ornek gameplay scriptleri
- `scripts/`
  dev automation yardimcilari
- `verify_phase*.cjs`
  parity/productization verify dosyalari

## Cekirdek Veri Modelleri

Projeyi gelistirirken en kritik modeller:

- `GameObject`
  scene agaci, component sahipligi, aktiflik, layer/tag/static durumu
- `Component`
  serialize/deserialize ve lifecycle tabani
- `Scene`
  canli object graph, update loop, physics/time entegrasyonu
- `Prefab`
  reusable template ve apply/revert ownership zinciri
- `AssetMeta`
  GUID, importer settings, labels, userData
- `ProjectSettings`
  time/physics/layer/tag/runtime kalite ayarlari
- `EditorSettings`
  layout, panel, tab, dock graph persistence

## Onemli Akislar

### Editor Baslatma Akisi

1. Electron pencereyi acar
2. Preload `window.electronAPI` enjekte eder
3. `src/main.ts` editor bootstrap baslatir
4. `src/editor/Editor.ts` scene, renderer, windows, project root, asset database ve layout state'i yukler

### Scene Kaydetme/Yukleme

1. Editor scene JSON uretir
2. `SceneManager` ve `DesktopBridge` uzerinden dosya sistemi yazimi okunur
3. Serialization normalize edilmis canonical form kullanir
4. Undo/redo snapshot hattiyla editor state korunur

### Asset Tarama

1. `ProjectWindow` ve `AssetDatabase` root path uzerinden tarama yapar
2. `.meta` ve GUID haritasi kurulur
3. importer settings ve dependency graph guncellenir
4. inspector/project gorunumu refresh edilir

### Prefab Akisi

1. `PrefabManager` GameObject serializesini alir
2. `.prefab` dosyasi ve meta/GUID asset database ile iliskilenir
3. instantiate/apply/revert ownership zinciri `Prefab.ts` icinde yonetilir
4. editor command history bu akislari snapshot veya command tabanli geri alabilir

## Mevcut Gucler

Projeyi devralan biri sunu bilsin:

- Editor parity tarafi zayif degil, artik oldukca genis
- UI kontrol ailesi beklenenden daha tam
- serialization/prefab/undo hattÄ± projenin en guclu kisimlarindan biri
- verify suiti disiplinli calistirildigi icin buyuk refactor once/sonra guvenli ilerlemek kolay

## Mevcut Teknik Borclar

Su an aktif ve gercek teknik borclar:

- Electron shell hala secure modda degil
- source-backed verify guclu ama tam e2e desktop regression suiti henuz yok
- bundle size warning devam ediyor
- packaging/release hattÄ± henuz olgun degil
- multi-window, crash recovery, autosave ve session restore taraflari eksik
- bazi eski dokumanlar tarihi referans niteliginde; canonical kaynak olarak roadmap + verify + closure raporlari esas alinmali

Ek not:

- `src/scripts/PlayerController.ts` icindeki non-physics fallback davranisi hala ornek/gameplay kalitesindedir; engine parity kaniti olarak gorulmemeli

## Faz Gecmisi

### Faz 1: Editor Chrome Parity

Tamamlandi. Menu, toolbar, panel chrome ve temel editor hissi oturtuldu.

### Faz 2: Layout ve Windowing

Tamamlandi. Docking, floating panel, tear-off ve layout persistence kapandi.

### Faz 3: Asset Pipeline

Tamamlandi. `.meta`, GUID, importer settings, reference repair ve prefab ownership altyapisi kuruldu.

### Faz 4: Scene ve GameObject Workflow

Tamamlandi. Selection, hierarchy reorder, create/duplicate/paste ve scene interaction parity geldi.

### Faz 5: Serialization Parity

Tamamlandi. Scene/prefab serialization, typed persistence, batch ref resolve ve non-destructive undo olgunlasti.

### Faz 6: Inspector Parity

Tamamlandi. Foldout state, add component, header actions, badges, search/filter ve inspector command davranislari oturdu.

### Faz 7: Runtime ve Play Mode

Tamamlandi. Play/pause/step, lifecycle, input, time, coroutine ve scene restore kapandi.

### Faz 8: Rendering, Physics, UI

Tamamlandi. Kamera, render, physics, UI controls, raycast, event system, layers/tags/project settings parity buyuk olcude kapandi.

### Faz 9: Desktop App Productization

Aktif faz budur.

Faz 9 ilerleme notlari:

- Electron bridge ilk kez canonical hale getirildi;
- Launcher/workspace tarafi desktop'a daha uygun hale getirildi;
- Desktop bridge katmani editor/runtime icine girmeye basladi;
- Faz 9 path migrasyonu baslatildi;
- Faz 9 fs migrasyonu da baslatildi;
- BuildSettingsWindow da bu migration kapsamina alindi;
- sync dosya sistemi IPC hatti preload/main process tarafina eklendi;
- DesktopFileSystem bridge-first hale getirildi;
- renderer tarafindaki `window.require` fallback'leri temizlendi;
- preload uzerinden `currentWorkingDirectory` bilgisi acildi;

Su ana kadar tamamlanan Faz 9 adimlari:

- preload tabanli canonical Electron bridge
- native recent projects store
- scene open/save icin desktop bridge
- path islemlerinin `PathUtils` altina alinmasi
- fs islemlerinin `DesktopFileSystem` altina alinmasi
- sync file-system IPC hattinin preload/main process tarafinda acilmasi
- `src` agacinda `window.require` fallback'lerinin temizlenmesi
- Faz 9 verify suiti ve ana parity runner entegrasyonu

Faz 9'da hala acik ana hedefler:

- `nodeIntegration: false`
- `contextIsolation: true`
- `webSecurity` politikalarini sertlestirme
- crash recovery / autosave / dirty close guard
- packaged app smoke testleri
- release ve installer hattinin olgunlastirilmasi

## Bir Sonraki Gelistirici Icin Onerilen Siralama

Bu projeyi devralan kisi icin en dogru ilerleme sirasi:

1. `npm run test:parity` calistir
2. `npm run build` calistir
3. `electron/main.js`, `electron/preload.js`, `src/platform/*` katmanini oku
4. `src/editor/Editor.ts`, `ProjectWindow.ts`, `InspectorWindow.ts` uzerinden editor akisini anla
5. `Scene.ts`, `SceneManager.ts`, `Serialization.ts`, `Prefab.ts` ile runtime-veri akisini anla
6. Sonra yalnizca Faz 9 hedefleri uzerinden ilerle

Pratik kural:

- Yeni desktop/native ihtiyac cikarsa once `preload` ve `main` tarafina API ekle
- sonra `DesktopBridge` veya `DesktopFileSystem` uzerinden renderer'a tasÄ±
- editor/engine kodu icinde dogrudan Electron veya Node bagimliligi acma

## Canonical Kaynaklar

Bu proje icin birincil dogruluk kaynaklari:

- bu roadmap
- `test_all_phases.cjs`
- `verify_phase8_ui_rendering.cjs`
- `verify_phase9_desktop_productization.cjs`
- `PHASE_8_CLOSURE_REPORT.md`

Eski faz raporlari tarihi baglam icin tutulabilir ama aktif karar verme icin bunlardan once yukaridaki kaynaklar kullanilmalidir.


