// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: full application-menu coverage (File/Edit/View/Data/Transform/Analyze/
 * Graphs/Utilities/Help). Walks the native menu via Menu.getApplicationMenu(),
 * clicks every leaf item, and verifies the expected effect:
 *   - channel  : the menu:... IPC channel reached the renderer (window.__menuLog)
 *   - dialog   : a [role="dialog"] became visible, then closed via Escape
 *   - tab      : ui-store activeTab actually switched
 *   - toggle   : a ui-store flag flipped (and is flipped back afterwards)
 *   - theme    : documentElement[data-theme] changed (restored afterwards)
 *   - language : menu rebuilt in the other language (restored afterwards)
 *   - print    : webContents.print was called (stubbed recorder in main)
 *   - doc      : shell.openPath was called with a path that exists on disk
 *   - devtools : webContents.isDevToolsOpened() flipped (toggled back)
 *   - role     : presence/enabled/role only (OS-driven editing roles)
 *   - disabled : intentionally enabled:false in menu-builder.ts
 *   - skip     : File ▸ Exit (would quit the app) — presence only
 *
 * Native file dialogs are stubbed canceled in the main process so nothing
 * blocks headless. Dataset-mutating dialogs are opened and cancelled only.
 *
 * Prerequisites: `pnpm build` (spawns out/main/main.cjs), xvfb-run on headless
 * Linux. Exits non-zero if any item FAILs. */
const fs = require('fs')
const { _electron } = require('@playwright/test')

const FIXTURE = '/tmp/sai-menu-coverage.csv'

function writeFixture() {
  const rows = ['id,age,score,income,group,gender,city']
  const cities = ['Ankara', 'Istanbul', 'Izmir', 'Bursa']
  for (let i = 1; i <= 40; i++) {
    rows.push(
      [
        i,
        20 + (i % 45),
        50 + ((i * 7) % 50) + (i % 3) * 0.5,
        3000 + ((i * 137) % 4000),
        (i % 2) + 1,
        i % 2 ? 'E' : 'K',
        cities[i % cities.length]
      ].join(',')
    )
  }
  fs.writeFileSync(FIXTURE, rows.join('\n'))
}

// ── Test plan ──────────────────────────────────────────────────────────────
// Mirrors menu-builder.ts template order exactly (separators included in the
// index paths). kind legend:
//   channel        channel must arrive (native-dialog flows, stubbed canceled)
//   dialog         channel + [role=dialog] opens
//   tab:<id>       channel + activeTab switch
//   toggle:<key>   channel + ui-store flag flip (flipped back after)
//   theme          data-theme attribute changes
//   language       menu rebuilds in another language
//   print          main-side print recorder fires
//   doc:<file>     shell.openPath recorder + file exists on disk
//   devtools       isDevToolsOpened flips
//   role:<role>    presence/role/enabled only
//   disabled       enabled:false by design
//   skip:<reason>  presence only, not clicked
//   newDataset     channel + datasetId changes, fixture reloaded afterwards
//   recent         Recent Files submenu structure check
//   selectCases    channel + activeTab=data + showColumnFilterIcons=true
const P = (path, name, kind, extra = {}) => ({ path, name, kind, ...extra })

