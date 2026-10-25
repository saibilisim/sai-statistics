# Uygulama Mimarisi — Tam Döküman

> 📌 **Bu dokümanın rolü:** Teknik mimari referansı — katmanların *nasıl* konuştuğu (süreç mimarisi, veri akışı, IPC kanalları). Stack/build kararlarında **[CLAUDE.md](../CLAUDE.md) tek doğruluk kaynağıdır**. Gerçek kod **TypeScript (`.ts`/`.tsx`, ESM)** ile yazılır (CLAUDE.md §2, §4); güncel klasör yapısı CLAUDE.md §4'tedir. *(2026-10-24 güncellemesi: klasör ağacı, R paket tablosu ve platform kaynakları, IPC seçkisi, R kurulum akışı ve build bölümü kod gerçeğine çekildi.)*

---

## 1. Genel Bakış

```
R motoru üzerine kurulu, platformlar arası masaüstü istatistik uygulaması
Electron + React + DuckDB + R
```

---

## 2. Klasör Yapısı

```
app/
├─ shared/                      ← Main + Renderer ortak TİPLER (tek doğruluk kaynağı)
│  ├─ ipc-contracts.ts          ← Tüm IPC kanalları + payload tipleri
│  ├─ ipc-schemas.ts            ← Kanal başına zod şemaları (handleValidated)
│  ├─ analysis-types.ts · data-types.ts · settings-types.ts
│  ├─ data-filter.ts            ← Select Cases ortak filtre tanımı (renderer+main parity)
│  ├─ r-packages.json           ← R paket listesi + R sürümü/Posit snapshot (tek kaynak)
│  └─ optional-packages.ts      ← r-packages.json'un tipli görünümü + kurulum allow-list'i
│
├─ electron/                    ← Main Process (TypeScript, ESM)
│  ├─ main.ts                   ← BrowserWindow + crash-recovery autosave
│  ├─ preload.ts                ← contextBridge → window.api
│  ├─ i18n.ts · menu/menu-builder.ts
│  └─ ipc/
│     ├─ file-handler/          ← .sdf/import/export/output-export (dataset-io, import-export, output-io …)
│     ├─ db-handler/            ← DuckDB (+weight/split/missing/decimals map'leri; transform-handlers.ts dahil)
│     ├─ analysis-handler.ts    ← generic analysis:run (enrichedParams enjeksiyonu)
│     ├─ r-bridge.ts · job-manager.ts ← R spawn + FIFO job kuyruğu
│     ├─ r-session.ts           ← kalıcı R konsolu (Terminal, ayrı şerit)
│     ├─ r-packages-handler.ts  ← ilk açılış R/paket kontrolü + kendi R'ını kullanan için kurulum
│     ├─ settings-handler.ts · undo-manager.ts · updater-handler.ts · ai-bridge/
│     └─ ...
│
├─ src/                         ← Renderer (React 19, TypeScript)
│  ├─ views/                    ← DataView/ (AG Grid) · VariableView/ (AG Grid) ·
│  │                              OutputView/ (saf HTML + Plotly) · NormalityView (4. sekme) ·
│  │                              TerminalView (5. sekme: SPSS Syntax | R)
│  ├─ components/               ← Toolbar/ TabBar/ StatusBar/ Dialogs/ (DialogBase…)
│  ├─ analyses/                 ← Dialog bileşenleri (AnalysisDialogShell + fieldDefs)
│  │  └─ _shared/               ← BootstrapSection, MissingValuesSection, PMethodSection…
│  ├─ lib/                      ← formula (hücre formülleri + Compute), spss-syntax (T1 dispatcher), output-format…
│  ├─ store/                    ← Zustand slice'ları (aşağıda §7)
│  ├─ i18n/locales/{tr,en}/     ← 4 namespace: common/menu/analysis/dialogs
│  └─ theme/                    ← tokens.ts · themes.ts · ThemeProvider
│
├─ r-scripts/                   ← 62 saf R script'i
│  ├─ _bootstrap.R              ← JSON I/O + Arrow + wtd_*/apply_user_missing/apply_listwise/
│  │                              get_split_groups/sai_bootstrap + dürüstlük bayrakları
│  ├─ _r_console.R              ← Terminal kalıcı REPL (sentinel protokol)
│  ├─ setup.R                   ← Zorunlu paket kontrol/kurulum
│  └─ <analysis>.R
│
├─ resources/                   ← icons/ · sample-data/ · settings/default-settings.json
├─ scripts/                     ← e2e-*.cjs (Playwright-Electron) + run-e2e.cjs
├─ tests/                       ← unit/ (Vitest) · r-validation/ (dep-free harness)
└─ electron-builder.json
```