const PLAN = [
  P('0/0', 'Dosya > Yeni Veri Seti', 'newDataset', { ch: 'menu:file:new', defer: true }),
  P('0/1', 'Dosya > Veri Dosyası Aç', 'channel', { ch: 'menu:file:open' }),
  P('0/2', 'Dosya > Son Dosyalar', 'recent'),
  P('0/4', 'Dosya > Kaydet', 'channel', { ch: 'menu:file:save' }),
  P('0/5', 'Dosya > Farklı Kaydet', 'channel', { ch: 'menu:file:save-as' }),
  P('0/6', 'Dosya > Çıktıyı Kaydet', 'channel', { ch: 'menu:file:save-output' }),
  P('0/7', 'Dosya > Çıktıyı Dışa Aktar', 'dialog', { ch: 'menu:file:export-output' }),
  P('0/9/0', 'Dosya > Veri İçe Aktar > CSV', 'channel', { ch: 'menu:file:import:csv' }),
  P('0/9/1', 'Dosya > Veri İçe Aktar > Excel', 'channel', { ch: 'menu:file:import:excel' }),
  P('0/9/2', 'Dosya > Veri İçe Aktar > SPSS', 'channel', { ch: 'menu:file:import:spss' }),
  P('0/9/3', 'Dosya > Veri İçe Aktar > Stata', 'channel', { ch: 'menu:file:import:stata' }),
  P('0/9/4', 'Dosya > Veri İçe Aktar > SAS', 'channel', { ch: 'menu:file:import:sas' }),
  P('0/10/0', 'Dosya > Veri Dışa Aktar > CSV', 'channel', { ch: 'menu:file:export:csv' }),
  P('0/10/1', 'Dosya > Veri Dışa Aktar > Excel', 'channel', { ch: 'menu:file:export:excel' }),
  P('0/10/2', 'Dosya > Veri Dışa Aktar > SPSS', 'channel', { ch: 'menu:file:export:spss' }),
  P('0/12', 'Dosya > Yazdır', 'print'),
  P('0/14', 'Dosya > Çıkış', 'skip', {
    reason: 'uygulamayı kapatır — sadece varlık/kısayol doğrulandı'
  }),

  // Deliberately NOT Electron's role:'undo'/'redo' — that binds to Chromium's
  // document-undo, which only touches a focused text input and never the
  // app's own undo chain (see the comment at menu-builder.ts's Edit menu).
  // They dispatch our own IPC channels instead.
  P('1/0', 'Düzen > Geri Al', 'channel', { ch: 'menu:edit:undo' }),
  P('1/1', 'Düzen > Yinele', 'channel', { ch: 'menu:edit:redo' }),
  P('1/3', 'Düzen > Kes', 'role', { role: 'cut' }),
  P('1/4', 'Düzen > Kopyala', 'role', { role: 'copy' }),
  P('1/5', 'Düzen > Yapıştır', 'role', { role: 'paste' }),
  P('1/7', 'Düzen > Bul', 'findbar', { ch: 'menu:edit:find' }),
  P('1/8', 'Düzen > Bul ve Değiştir', 'findbar', { ch: 'menu:edit:find-replace' }),
  P('1/10', 'Düzen > Tercihler', 'dialog', { ch: 'menu:preferences' }),

  P('2/0', 'Görünüm > Veri Görünümü', 'tab', { ch: 'menu:view:tab', tab: 'data' }),
  P('2/1', 'Görünüm > Değişken Görünümü', 'tab', { ch: 'menu:view:tab', tab: 'variable' }),
  P('2/2', 'Görünüm > Çıktı Görünümü', 'tab', { ch: 'menu:view:tab', tab: 'output' }),
  P('2/3', 'Görünüm > Normallik Görünümü', 'tab', { ch: 'menu:view:tab', tab: 'normality' }),
  P('2/4', 'Görünüm > Terminal Görünümü', 'tab', { ch: 'menu:view:tab', tab: 'terminal' }),
  P('2/6', 'Görünüm > Değer Etiketleri', 'toggle', {
    ch: 'menu:view:value-labels',
    flag: 'showValueLabels'
  }),
  P('2/7', 'Görünüm > Izgara Çizgileri', 'toggle', {
    ch: 'menu:view:grid-lines',
    flag: 'showGridLines'
  }),
  P('2/8', 'Görünüm > Odak Hücresi', 'toggle', {
    ch: 'menu:view:focus-cell',
    flag: 'focusCellHighlight'
  }),
  P('2/10', 'Görünüm > Tema', 'theme'),
  P('2/11', 'Görünüm > Dil', 'language'),
  P('2/13', 'Görünüm > Geliştirici Araçları', 'devtools'),

  P('3/0', 'Veri > Satırları Sırala', 'dialog', { ch: 'menu:data:sort-cases' }),
  P('3/1', 'Veri > Değişkenleri Sırala', 'dialog', { ch: 'menu:data:sort-variables' }),
  P('3/2', 'Veri > Yinelenenleri Belirle', 'dialog', { ch: 'menu:data:identify-duplicates' }),
  P('3/4', 'Veri > Satır Seç', 'selectCases', { ch: 'menu:data:select-cases' }),
  P('3/5', 'Veri > Ağırlıklandır', 'dialog', { ch: 'menu:data:weight-cases' }),
  P('3/6', 'Veri > Dosyayı Böl', 'dialog', { ch: 'menu:data:split-file' }),
  P('3/8', 'Veri > Toplulaştır', 'dialog', { ch: 'menu:data:aggregate' }),
  P('3/9', 'Veri > Transpoze', 'dialog', { ch: 'menu:data:transpose' }),
  P('3/10', 'Veri > Yeniden Yapılandır', 'dialog', { ch: 'menu:data:restructure' }),
  P('3/11', 'Veri > Değişken Özellikleri Tanımla', 'dialog', { ch: 'menu:data:define-var-props' }),
  P('3/13/0', 'Veri > Dosya Birleştir > Satır Ekle', 'dialog', { ch: 'menu:data:merge-add-cases' }),
  P('3/13/1', 'Veri > Dosya Birleştir > Değişken Ekle', 'dialog', {
    ch: 'menu:data:merge-add-variables'
  }),

  P('4/0', 'Dönüştür > Değişken Hesapla', 'dialog', { ch: 'menu:transform:compute' }),
  P('4/2', 'Dönüştür > Aynıya Yeniden Kodla', 'dialog', { ch: 'menu:transform:recode-same' }),
  P('4/3', 'Dönüştür > Farklıya Yeniden Kodla', 'dialog', {
    ch: 'menu:transform:recode-different'
  }),
  P('4/4', 'Dönüştür > Otomatik Yeniden Kodla', 'dialog', { ch: 'menu:transform:auto-recode' }),
  P('4/6', 'Dönüştür > Değer Sayımları', 'dialog', { ch: 'menu:transform:count-values' }),
  P('4/7', 'Dönüştür > Sıra Numarası', 'dialog', { ch: 'menu:transform:rank-cases' }),
  P('4/8', 'Dönüştür > Görsel Gruplama', 'dialog', { ch: 'menu:transform:visual-binning' }),
  P('4/9', 'Dönüştür > Değer Kaydır', 'dialog', { ch: 'menu:transform:shift-values' }),
  P('4/11', 'Dönüştür > Kayıp Değer Değiştir', 'dialog', { ch: 'menu:transform:replace-missing' }),

  P('5/0/0', 'Analiz > Raporlar > Satır Özetleri', 'dialog', { ch: 'menu:analyze:case-summaries' }),
  P('5/0/1', 'Analiz > Raporlar > OLAP Küpleri', 'dialog', { ch: 'menu:analyze:olap-cubes' }),
  P('5/0/2', 'Analiz > Raporlar > Rapor Özetleri', 'dialog', {
    ch: 'menu:analyze:report-summaries'
  }),
  P('5/0/3', 'Analiz > Raporlar > Sütunlarda Rapor Özetleri', 'dialog', {
    ch: 'menu:analyze:report-columns'
  }),
  P('5/1/0', 'Analiz > Tanımlayıcı İstatistikler > Frekanslar', 'dialog', {
    ch: 'menu:analyze:frequencies'
  }),
  P('5/1/1', 'Analiz > Tanımlayıcı İstatistikler > Tanımlayıcılar', 'dialog', {
    ch: 'menu:analyze:descriptives'
  }),
  P('5/1/2', 'Analiz > Tanımlayıcı İstatistikler > Keşif', 'dialog', {
    ch: 'menu:analyze:explore'
  }),
  P('5/1/3', 'Analiz > Tanımlayıcı İstatistikler > Çapraz Tablolar', 'dialog', {
    ch: 'menu:analyze:crosstabs'
  }),
  P('5/1/4', 'Analiz > Tanımlayıcı İstatistikler > Oran', 'dialog', { ch: 'menu:analyze:ratio' }),
  P('5/2/0', 'Analiz > Ortalama Karşılaştır > Ortalamalar', 'dialog', { ch: 'menu:analyze:means' }),
  P('5/2/1', 'Analiz > Ortalama Karşılaştır > Tek Örneklem t', 'dialog', {
    ch: 'menu:analyze:onesample-ttest'
  }),
  P('5/2/2', 'Analiz > Ortalama Karşılaştır > Bağımsız t', 'dialog', {
    ch: 'menu:analyze:independent-ttest'
  }),
  P('5/2/3', 'Analiz > Ortalama Karşılaştır > Eşleştirilmiş t', 'dialog', {
    ch: 'menu:analyze:paired-ttest'
  }),
  P('5/2/4', 'Analiz > Ortalama Karşılaştır > Tek Yönlü ANOVA', 'dialog', {
    ch: 'menu:analyze:oneway-anova'
  }),
  P('5/2/6', 'Analiz > Ortalama Karşılaştır > Tek Örneklem Oran', 'dialog', {
    ch: 'menu:analyze:proportions-one'
  }),
  P('5/2/7', 'Analiz > Ortalama Karşılaştır > Bağımsız Oranlar', 'dialog', {
    ch: 'menu:analyze:proportions-independent'
  }),
  P('5/2/8', 'Analiz > Ortalama Karşılaştır > Eşleştirilmiş Oranlar', 'dialog', {
    ch: 'menu:analyze:proportions-paired'
  }),
  P('5/3/0', 'Analiz > Genel Doğrusal Model > Tek Değişkenli', 'dialog', {
    ch: 'menu:analyze:glm-univariate'
  }),
  P('5/3/1', 'Analiz > Genel Doğrusal Model > Çok Değişkenli', 'dialog', {
    ch: 'menu:analyze:glm-multivariate'
  }),
  P('5/3/2', 'Analiz > Genel Doğrusal Model > Tekrarlı Ölçüm', 'dialog', {
    ch: 'menu:analyze:glm-repeated'
  }),
  P('5/4/0', 'Analiz > Karma Modeller > Doğrusal', 'dialog', { ch: 'menu:analyze:mixed-models' }),
  P('5/4/1', 'Analiz > Karma Modeller > Genelleştirilmiş', 'dialog', { ch: 'menu:analyze:glmm' }),
  P('5/5/0', 'Analiz > Genelleştirilmiş Doğrusal > GenLin', 'dialog', {
    ch: 'menu:analyze:genlin'
  }),
  P('5/5/1', 'Analiz > Genelleştirilmiş Doğrusal > GEE', 'dialog', { ch: 'menu:analyze:gee' }),
  P('5/6/0', 'Analiz > Sınıflandır > K-Ortalamalar', 'dialog', { ch: 'menu:analyze:kmeans' }),
  P('5/6/1', 'Analiz > Sınıflandır > Hiyerarşik Kümeleme', 'dialog', {
    ch: 'menu:analyze:hierarchical'
  }),
  P('5/6/2', 'Analiz > Sınıflandır > Diskriminant', 'dialog', { ch: 'menu:analyze:discriminant' }),
  P('5/6/3', 'Analiz > Sınıflandır > K-En Yakın Komşu', 'dialog', { ch: 'menu:analyze:knn' }),
  P('5/6/4', 'Analiz > Sınıflandır > Karar Ağacı', 'dialog', { ch: 'menu:analyze:tree' }),
  P('5/6/5', 'Analiz > Sınıflandır > ROC Eğrisi', 'dialog', { ch: 'menu:analyze:roc' }),
  P('5/6/6', 'Analiz > Sınıflandır > ROC Analizi', 'dialog', { ch: 'menu:analyze:roc-analysis' }),
  P('5/7/0', 'Analiz > Boyut İndirgeme > Faktör Analizi', 'dialog', { ch: 'menu:analyze:factor' }),
  P('5/8/0', 'Analiz > Korelasyon > İki Değişkenli', 'dialog', {
    ch: 'menu:analyze:correlate-bivariate'
  }),
  P('5/8/1', 'Analiz > Korelasyon > Kısmi', 'dialog', { ch: 'menu:analyze:correlate-partial' }),
  P('5/8/2', 'Analiz > Korelasyon > Uzaklıklar', 'dialog', { ch: 'menu:analyze:distances' }),
  P('5/9/0', 'Analiz > Regresyon > Doğrusal', 'dialog', { ch: 'menu:analyze:regression-linear' }),
  P('5/9/1', 'Analiz > Regresyon > İkili Lojistik', 'dialog', {
    ch: 'menu:analyze:regression-logistic'
  }),
  P('5/9/2', 'Analiz > Regresyon > Eğri Uydurma', 'dialog', {
    ch: 'menu:analyze:regression-curve'
  }),
  P('5/9/3', 'Analiz > Regresyon > Multinominal Lojistik', 'dialog', {
    ch: 'menu:analyze:regression-multinomial'
  }),
  P('5/9/4', 'Analiz > Regresyon > Ordinal', 'dialog', { ch: 'menu:analyze:regression-ordinal' }),
  P('5/9/5', 'Analiz > Regresyon > Probit', 'dialog', { ch: 'menu:analyze:regression-probit' }),
  P('5/10/0', 'Analiz > Nonparametrik > 2 Bağımsız Örneklem', 'dialog', {
    ch: 'menu:analyze:npar-2indep'
  }),
  P('5/10/1', 'Analiz > Nonparametrik > K Bağımsız Örneklem', 'dialog', {
    ch: 'menu:analyze:npar-kindep'
  }),
  P('5/10/2', 'Analiz > Nonparametrik > 2 İlişkili Örneklem', 'dialog', {
    ch: 'menu:analyze:npar-2related'
  }),
  P('5/10/3', 'Analiz > Nonparametrik > K İlişkili Örneklem', 'dialog', {
    ch: 'menu:analyze:npar-krelated'
  }),
  P('5/10/5', 'Analiz > Nonparametrik > Ki-Kare', 'dialog', { ch: 'menu:analyze:npar-chisquare' }),
  P('5/10/6', 'Analiz > Nonparametrik > Binom', 'dialog', { ch: 'menu:analyze:npar-binomial' }),
  P('5/10/7', 'Analiz > Nonparametrik > Runs', 'dialog', { ch: 'menu:analyze:npar-runs' }),
  P('5/10/8', 'Analiz > Nonparametrik > Kolmogorov-Smirnov', 'dialog', {
    ch: 'menu:analyze:npar-ks'
  }),
  P('5/11/0', 'Analiz > Sağkalım > Kaplan-Meier', 'dialog', { ch: 'menu:analyze:survival-km' }),
  P('5/11/1', 'Analiz > Sağkalım > Cox Regresyon', 'dialog', { ch: 'menu:analyze:survival-cox' }),
  P('5/11/2', 'Analiz > Sağkalım > Yaşam Tabloları', 'dialog', { ch: 'menu:analyze:life-tables' }),
  P('5/12/0', 'Analiz > Ölçek > Güvenirlik Analizi', 'dialog', { ch: 'menu:analyze:reliability' }),
  P('5/12/1', 'Analiz > Ölçek > Çok Boyutlu Ölçekleme', 'dialog', { ch: 'menu:analyze:mds' }),
  P('5/13/0', 'Analiz > Bayesci > Tek Örneklem t', 'dialog', {
    ch: 'menu:analyze:bayes-ttest-onesample'
  }),
  P('5/13/1', 'Analiz > Bayesci > Bağımsız t', 'dialog', {
    ch: 'menu:analyze:bayes-ttest-independent'
  }),
  P('5/13/2', 'Analiz > Bayesci > Eşleştirilmiş t', 'dialog', {
    ch: 'menu:analyze:bayes-ttest-paired'
  }),
  P('5/13/3', 'Analiz > Bayesci > ANOVA', 'dialog', { ch: 'menu:analyze:bayes-anova' }),
  P('5/13/4', 'Analiz > Bayesci > Regresyon', 'dialog', { ch: 'menu:analyze:bayes-regression' }),
  P('5/13/5', 'Analiz > Bayesci > Korelasyon', 'dialog', { ch: 'menu:analyze:bayes-correlation' }),
  P('5/14', 'Analiz > Çoklu Yanıt', 'dialog', { ch: 'menu:analyze:multiple-response' }),
  P('5/15', 'Analiz > Kayıp Değerler', 'dialog', { ch: 'menu:analyze:missing-values' }),
  P('5/16', 'Analiz > Çoklu Atama', 'dialog', { ch: 'menu:analyze:mi' }),
  P('5/17', 'Analiz > Güç Analizi', 'dialog', { ch: 'menu:analyze:power' }),

  P('6/0', 'Grafikler > Grafik Oluşturucu', 'disabled'),
  P('6/2', 'Grafikler > Saçılım', 'dialog', { ch: 'menu:graphs:scatter' }),
  P('6/3', 'Grafikler > Çubuk', 'dialog', { ch: 'menu:graphs:bar' }),
  P('6/4', 'Grafikler > Çizgi', 'dialog', { ch: 'menu:graphs:line' }),
  P('6/5', 'Grafikler > Histogram', 'dialog', { ch: 'menu:graphs:histogram' }),
  P('6/6', 'Grafikler > Kutu', 'dialog', { ch: 'menu:graphs:boxplot' }),
  P('6/7', 'Grafikler > P-P Grafiği', 'dialog', { ch: 'menu:graphs:pp' }),
  P('6/8', 'Grafikler > Q-Q Grafiği', 'dialog', { ch: 'menu:graphs:qq' }),

  P('7/0', 'Araçlar > R Konsolu', 'tab', { ch: 'menu:view:tab', tab: 'terminal' }),
  P('7/1', 'Araçlar > Ayarlar', 'dialog', { ch: 'menu:preferences' }),

  P('8/0', 'Yardım > Kullanıcı Kılavuzu', 'doc', { file: 'user-guide.html' }),
  P('8/1', 'Yardım > İstatistik Rehberi', 'doc', { file: 'statistics-guide.html' }),
  P('8/2', 'Yardım > Klavye Kısayolları', 'dialog', { ch: 'menu:edit:toggle-shortcuts' }),
  // UPDATER_ENABLED (updater-handler.ts): auto-update runs on Windows only. Linux
  // (package manager / Flathub update it) and macOS (unsigned) are greyed out by
  // design. Not clicked — a manual check would reach the network.
  process.platform === 'win32'
    ? P('8/4', 'Yardım > Güncellemeleri Denetle', 'skip', {
        reason: "Windows'ta etkin (UPDATER_ENABLED); tıklanmaz, ağa çıkar"
      })
    : P('8/4', 'Yardım > Güncellemeleri Denetle', 'disabled'),
  P('8/5', 'Yardım > Hata Bildir', 'dialog', { ch: 'menu:help:report-issue' }),
  P('8/7', 'Yardım > Hakkında', 'dialog', { ch: 'menu:about' })
]