---

## 3. Dosya Formatları

### Veri Dosyası → `.sdf` (Statistical Data File)

```
proje.sdf  (zip içeriği)
├─ data.parquet        ← veri (DuckDB ile yazılır)
├─ variables.json      ← variable metadata
├─ styles.json         ← hücre biçimlendirme (customStyles)
└─ metadata.json       ← format metadata (such as formatVersion)

metadata.json içeriği:
{
  "formatVersion": 1,
  "datasetId": "ds_1718102400000"
}

variables.json içeriği:
{
  "variables": [
    {
      "colId": "col_1",
      "name": "age",
      "label": "Katılımcı Yaşı",
      "type": "numeric",
      "width": 8,
      "decimals": 0,
      "valueLabels": {},
      "missing": null,
      "columns": 8,
      "align": "right",
      "measure": "scale",
      "role": "both"
    }
  ]
}
```

> ⚠️ **Güvenlik (Faz 1.5):** `.sdf` içeriği untrusted'dır — dosya dışarıdan gelmiş olabilir.
> `variables.json`/`styles.json`/`metadata.json` açılırken **zod ile doğrulanır**; `colId`
> `^col_\d+$` allow-list'inden geçirilir (bu değerler SQL projeksiyonuna girdiği için
> doğrulanmazsa injection vektörüdür). Zip extraction yalnızca beklenen dosyaları isimle
> çıkarır + boyut limiti uygular.

### Output → `.sdf` içinde `output.json`