async function main() {
  writeFixture()

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', err => pageErrors.push(err.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // Stub every native dialog / shell / print path in the main process so
  // nothing blocks headless; recorders live on globalThis for later reads.
  await app.evaluate(({ dialog, shell, BrowserWindow }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined })
    dialog.showMessageBoxSync = () => 1 // "Discard" for unsaved-changes confirms
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    globalThis.__openedPaths = []
    shell.openPath = async p => {
      globalThis.__openedPaths.push(p)
      return ''
    }
    const bw = BrowserWindow.getAllWindows()[0]
    globalThis.__printCalls = 0
    bw.webContents.print = () => {
      globalThis.__printCalls++
    }
  })

  // Renderer-side channel log — proves menu → IPC → renderer wiring.
  await win.evaluate(() => {
    window.__menuLog = []
    window.api.on.menuCommand((ch, ...args) => window.__menuLog.push({ ch, args }))
  })

  // Load the fixture dataset (same pattern as e2e-special-menu.cjs).
  const loadFixture = async () => {
    await win.evaluate(async file => {
      const api = window.api
      const result = await api.file.import({ filePath: file })
      window.__SAI_TEST__.useDatasetStore
        .getState()
        .setDataset(
          result.dataset.id,
          result.dataset.name,
          result.dataset.filePath,
          result.variables,
          result.dataset.rowCount,
          result.styles
        )
      window.__SAI_TEST__.useUIStore.getState().setActiveTab('data')
    }, FIXTURE)
    await win.waitForTimeout(1200)
  }
  await loadFixture()

  // Snapshot original settings so theme/language can be restored.
  const origSettings = await win.evaluate(() => window.api.settings.get())
  const origLang = origSettings?.appearance?.language ?? 'tr'
  const origTheme = origSettings?.appearance?.theme ?? 'system'

  // ── Menu helpers (main process) ──────────────────────────────────────────
  const getItem = path =>
    app.evaluate(({ Menu }, p) => {
      const idx = p.split('/').map(Number)
      let items = Menu.getApplicationMenu().items
      let item = null
      for (const i of idx) {
        item = items[i]
        if (!item) return null
        items = item.submenu ? item.submenu.items : []
      }
      return {
        label: item.label ?? '',
        enabled: item.enabled,
        role: item.role ?? null,
        accelerator: item.accelerator ?? null,
        hasSubmenu: !!item.submenu
      }
    }, path)

  const clickPath = path =>
    app.evaluate(({ Menu }, p) => {
      const idx = p.split('/').map(Number)
      let items = Menu.getApplicationMenu().items
      let item = null
      for (const i of idx) {
        item = items[i]
        if (!item) throw new Error('menu item yok: ' + p)
        items = item.submenu ? item.submenu.items : []
      }
      item.click()
    }, path)

  const topLabels = () =>
    app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(i => i.label))

  // ── Renderer helpers ─────────────────────────────────────────────────────
  const menuLogLen = () => win.evaluate(() => window.__menuLog.length)
  const sawChannel = async (ch, since, timeout = 2500) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const found = await win.evaluate(
        ([c, s]) => window.__menuLog.slice(s).some(e => e.ch === c),
        [ch, since]
      )
      if (found) return true
      await win.waitForTimeout(120)
    }
    return false
  }
  const dialogVisible = () =>
    win
      .locator('[role="dialog"]')
      .first()
      .isVisible()
      .catch(() => false)
  const waitDialog = async (timeout = 5000) => {
    try {
      await win.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout })
      return true
    } catch {
      return false
    }
  }
  const closeDialogs = async () => {
    for (let i = 0; i < 4; i++) {
      if (!(await dialogVisible())) return true
      await win.keyboard.press('Escape')
      await win.waitForTimeout(400)
    }
    if (await dialogVisible()) {
      // Last resort: a visible Cancel/İptal button (never OK/Tamam).
      const cancel = win
        .locator('[role="dialog"] button')
        .filter({ hasText: /^(İptal|Cancel|Kapat|Close)$/ })
        .first()
      if (await cancel.count()) {
        await cancel.click().catch(() => {})
        await win.waitForTimeout(400)
      }
    }
    return !(await dialogVisible())
  }
  const uiState = key => win.evaluate(k => window.__SAI_TEST__.useUIStore.getState()[k], key)
  const datasetId = () =>
    win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)

  // ── Full menu inventory (part of the report) ─────────────────────────────
  const inventory = await app.evaluate(({ Menu }) => {
    const walk = (items, prefix) =>
      items.flatMap((it, i) => {
        const path = prefix ? `${prefix}/${i}` : String(i)
        const rec = {
          path,
          label: it.label || `<${it.type}>`,
          type: it.type,
          enabled: it.enabled,
          role: it.role || null,
          accelerator: it.accelerator || null
        }
        return it.submenu ? [rec, ...walk(it.submenu.items, path)] : [rec]
      })
    return walk(Menu.getApplicationMenu().items, '')
  })
  console.log(`MENU_INVENTORY:${JSON.stringify(inventory)}`)

  const results = []
  const record = (item, status, note = '') => {
    results.push({ name: item.name, path: item.path, status, note })
    console.log(`${status.padEnd(18)} ${item.name}${note ? ' — ' + note : ''}`)
  }

  // ── Item runners ─────────────────────────────────────────────────────────
  async function runChannel(item) {
    const since = await menuLogLen()
    await clickPath(item.path)
    if (await sawChannel(item.ch, since)) record(item, 'PASS', `kanal alındı: ${item.ch}`)
    else record(item, 'FAIL', `kanal gelmedi: ${item.ch}`)
  }

  async function runDialog(item) {
    const since = await menuLogLen()
    await clickPath(item.path)
    const chOk = await sawChannel(item.ch, since)
    const dlgOk = await waitDialog()
    if (chOk && dlgOk) record(item, 'PASS', 'kanal + diyalog açıldı')
    else if (chOk && !dlgOk) record(item, 'FAIL', 'kanal geldi ama diyalog açılmadı')
    else if (!chOk && dlgOk) record(item, 'FAIL', `diyalog açıldı ama kanal gelmedi: ${item.ch}`)
    else record(item, 'FAIL', `kanal da diyalog da yok: ${item.ch}`)
    if (!(await closeDialogs())) record(item, 'WARN', 'diyalog Escape ile kapanmadı')
  }

  async function runTab(item) {
    const since = await menuLogLen()
    await clickPath(item.path)
    const chOk = await sawChannel(item.ch, since)
    const deadline = Date.now() + 2500
    let tabOk = false
    while (Date.now() < deadline) {
      if ((await uiState('activeTab')) === item.tab) {
        tabOk = true
        break
      }
      await win.waitForTimeout(120)
    }
    if (chOk && tabOk) record(item, 'PASS', `aktif sekme: ${item.tab}`)
    else
      record(
        item,
        'FAIL',
        `kanal=${chOk} sekme=${await uiState('activeTab')} (beklenen ${item.tab})`
      )
  }

  async function runToggle(item) {
    const before = await uiState(item.flag)
    const since = await menuLogLen()
    await clickPath(item.path)
    const chOk = await sawChannel(item.ch, since)
    await win.waitForTimeout(300)
    const mid = await uiState(item.flag)
    // restore
    await clickPath(item.path)
    await win.waitForTimeout(300)
    const after = await uiState(item.flag)
    if (chOk && mid === !before && after === before)
      record(item, 'PASS', `${item.flag}: ${before} → ${mid} → ${after}`)
    else record(item, 'FAIL', `${item.flag}: ${before} → ${mid} → ${after}, kanal=${chOk}`)
  }

  async function runRole(item) {
    const meta = await getItem(item.path)
    if (!meta) return record(item, 'FAIL', 'menü öğesi bulunamadı')
    if (meta.role === item.role && meta.enabled)
      record(item, 'PASS', `role=${meta.role}, kısayol=${meta.accelerator ?? '-'}`)
    else record(item, 'FAIL', `role=${meta.role} enabled=${meta.enabled}`)
  }

  async function runDisabled(item) {
    const meta = await getItem(item.path)
    if (!meta) return record(item, 'FAIL', 'menü öğesi bulunamadı')
    if (meta.enabled === false) record(item, 'DISABLED-BY-DESIGN')
    else record(item, 'FAIL', 'enabled:false bekleniyordu, tıklanabilir çıktı')
  }

  async function runSkip(item) {
    const meta = await getItem(item.path)
    if (!meta) return record(item, 'FAIL', 'menü öğesi bulunamadı')
    if (meta.enabled) record(item, 'SKIPPED', `${item.reason}; kısayol=${meta.accelerator ?? '-'}`)
    else record(item, 'FAIL', 'öğe devre dışı (beklenmiyor)')
  }

  async function runPrint(item) {
    const before = await app.evaluate(() => globalThis.__printCalls)
    await clickPath(item.path)
    await win.waitForTimeout(800)
    const after = await app.evaluate(() => globalThis.__printCalls)
    if (after === before + 1) record(item, 'PASS', 'webContents.print çağrıldı (stub)')
    else record(item, 'FAIL', `print çağrısı: ${before} → ${after}`)
  }

  async function runDoc(item) {
    const before = await app.evaluate(() => globalThis.__openedPaths.length)
    await clickPath(item.path)
    await win.waitForTimeout(800)
    const paths = await app.evaluate(() => globalThis.__openedPaths)
    const added = paths.slice(before)
    const hit = added.find(p => p.endsWith(item.file))
    if (hit && fs.existsSync(hit)) record(item, 'PASS', `açıldı: ${hit}`)
    else if (hit) record(item, 'FAIL', `dosya diskte yok: ${hit}`)
    else record(item, 'FAIL', `shell.openPath çağrılmadı (eklenen: ${JSON.stringify(added)})`)
  }

  async function runDevtools(item) {
    const state = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()
      )
    const before = await state()
    await clickPath(item.path)
    await win.waitForTimeout(1200)
    const mid = await state()
    await clickPath(item.path)
    await win.waitForTimeout(1200)
    const after = await state()
    if (mid === !before && after === before)
      record(item, 'PASS', `DevTools ${before} → ${mid} → ${after}`)
    else record(item, 'FAIL', `DevTools ${before} → ${mid} → ${after}`)
  }

  async function runRecent(item) {
    const sub = await app.evaluate(({ Menu }, p) => {
      const idx = p.split('/').map(Number)
      let items = Menu.getApplicationMenu().items
      let item = null
      for (const i of idx) {
        item = items[i]
        items = item.submenu ? item.submenu.items : []
      }
      return item.submenu
        ? item.submenu.items.map(s => ({
            label: s.label || `<${s.type}>`,
            enabled: s.enabled,
            type: s.type
          }))
        : null
    }, item.path)
    if (!sub) return record(item, 'FAIL', 'alt menü yok')
    if (sub.length === 1 && sub[0].enabled === false)
      record(item, 'PASS', `boş liste — devre dışı yer tutucu: "${sub[0].label}"`)
    else if (sub.some(s => s.enabled))
      record(
        item,
        'PASS',
        `${sub.filter(s => s.type === 'normal').length} kayıt listeleniyor (tıklanmadı, kullanıcı recents korundu)`
      )
    else record(item, 'FAIL', `beklenmedik alt menü: ${JSON.stringify(sub)}`)
  }

  // Edit ▸ Bul opens the inline FindReplaceBar (role="search") in DataView,
  // not the [role="dialog"] FindReplaceDialog (that's the bar's "more
  // options" button) — DataView.tsx:2261 vs 2292.
  async function runFindBar(item) {
    const since = await menuLogLen()
    await clickPath(item.path)
    const chOk = await sawChannel(item.ch, since)
    let barOk = false
    try {
      await win.locator('[role="search"]').first().waitFor({ state: 'visible', timeout: 5000 })
      barOk = true
    } catch {
      /* not visible */
    }
    if (chOk && barOk) record(item, 'PASS', 'kanal + Bul çubuğu (role=search) açıldı')
    else record(item, 'FAIL', `kanal=${chOk} bar=${barOk}`)
    // Close the bar: Escape from its input, fallback to its last button
    // (the close button — penultimate is "more options", must not click it).
    await win
      .locator('[role="search"] input')
      .first()
      .focus()
      .catch(() => {})
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)
    if (
      await win
        .locator('[role="search"]')
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      const btns = win.locator('[role="search"] button')
      const n = await btns.count()
      if (n > 0) {
        await btns
          .nth(n - 1)
          .click()
          .catch(() => {})
        await win.waitForTimeout(300)
      }
    }
  }

  async function runSelectCases(item) {
    const since = await menuLogLen()
    await clickPath(item.path)
    const chOk = await sawChannel(item.ch, since)
    await win.waitForTimeout(400)
    const tab = await uiState('activeTab')
    const icons = await uiState('showColumnFilterIcons')
    if (chOk && tab === 'data' && icons === true)
      record(item, 'PASS', 'sekme=data, sütun filtre simgeleri açık')
    else record(item, 'FAIL', `kanal=${chOk} sekme=${tab} filtreSimgeleri=${icons}`)
  }

  async function runTheme(item) {
    // submenu indexes: 0 light, 1 dark, 2 high-contrast, 3 system
    const cases = [
      { idx: 0, expect: 'light' },
      { idx: 1, expect: 'dark' },
      { idx: 2, expect: 'high-contrast' }
    ]
    let ok = true
    let detail = []
    for (const c of cases) {
      const since = await menuLogLen()
      await clickPath(`${item.path}/${c.idx}`)
      const chOk = await sawChannel('menu:theme', since)
      await win.waitForTimeout(400)
      const attr = await win.evaluate(() => document.documentElement.getAttribute('data-theme'))
      detail.push(`${c.expect}:${attr}${chOk ? '' : '(kanal yok!)'}`)
      if (!chOk || attr !== c.expect) ok = false
    }
    // restore original theme setting
    const restoreIdx = { light: 0, dark: 1, 'high-contrast': 2, system: 3 }[origTheme] ?? 3
    await clickPath(`${item.path}/${restoreIdx}`)
    await win.waitForTimeout(400)
    if (ok) record(item, 'PASS', detail.join(' '))
    else record(item, 'FAIL', detail.join(' '))
  }

  async function runLanguage(item) {
    // SUPPORTED_LANGUAGES = ['tr','en','es','fr','pt','it']
    const idxOf = { tr: 0, en: 1, es: 2, fr: 3, pt: 4, it: 5 }
    const other = origLang === 'en' ? 'tr' : 'en'
    const before = await topLabels()
    const since = await menuLogLen()
    await clickPath(`${item.path}/${idxOf[other]}`)
    const chOk = await sawChannel('menu:language', since)
    // menu rebuilds on language change — wait for top labels to differ
    let changed = false
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const now = await topLabels()
      if (JSON.stringify(now) !== JSON.stringify(before)) {
        changed = true
        break
      }
      await win.waitForTimeout(200)
    }
    // switch back (menu rebuilt, but template structure is identical)
    await clickPath(`${item.path}/${idxOf[origLang]}`)
    await win.waitForTimeout(800)
    const restored = JSON.stringify(await topLabels()) === JSON.stringify(before)
    if (chOk && changed && restored)
      record(item, 'PASS', `${origLang} → ${other} → ${origLang} (menü yeniden kuruldu)`)
    else record(item, 'FAIL', `kanal=${chOk} değişim=${changed} geriAlma=${restored}`)
  }

  async function runNewDataset(item) {
    const prevId = await datasetId()
    const since = await menuLogLen()
    await clickPath(item.path)
    const chOk = await sawChannel(item.ch, since)
    const deadline = Date.now() + 4000
    let newId = prevId
    while (Date.now() < deadline) {
      newId = await datasetId()
      if (newId && newId !== prevId) break
      await win.waitForTimeout(200)
    }
    if (chOk && newId && newId !== prevId)
      record(item, 'PASS', `dataset sıfırlandı (${prevId} → ${newId})`)
    else record(item, 'FAIL', `kanal=${chOk} datasetId=${prevId} → ${newId}`)
    // fixture might also have been clobbered by File ▸ Kaydet (saves .sdf to
    // the imported path) — rewrite it before reloading.
    writeFixture()
    await loadFixture()
  }

  const runners = {
    channel: runChannel,
    dialog: runDialog,
    tab: runTab,
    toggle: runToggle,
    role: runRole,
    disabled: runDisabled,
    skip: runSkip,
    print: runPrint,
    doc: runDoc,
    devtools: runDevtools,
    recent: runRecent,
    selectCases: runSelectCases,
    findbar: runFindBar,
    theme: runTheme,
    language: runLanguage,
    newDataset: runNewDataset
  }

  // ── Drive the plan ───────────────────────────────────────────────────────
  // Deferred items (destructive: New Dataset) run at the very end.
  const deferred = PLAN.filter(p => p.defer)
  for (const item of PLAN.filter(p => !p.defer)) {
    try {
      await runners[item.kind](item)
    } catch (err) {
      record(item, 'FAIL', `beklenmedik hata: ${err.message}`)
      await closeDialogs()
    }
  }
  // Make sure we're back on the data tab with a loaded dataset for the
  // deferred destructive item.
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('data'))
  for (const item of deferred) {
    try {
      await runners[item.kind](item)
    } catch (err) {
      record(item, 'FAIL', `beklenmedik hata: ${err.message}`)
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const counts = {}
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
  const fails = results.filter(r => r.status === 'FAIL')
  const summary = { counts, fails: fails.map(f => ({ name: f.name, note: f.note })), pageErrors }
  console.log('MENU_COVERAGE_SUMMARY:' + JSON.stringify(summary, null, 2))

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (fails.length > 0) {
    console.error(`E2E FAILED (${fails.length} item)`)
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