Ayrı bir output dosya formatı yoktur (eski `.sof` 2026-09-29'da kaldırıldı). Output sekmesi
(bloklar + düzenleme overlay'i + sıra, `shared/output-document.ts` `OutputDocumentSchema`)
`.sdf` kaydedilirken `output.json` olarak arşive eklenir, açılırken zod ile doğrulanıp geri
yüklenir. Kapanış guard'ı veri ve Output değişikliğini tek "kaydet?" sorusunda birleştirir.

### Ayarlar → `settings.json`

Şemanın ve varsayılanların tek kaynağı `shared/settings-types.ts`'teki zod şemasıdır (her alanın
`.default(...)`'u); electron-store bunları çalışma anında uygular. Bölümler: `appearance` · `editor` ·
`dataImport` · `output` · `r` (`timeout`, `consoleEnabled`) · `recentFiles` · `startup` · `ai` ·
`shortcuts` · `update` · `ribbon`. Okunabilir örnek: `resources/settings/default-settings.json`
(uygulama okumaz, yalnız belge). Bir parçası:

```json
{
  "appearance": { "theme": "system", "fontSize": 13, "language": "tr" },
  "editor": { "missingValue": -99, "decimalSeparator": "comma" },
  "output": { "significanceLevel": 0.05, "tableStyle": "academic", "decimalSeparator": "dot" },
  "r": { "timeout": 120, "consoleEnabled": true },
  "recentFiles": []
}
```

VS Code gibi düz JSON, kullanıcı elle de düzenleyebilir.

---

## 4. Process Mimarisi

```
┌─────────────────────────────────────────────────────┐
│                    Electron App                      │
│                                                      │
│  ┌───────────────────┐      ┌─────────────────────┐  │
│  │  Renderer Process │      │    Main Process     │  │
│  │  (Chromium)       │      │    (Node.js)        │  │
│  │                   │      │                     │  │
│  │  React            │      │  File Handler       │  │
│  │  AG Grid (Data +  │◄────►│  DuckDB             │  │
│  │   Variable View)  │ IPC  │  R Bridge           │  │
│  │  Plotly           │      │  Job Manager        │  │
│  │  Zustand          │      │  Settings Manager   │  │
│  └───────────────────┘      └─────────────────────┘  │
│                                      │               │
│                              ┌───────▼──────┐        │
│                              │  R Process   │        │
│                              │  (child)     │        │
│                              └──────────────┘        │
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │  Local Disk                                   │   │
│  │  ├─ *.sdf          (veri dosyaları)           │   │
│  │  ├─ settings.json  (uygulama ayarları)        │   │
│  │  └─ temp/          (geçici Arrow/Parquet)     │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 5. Katmanlar ve Sorumluluklar

### Renderer Process

| Bileşen | Teknoloji | Görevi |
|---|---|---|
| Data View | AG Grid Community (+ kendi seçim/kopyala-yapıştır/fill handle/bul-değiştir katmanı, `src/lib/formula.ts` hücre formülleri) | Veri girişi ve düzenleme |
| Variable View | AG Grid Community | Değişken metadata editörü |
| Output View | **Saf HTML tablo** + Plotly | Analiz sonuçları (AG Grid yerine bilinçli tercih — CLAUDE.md §2) |
| Normality View | AG Grid + Plotly | 4. sekme — canlı normallik panosu |
| Terminal View | React (SPSS Syntax dispatcher / R konsolu) | 5. sekme |
| State | Zustand (zundo yalnız ui-store'da; **veri undo'su DB-snapshot**, main-process `undo-manager.ts`) | UI durumu |
| IPC Köprüsü | contextBridge | Main ile güvenli iletişim |

### Main Process

| Bileşen | Teknoloji | Görevi |
|---|---|---|
| File Handler | Node.js fs | .sdf açma/kaydetme (Output dahil) |
| DuckDB | `@duckdb/node-api` (Neo client) | Veri depolama ve sorgulama |
| R Bridge | child_process | R başlatma ve iletişim |
| Job Manager | Custom queue | Analiz sıralama ve iptal |
| Settings | electron-store | settings.json yönetimi |

### R Katmanı

> **Fiili durum (`shared/r-packages.json`):** analizlerin büyük çoğunluğu **base R** ile
> elle/formülle yazılmıştır (SPSS frekans-ağırlık semantiği ve Type III SS gibi konvansiyonlar için —
> gerekçe: CLAUDE.md §11). haven/dplyr/ggplot2/psych-ağırlıklı eski liste **kullanılmıyor**; .sav/.dta/.sas
> import R'sız, DuckDB `read_stat` extension ile yapılır. Grafikler elle kurulan Plotly JSON'dur.

**Bütün analiz paketleri paketlenmiş uygulamanın içindeki R'a gömülüdür** (`bundled`, 0.2.28'den
beri; talep-üzerine "opsiyonel" paket ve R Packages yöneticisi kaldırıldı, 2026-10-11). Kurulan
uygulama R için hiçbir paket indirmez, internet gerektirmez.

| Paket | Görevi |
|---|---|
| jsonlite · arrow | JSON I/O · Parquet okuma (`_bootstrap.R`) |
| psych · nortest | Faktör Analizi (KMO, Bartlett, Promax) · Lilliefors K-S (Normality View) |
| haven · ordinal | File > Export Data > SPSS (.sav) yazıcı · ordinal regresyon |
| MASS · boot · survival · nnet · nlme · class · rpart (R "recommended") | Diskriminant/M-tahminciler · Bootstrap CI · KM/Cox · multinom · lme · KNN · CRT ağacı |
| geepack · lme4 · mice · BayesFactor | GEE · GLMM · Çoklu atama · Bayes testleri |
| coin · randtests · mvtnorm · multcomp · pROC · agricolae · emmeans | exact/MC rank testleri · Runs · Dunnett/Tukey-Kramer olasılıkları · Dunnett post hoc · DeLong ROC · homojen alt kümeler · EM Means |
| ggplot2 · readxl · lubridate (`console`) | hiçbir analiz kullanmaz; R terminalinde ilk gün beklenen paketler |

**R kaynağı platforma göre:** Windows CRAN'in R 4.6.1'i + tarihli Posit Package Manager snapshot'ı
(`runtime.cranSnapshot`); Linux aynı R sürümünü conda-forge araç zinciriyle derler, paketleri aynı
snapshot'tan kaynaktan kurar. macOS da CRAN'in R 4.6.1'ini taşır (`vendor-r-runtime-mac-cran.sh`,
`vendor-r-runtime-mac.sh`'ın varsayılanı: CRAN `.pkg` açılır, Mach-O'lar `@rpath`'e taşınır, paketler
aynı snapshot'tan), işlemci başına ayrı runtime; `.github/workflows/macos-runtime.yml` arm64 ve Intel
runner'larında doğrular. Eski conda-forge R 4.3 yolu yalnız `SAI_R_VERSION=4.3` ile kalır.

Paketler `requireNamespace()` ile kapılı kalır: **kendi R'ını kullanan** (gömülü R'sız) kullanıcıda
bir paket eksikse script dürüst uyarı basar (`pMethodNotApplied` vb.) veya dialog kurulum önerir
(`PackageNeededDialog`). Kullanıcının kendi kurduğu paketler (R terminali → Packages paneli)
`~/R/library/<R sürümü>/`'ne gider.

---

## 6. Veri Akışı

### CSV/SPSS Dosyası Açma

```
Kullanıcı dosya seçer (Electron dialog)
         ↓
Main: File Handler dosyayı okur
         ↓
CSV ise  → DuckDB read_csv_auto()
SPSS ise → R haven::read_sav() → Arrow IPC → DuckDB
         ↓
DuckDB veriyi bellekte tutar
         ↓
Kolon tipleri + satırlar parça parça (data:get-chunk) Renderer'a gönderilir
         ↓
Zustand: columns, rowCount güncellenir
         ↓
AG Grid render eder (ilk parça gelince etkileşimli, kalanı arka planda)
```

### Analiz Çalıştırma

```
Kullanıcı "Normality Test" seçer
         ↓
Renderer: parametreler toplanır (kolon seçimi vs)
         ↓
IPC → Main: { type: "normality", params: { columns: ["age"] } }
         ↓
Job Manager kuyruğa ekler
         ↓
DuckDB → Arrow IPC → geçici .parquet yaz
         ↓
Rscript normality.R --args { parquet_path, params }
         ↓
R: oku → hesapla → JSON sonuç yaz
         ↓
Main: sonucu oku, geçici dosyayı sil
         ↓
IPC → Renderer: { tables, plotData }
         ↓
Zustand: results güncellenir
         ↓
Output View render eder
```

### Kaydetme

```
Kullanıcı "Kaydet" der
         ↓
Main: DuckDB → data.parquet yaz
Main: variables.json yaz
Main: Output sekmesi → output.json
Main: hepsini zip → proje.sdf
```

---

## 7. Zustand Store Yapısı (fiili — slice'lara bölünmüş)

Tek monolitik store yerine bağımsız slice'lar (`src/store/`):

| Slice | İçerik |
|---|---|
| `ui-store` | aktif sekme (`data/variable/output/normality/terminal`), tema, dil; zundo `temporal` yalnız burada |
| `dataset-store` | aktif dataset id, `variables[]`, rowCount, weight/split/filtre durumu |
| `settings-store` | settings.json aynası |
| `output-store` | Output blokları (`{tables, plots, warnings, notes}` sonuçları, job event aboneliğiyle dolar) |
| `normality-store` | Normality sekmesi sonuçları (dataset değişince stale) |
| `terminal-store` | Terminal: syntax/R modu, R konsol durumu, `rHistory`, `rPlots` |
| `grid-bridge-store` | Canlı AG Grid köprüleri (`gridApi`, hücre biçimi uygulama) — React state değil, imperative köprü |

Analiz dialog state'leri store'da değil, her Dialog bileşeninin kendi local state'indedir
(`AnalysisDialogShell` + `fieldDefs`); dialog kapanışında `window.api.analysis.run(...)` çağrılır.

---

## 8. IPC Kanalları

> **Tam ve güncel liste `shared/ipc-contracts.ts`'tedir** (2026-10-24'te ~140 kanal); aşağıdaki seçki
> kanalların *gruplarını* ve önemli olanları anlatır, eksiksiz değildir — AI (`ai:*`, `ai:account:*`),
> güncelleme (`updater:*`), tanılama (`diag:*`) ve birleştirme/yeniden yapılandırma (`data:merge-*`,
> `data:restructure-*`) kanalları için kaynağa bakın. Kod kanal adını hiçbir zaman string olarak
> yazmaz, sözleşmeden alır. `handleValidated(channel, zodSchema, fn)` her kanalı
> `shared/ipc-schemas.ts`'teki şemayla doğrular (CLAUDE.md §8).

```javascript
// Renderer → Main (invoke/handle)
"file:new"             → boş/dev veri seti oluştur
"file:open"            → .sdf aç (dialog veya doğrudan yol)
"file:save-data"       → .sdf kaydet
"file:save-data-as"    → .sdf farklı kaydet
"file:import"          → CSV/Excel/SPSS/Stata/SAS içe aktar
"file:export-csv"      → CSV export
"file:export-xlsx"     → Excel export
"file:export-sav"      → SPSS .sav export (satırlar geçici Parquet'e, r-scripts/export-sav.R
                          haven::write_sav ile yazar)
"file:save-output"     → Output sekmesini self-contained HTML olarak kaydet
"file:export-output-pdf" / "file:export-output-text" / "file:export-output-binary"
                       → Output → PDF (Electron printToPDF) / metin biçimleri (CSV, Markdown …) /
                          renderer'ın bayt olarak ürettiği yerel .docx/.xlsx

"data:get-all"         → tüm veriyi çek (sayfalama YOK, bkz. CLAUDE.md §12)
"data:get-filtered"    → aktif Select Cases filtresiyle veri çek
"data:get-split-groups"→ Split File değişkeninin grupları
"data:set-weight" / "data:set-split" → Weight Cases / Split File durumu (main-process kayıt;
                          analysis-handler her analysis:run'a weightVariable/splitVariable enjekte eder)
"data:sort-multi"      → çok-anahtarlı Sort Cases
"data:identify-duplicates" → Identify Duplicate Cases (ROW_NUMBER OVER PARTITION BY)
"data:update-cell" / "data:update-cells" (batch) → hücre güncelle
"data:insert-row" / "data:delete-rows" / "data:reorder-rows"
"data:insert-column" / "data:delete-column" / "data:sort"
"data:undo" / "data:redo"   → yapısal undo/redo (DB-snapshot; hücre değeri undo'su renderer'da `cell-value-undo.ts`)
"data:release-dataset" → renderer aktif veri setini değiştirdi: eskisinin tablosu/undo'su/kayıtları silinir
"data:set-custom-styles" → hücre biçimleri Main'e yansır (kurtarma dosyası + kirli bayrak)
"data:modified-changed" (Main → Renderer push) → kirli bayrak değişti (başlık `*`, Yeni/Aç koruması)

"variable:get-all" / "variable:update" / "variable:add" / "variable:delete" / "variable:delete-many" / "variable:reorder"

"transform:recode" / "transform:auto-recode" / "transform:count-values"
"transform:rank-cases" / "transform:replace-missing" / (shift-values, visual-binning vb. —
                          güncel liste ipc-contracts.ts)

"analysis:run"         → analiz başlat (job kuyruğuna ekler)
"analysis:cancel"      → analiz iptal

"r:check-packages" / "r:install-package"   → kendi R'ını kullanan için eksik analiz paketi kontrolü/kurulumu (allow-list)
"r:check-required-setup"                    → first-run R kurulum sihirbazı kontrolü

"settings:get" / "settings:set" / "settings:reset"

"dialog:confirm-unsaved" / "app:quit-after-save"   → kaydedilmemiş-değişiklik çıkış akışı

// Syntax & Terminal — 5. sekme (kararlar docs/roadmap/ara-calismalar.md §13; eski terminal.md)
// T1: SPSS Syntax dispatcher AYRI IPC istemez — mevcut analysis:run +
//     transform:* + variable:* kanallarını yeniden kullanır (renderer'da map'lenir).
// T2: kalıcı R oturumu (ayrı yürütme şeridi, job kuyruğundan bağımsız):
"terminal:r:start"        → R oturumunu başlat (salt-okunur `data` yükle)
"terminal:r:write"        → konsola komut gönder (seri); debugger beklerken browser() girdisi olur
"terminal:r:run"          → write + runId; bitince terminal:r:run-done (rapor çalıştırıcısı, T3 P2)
"terminal:r:restart"      → oturumu yeniden başlat
"terminal:r:kill"         → oturumu öldür
"terminal:r:interrupt"    → çalışan komutu kes (SIGINT); debugger beklerken onu durdurur (sai_abort restart'ı)
"terminal:r:reload-data"  → `data`'yı taze bir export'la değiştir
// T3 (R IDE panelleri):
"terminal:r:complete"     → R'ın kendi tamamlama motoru (yalnız oturum boştayken; yoksa boş liste)
"terminal:r:view-rows"    → View() ızgarasının bir sayfası (DuckDB temp tablo; sıralama sütunu allow-list)
"terminal:r:view-close"   → View() temp tablosunu bırak
"terminal:r:commit-resolve" → sai_commit() anlık görüntüsünü yeni veri seti olarak al / bırak
"terminal:r:plot-export"  → kaydedilmiş grafiği seçilen biçim/boyutta yeniden çiz (yolu Main seçer)
"terminal:r:pkgs-refresh" → kurulu paket listesini iste (yanıt terminal:r:pkgs)
"terminal:r:pkg-install"  → paketi kullanıcı kütüphanesine kur (konsol istisnası, allow-list'siz)

// Main → Renderer (send)
"job:progress"        → analiz ilerlemesi
"job:complete"        → analiz tamamlandı
"job:error"           → analiz hatası
"r:status"            → R algılama durumu: starting/ready/not-found
"terminal:r:output"   → R oturumu stdout/stderr akışı (T2)
"terminal:r:status"   → R oturumu durumu: starting/idle/busy/debug/dead (+ debugLevel; T2, debug T3 P2)
"terminal:r:plot"     → R terminalinde üretilen grafik (base64 PNG, T2.2)
"terminal:r:table"    → `sai_show(df)` ile Output'a terfi ettirilen tablo (T2.3)
"terminal:r:view"     → `View(df)` — DuckDB'ye yüklenmiş anlık görüntünün sütunları + satır sayısı (T3)
"terminal:r:help"     → `?konu` / F1 yardım sayfası (düz metin, T3)
"terminal:r:env"      → global ortamdaki nesneler (her komuttan sonra, Ortam paneli, T3); debugger
                        beklerken incelenen çerçevenin değişkenleri + çağrısı (`frame`)
"terminal:r:commit"   → sai_commit(df) — onay bekleyen yeni veri seti (ad, satır, sütun)
"terminal:r:pkgs"     → kurulu paketler (Paketler sekmesi)
"terminal:r:widget"   → yazdırılan htmlwidget'ın sai-widget:// adresi (Görüntüleyici sekmesi)
"terminal:r:run-done" → terminal:r:run komutu bitti {runId, ok} — invoke yanıtı değil push: komutun
                        kendi çıktısından SONRA gelmesi garanti (invoke yanıtı ile push'lar sırasız)
"app:save-and-quit"   → Main'den Renderer'a: kaydet-sonra-kapat akışını tetikle
```

> **Compute Variable'ın ayrı bir IPC kanalı yoktur:** `ComputeVariableDialog` ifadeyi renderer'da hücre formülleriyle aynı güvenli motorla (`src/lib/formula.ts`, `eval()` yok) değerlendirir, sonucu `variable:add` + `data:update-cells` ile yazar. Eskiden ayrılmış duran `data:filter` / `transform:compute` kanalları sözleşmeden kaldırıldı (filtre: ColumnFilterPopup + `shared/data-filter.ts`).

> **Terminal akışı (T2):** `terminal:r:start` → Main, DuckDB'yi Parquet'e export edip kalıcı `R` sürecine `data` olarak yükler (salt-okunur kopya). Her `terminal:r:write` sentinel'le (`__SAI_END__`/`__SAI_DONE__`) sınırlandırılır; çıktı `terminal:r:output` ile satır-satır akar. Bu süreç tek-atımlık analiz job kuyruğundan **ayrı bir şerittir** — birbirini bloklamaz, R hafızalarını paylaşmaz (mimari: eski terminal.md §12, roadmap.md'ye birleştirildi). `r.consoleEnabled` (settings.json) `false` ise `terminal:r:start` hata döner (CLAUDE.md §9 kural 1).

---

## 9. R Kurulum Akışı

```
Uygulama açılır (r-bridge.ts initRBridge)
         ↓
Gömülü R var mı? (paketli: resourcesPath/r-runtime;
                  geliştirmede: resources/r-runtime-win | r-runtime-mac | r-runtime)
         ↓ Evet
Rscript --version → r:status "ready"
Zorunlu paketler eksik mi? (r:check-required-setup)
  → Eksikse: kopya bozuk demektir — kullanıcıya sorulmadan
    kullanıcı kütüphanesine sessizce yeniden kurulur (r-packages-handler.ts)
         ↓
Arka planda: önceki R sürümünde kullanıcının kurduğu paketler
yeni sürüm klasörüne taşınır/yeniden kurulur (migrateUserRLibrary)

         ↓ Hayır (gömülü R yok — kaynaktan çalıştırma ya da vendor adımı atlanmış)
Sistemde Rscript var mı? (PATH)
  → Varsa kullan; eksik paket varsa SetupWelcomeDialog kurmayı önerir
  → Yoksa: r:status "not-found" → R kurulum yönergeli karşılama penceresi
```

---

## 10. Build ve Dağıtım

Yapılandırma: `app/electron-builder.json` (`appId` `com.sai.statistics`). Her platform kendi gömülü
R'ını `extraResources` ile `r-runtime/` olarak paketler (`resources/r-runtime-win` · `r-runtime-mac` ·
`r-runtime`; üretimi README → "Packaging installers").

| Platform | Hedefler | Not |
|---|---|---|
| Windows | NSIS (x64) | Otomatik güncelleme (electron-updater, imza doğrulamalı) yalnız burada |
| macOS | DMG + zip | Şimdilik imzasız (`identity: null`) |
| Linux | AppImage · deb · rpm (+ Flatpak, `app/flatpak/`) | Güncelleme paket yöneticisinden / Flathub'dan |

Electron fuse'ları (`electronFuses`): `runAsNode` kapalı, asar bütünlük doğrulaması açık, uygulama
yalnız asar'dan yüklenir.

---

## 11. Teknoloji Özet Tablosu

| Katman | Teknoloji | Neden |
|---|---|---|
| Desktop | Electron | Olgun, cross-platform, Node.js |
| UI Framework | React | Ekosistem, component modeli |
| Data View | AG Grid Community | 2026-07-20'de Univer'den geçildi: bundle ~15,2→~3,4 MB, 500K×20 yükleme ~190→~36,5 sn, yarış-durumu hata sınıfı kalktı, Variable View ile tek grid kütüphanesi; Excel özellikleri ve formül motoru (`formula.ts`) Community üzerine elle yazıldı (Enterprise kullanılmaz) |
| Variable View | AG Grid Community | Typed columns, dropdown (Enterprise özelliği kullanılmaz) |
| Output - Tablo | Saf HTML `<table>` | SPSS-stil biçim kontrolü kolay (bilinçli AG Grid'den vazgeçildi) |
| Output - Grafik | Plotly | R script'leri Plotly JSON'unu doğrudan kurar (ggplot2 analizlerde kullanılmaz) |
| State | Zustand (+zundo yalnız UI) | Hafif; veri undo'su DB-snapshot (main-process) |
| Ana Veri Deposu | DuckDB (Node) | Parquet/Arrow native, analitik hızlı |
| Veri Transferi | Arrow IPC | Tip kaybı yok, hızlı |
| Kalıcı Depolama | Parquet (.sdf içi) | Sıkıştırılmış, R native |
| İstatistik Motoru | R (child_process) | SPSS düzeyi analiz |
| Ayarlar | JSON (electron-store) | VS Code gibi, şeffaf |
| Build | Electron Builder | Cross-platform paketleme |
