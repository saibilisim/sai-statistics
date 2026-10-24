// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState, useRef, useEffect, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { CellFormat } from '@shared/data-types'
import { useUIStore } from '../../store/ui-store'
import { useDatasetStore } from '../../store/dataset-store'
import { useGridBridgeStore } from '../../store/grid-bridge-store'
import { useSettingsStore } from '../../store/settings-store'
import { saveCurrentDataset } from '../../lib/file-actions'
import { performUndoRedo } from '../../lib/dataset-undo'
import { RibbonButton } from './RibbonButton'
import { RibbonDropdown } from './RibbonDropdown'
import { ColorDropdown } from './ColorDropdown'
import { RecallDropdown } from './RecallDropdown'
import {
  SaveIcon,
  TagIcon,
  GearIcon,
  AddPlusIcon,
  RemoveXGlyph,
  AddSmallPlusGlyph,
  TwoRowsIcon,
  UndoIcon,
  RedoIcon,
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  FontColorIcon,
  FillColorIcon,
  FilterIcon,
  SearchIcon
} from './ribbon-icons'
import styles from './Ribbon.module.css'

/** Currency control (Number Format ▸ Currency) — a flat symbol menu instead
 *  of one generic "Currency" entry, so picking $/€/£/¥/₺ sets both
 *  numberFormat:'currency' and which currency in a single click. */
const CURRENCY_OPTIONS: {
  code: NonNullable<CellFormat['currency']>
  symbol: string
  labelKey:
    | 'menu:view.numberFormatUSD'
    | 'menu:view.numberFormatEUR'
    | 'menu:view.numberFormatGBP'
    | 'menu:view.numberFormatJPY'
    | 'menu:view.numberFormatTRY'
}[] = [
  { code: 'USD', symbol: '$', labelKey: 'menu:view.numberFormatUSD' },
  { code: 'EUR', symbol: '€', labelKey: 'menu:view.numberFormatEUR' },
  { code: 'GBP', symbol: '£', labelKey: 'menu:view.numberFormatGBP' },
  { code: 'JPY', symbol: '¥', labelKey: 'menu:view.numberFormatJPY' },
  { code: 'TRY', symbol: '₺', labelKey: 'menu:view.numberFormatTRY' }
]

/**
 * Number Format dropdown's "Currency" row — clicking it opens a NESTED
 * flyout of just the currency symbols ($/€/£/¥/₺, no text labels) instead of
 * immediately applying a format, so a currency actually has to be chosen.
 *
 * `e.stopPropagation()` on the row's own click matters: RibbonDropdown's
 * popover closes on ANY click bubbling up to it (so picking General/Number/
 * Percent/Scientific closes the whole menu after applying) — without
 * stopping propagation here, opening this nested flyout would also
 * immediately close the parent list before the flyout ever showed. Picking
 * an actual currency from the flyout is NOT stopped, so that click still
 * bubbles up and closes the parent (one click applies + closes, matching
 * every other row).
 *
 * Local `open` state resets for free on every reopen: RibbonDropdown only
 * renders its children while its own popover is open, so this component
 * unmounts (and its state is deleted) each time the parent list closes.
 */
function CurrencyMenuRow({
  label,
  active,
  currentCurrency,
  disabled,
  onPick
}: {
  label: string
  active: boolean
  currentCurrency: NonNullable<CellFormat['currency']>
  disabled: boolean
  onPick: (code: NonNullable<CellFormat['currency']>) => void
}) {
  const { t } = useTranslation(['common', 'menu'])
  const [open, setOpen] = useState(false)

  return (
    <div className={styles.currencyRow}>
      <RibbonButton
        label={`${label} ▸`}
        title={label}
        active={active}
        disabled={disabled}
        onClick={e => {
          // Stop this click from bubbling to RibbonDropdown's popover
          // (which closes the WHOLE menu on any click inside it) — this
          // row only opens the nested currency-symbol flyout, it doesn't
          // pick a format itself, so the parent list must stay open.
          e.stopPropagation()
          setOpen(prev => !prev)
        }}
      />
      {open && (
        // No stopPropagation here (unlike the trigger button above) —
        // picking an actual currency SHOULD bubble up and close the whole
        // menu, same as every other row (General/Number/Percent/…).
        <div className={styles.currencySubmenu}>
          {CURRENCY_OPTIONS.map(({ code, symbol, labelKey }) => (
            <RibbonButton
              key={code}
              label={symbol}
              title={t(labelKey)}
              active={active && currentCurrency === code}
              disabled={disabled}
              onClick={() => {
                onPick(code)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Bir ribbon buton tanımı. `id` —— özelleştirme (gizle/sırala) için kalıcı
 * anahtar; uygulama yeniden başlasa bile aynı `id` aynı referanstır. Yeni
 * buton eklersen yalnızca `id`sini değiştirme, yoksa kullanıcı tercihi
 * kayar. `availableWhen` `false` ise buton o an bağlamda hiç render edilmez
 * (gizli değil, bağlamdan bağımsız olarak gösterilebilir değil) — edit modu
 * da buna dokunmaz; kullanıcı gizlemek istiyorsa `editMode` ile kaldırır.
 */
interface RibbonItem {
  id: string
  node: ReactNode
  availableWhen: 'always' | 'dataView'
}

export function Ribbon() {
  const { t } = useTranslation(['common', 'menu', 'analysis', 'dialogs'])

  const showToolbar = useUIStore(s => s.showToolbar)
  const activeTab = useUIStore(s => s.activeTab)
  const showValueLabels = useUIStore(s => s.showValueLabels)
  const headerMode = useUIStore(s => s.headerMode)
  const toggleValueLabels = useUIStore(s => s.toggleValueLabels)
  const toggleHeaderMode = useUIStore(s => s.toggleHeaderMode)
  const showColumnFilterIcons = useUIStore(s => s.showColumnFilterIcons)
  const toggleColumnFilterIcons = useUIStore(s => s.toggleColumnFilterIcons)
  const ribbonEditMode = useUIStore(s => s.ribbonEditMode)
  const setRibbonEditMode = useUIStore(s => s.setRibbonEditMode)

  const datasetId = useDatasetStore(s => s.datasetId)
  const clearAllFilters = useDatasetStore(s => s.clearAllFilters)
  const applyCellFormat = useGridBridgeStore(s => s.applyCellFormat)
  const activeCellFormat = useGridBridgeStore(s => s.activeCellFormat)
  const openFindBridge = useGridBridgeStore(s => s.openFind)

  const ribbonSettings = useSettingsStore(s => s.settings.ribbon)
  const toggleRibbonHidden = useSettingsStore(s => s.toggleRibbonHidden)
  const addRibbonItem = useSettingsStore(s => s.addRibbonItem)
  const setRibbonOrder = useSettingsStore(s => s.setRibbonOrder)
  const toggleRibbonTwoRows = useSettingsStore(s => s.toggleRibbonTwoRows)

  // Ekle popover açma durumu
  const [addOpen, setAddOpen] = useState(false)
  const addPopoverRef = useRef<HTMLDivElement>(null)
  // Sürükle-bırak sıralaması için. Kullanıldığı yer çok aşağıda ama hook'lar
  // `if (!showToolbar) return null` erken dönüşünden ÖNCE çağrılmalı — aksi
  // halde render'lar arasında hook sırası değişir (rules-of-hooks).
  const dragIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!addOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (addPopoverRef.current && !addPopoverRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [addOpen])

  if (!showToolbar) return null

  const hasDataset = datasetId !== null
  const isDataView = activeTab === 'data'
  const canEdit = isDataView && hasDataset && applyCellFormat !== null

  const format = (patch: CellFormat) => {
    applyCellFormat?.(patch)
  }

  const handleToggleFilterIcons = () => {
    if (showColumnFilterIcons) clearAllFilters()
    toggleColumnFilterIcons()
  }

  const undoRedo = performUndoRedo

  const handleSave = () => {
    void saveCurrentDataset().catch((err: unknown) => {
      console.error('Failed to save dataset:', err)
    })
  }

  const fmtButton = (icon: ReactNode, title: string, patch: CellFormat, active = false) => (
    <RibbonButton
      icon={icon}
      title={title}
      onClick={() => {
        format(patch)
      }}
      disabled={!canEdit}
      active={active}
    />
  )

  const numberFormat = activeCellFormat?.numberFormat ?? 'general'
  const currency = activeCellFormat?.currency ?? 'TRY'
  const numberFormatLabel =
    numberFormat === 'currency'
      ? t('menu:view.numberFormatCurrency')
      : numberFormat === 'percent'
        ? t('menu:view.numberFormatPercent')
        : numberFormat === 'scientific'
          ? t('menu:view.numberFormatScientific')
          : numberFormat === 'number'
            ? t('menu:view.numberFormatNumber')
            : t('menu:view.numberFormatGeneral')

  const hAlign = activeCellFormat?.hAlign ?? 'left'
  const hAlignIcon =
    hAlign === 'center' ? AlignCenterIcon : hAlign === 'right' ? AlignRightIcon : AlignLeftIcon

  // --- Buton tanımları (varsayılan sıra) ---
  const allItems: RibbonItem[] = [
    {
      id: 'save',
      availableWhen: 'always',
      node: (
        <RibbonButton
          icon={SaveIcon}
          title={t('common.save')}
          onClick={handleSave}
          disabled={!hasDataset}
        />
      )
    },
    {
      id: 'undo',
      availableWhen: 'always',
      node: (
        <RibbonButton
          icon={UndoIcon}
          title={t('menu:edit.undo')}
          onClick={() => {
            undoRedo('undo')
          }}
          disabled={!hasDataset}
        />
      )
    },
    {
      id: 'redo',
      availableWhen: 'always',
      node: (
        <RibbonButton
          icon={RedoIcon}
          title={t('menu:edit.redo')}
          onClick={() => {
            undoRedo('redo')
          }}
          disabled={!hasDataset}
        />
      )
    },
    {
      id: 'recall',
      availableWhen: 'always',
      node: <RecallDropdown />
    },

    {
      id: 'valueLabels',
      availableWhen: 'dataView',
      node: (
        <RibbonButton
          icon={TagIcon}
          title={t('menu:view.valueLabels')}
          onClick={toggleValueLabels}
          active={showValueLabels}
          disabled={!hasDataset}
        />
      )
    },
    {
      id: 'headerMode',
      availableWhen: 'dataView',
      node: (
        <RibbonButton
          icon={<span className={styles.textIcon}>{headerMode === 'name' ? 'Aa' : 'A·B'}</span>}
          title={
            headerMode === 'name' ? t('menu:view.columnLetters') : t('menu:view.variableNames')
          }
          onClick={toggleHeaderMode}
          active={headerMode === 'name'}
          disabled={!hasDataset}
        />
      )
    },

    {
      id: 'fontFamily',
      availableWhen: 'dataView',
      node: (
        <select
          className={styles.select}
          title={t('menu:view.fontFamily')}
          onChange={e => {
            format({ fontFamily: e.target.value })
          }}
          disabled={!canEdit}
          value={activeCellFormat?.fontFamily || 'Arial'}
          aria-label={t('menu:view.fontFamily')}
        >
          <option value="Arial">Arial</option>
          <option value="Calibri">Calibri</option>
          <option value="Segoe UI">Segoe UI</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
          <option value="Verdana">Verdana</option>
        </select>
      )
    },
    {
      id: 'fontSize',
      availableWhen: 'dataView',
      node: (
        <select
          className={[styles.select, styles.selectNarrow].filter(Boolean).join(' ')}
          title={t('menu:view.fontSize')}
          onChange={e => {
            format({ fontSize: Number(e.target.value) })
          }}
          disabled={!canEdit}
          value={activeCellFormat?.fontSize || 11}
          aria-label={t('menu:view.fontSize')}
        >
          {[9, 10, 11, 12, 14, 16, 18, 20, 24].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )
    },
    {
      id: 'numberFormat',
      availableWhen: 'dataView',
      node: (
        <RibbonDropdown
          label={numberFormatLabel}
          title={t('menu:view.numberFormat')}
          disabled={!canEdit}
          column
        >
          <RibbonButton
            label={t('menu:view.numberFormatGeneral')}
            title={t('menu:view.numberFormatGeneral')}
            onClick={() => {
              format({ numberFormat: 'general' })
            }}
            active={numberFormat === 'general'}
            disabled={!canEdit}
          />
          <RibbonButton
            label={t('menu:view.numberFormatNumber')}
            title={t('menu:view.numberFormatNumber')}
            onClick={() => {
              format({ numberFormat: 'number' })
            }}
            active={numberFormat === 'number'}
            disabled={!canEdit}
          />
          <CurrencyMenuRow
            label={t('menu:view.numberFormatCurrency')}
            active={numberFormat === 'currency'}
            currentCurrency={currency}
            disabled={!canEdit}
            onPick={code => {
              format({ numberFormat: 'currency', currency: code })
            }}
          />
          <RibbonButton
            label={t('menu:view.numberFormatPercent')}
            title={t('menu:view.numberFormatPercent')}
            onClick={() => {
              format({ numberFormat: 'percent' })
            }}
            active={numberFormat === 'percent'}
            disabled={!canEdit}
          />
          <RibbonButton
            label={t('menu:view.numberFormatScientific')}
            title={t('menu:view.numberFormatScientific')}
            onClick={() => {
              format({ numberFormat: 'scientific' })
            }}
            active={numberFormat === 'scientific'}
            disabled={!canEdit}
          />
        </RibbonDropdown>
      )
    },

    {
      id: 'bold',
      availableWhen: 'dataView',
      node: fmtButton(
        BoldIcon,
        t('menu:edit.bold'),
        { bold: !activeCellFormat?.bold },
        !!activeCellFormat?.bold
      )
    },
    {
      id: 'italic',
      availableWhen: 'dataView',
      node: fmtButton(
        ItalicIcon,
        t('menu:edit.italic'),
        { italic: !activeCellFormat?.italic },
        !!activeCellFormat?.italic
      )
    },
    {
      id: 'underline',
      availableWhen: 'dataView',
      node: fmtButton(
        UnderlineIcon,
        t('menu:edit.underline'),
        { underline: !activeCellFormat?.underline },
        !!activeCellFormat?.underline
      )
    },

    {
      id: 'textColor',
      availableWhen: 'dataView',
      node: (
        <ColorDropdown
          icon={FontColorIcon}
          title={t('menu:edit.textColor')}
          color={activeCellFormat?.color || '#000000'}
          onSelectColor={color => {
            format({ color })
          }}
          onReset={() => {
            format({ color: undefined })
          }}
          resetLabel={t('menu:edit.resetColor')}
          disabled={!canEdit}
        />
      )
    },
    {
      id: 'fillColor',
      availableWhen: 'dataView',
      node: (
        <ColorDropdown
          icon={FillColorIcon}
          title={t('menu:edit.fillColor')}
          color={activeCellFormat?.bg}
          onSelectColor={color => {
            format({ bg: color })
          }}
          onReset={() => {
            format({ bg: undefined })
          }}
          resetLabel={t('menu:edit.resetColor')}
          disabled={!canEdit}
        />
      )
    },

    {
      id: 'hAlign',
      availableWhen: 'dataView',
      node: (
        <RibbonDropdown icon={hAlignIcon} title={t('menu:edit.alignLeft')} disabled={!canEdit}>
          <RibbonButton
            icon={AlignLeftIcon}
            title={t('menu:edit.alignLeft')}
            onClick={() => {
              format({ hAlign: 'left' })
            }}
            active={hAlign === 'left'}
            disabled={!canEdit}
          />
          <RibbonButton
            icon={AlignCenterIcon}
            title={t('menu:edit.alignCenter')}
            onClick={() => {
              format({ hAlign: 'center' })
            }}
            active={hAlign === 'center'}
            disabled={!canEdit}
          />
          <RibbonButton
            icon={AlignRightIcon}
            title={t('menu:edit.alignRight')}
            onClick={() => {
              format({ hAlign: 'right' })
            }}
            active={hAlign === 'right'}
            disabled={!canEdit}
          />
        </RibbonDropdown>
      )
    },
    {
      id: 'filter',
      availableWhen: 'dataView',
      node: (
        <RibbonButton
          icon={FilterIcon}
          title={t('menu:edit.filter')}
          onClick={handleToggleFilterIcons}
          active={showColumnFilterIcons}
          disabled={!hasDataset}
        />
      )
    },
    {
      id: 'search',
      availableWhen: 'dataView',
      node: (
        <RibbonButton
          icon={SearchIcon}
          title={t('menu:edit.search')}
          onClick={() => {
            openFindBridge?.(false)
          }}
          disabled={!hasDataset || !openFindBridge}
        />
      )
    }
  ]

  // Bağlamda kullanılabilir (Data View koşulu) butonlar.
  // (Union is 'always' | 'dataView', so "not always" already means "dataView"
  // — re-testing it is what the linter flags as an always-true comparison.)
  const availableItems = allItems.filter(it => it.availableWhen === 'always' || isDataView)

  // Sıralama: kullanıcının order listesini esas al, eksik id'leri
  // varsayılan sıraya göre ekle (yeni butonlar için forward-compat). Sadece
  // mevcut (available) butonlar gösterilir.
  const availableIds = availableItems.map(i => i.id)
  const userOrder = ribbonSettings.order.filter(id => availableIds.includes(id))
  availableIds.forEach(id => {
    if (!userOrder.includes(id)) userOrder.push(id)
  })

  const hiddenSet = new Set(ribbonSettings.hidden)
  const visibleOrdered = userOrder.filter(id => !hiddenSet.has(id))

  const byId = new Map(availableItems.map(i => [i.id, i]))
  const hiddenInContext = userOrder.filter(id => hiddenSet.has(id) && byId.has(id))

  // --- Drag-drop (sıralama) — dragIdRef yukarıda tanımlı (hook sırası) ---
  const onDragStart = (e: DragEvent<HTMLSpanElement>, id: string) => {
    if (!ribbonEditMode) return
    dragIdRef.current = id
    e.dataTransfer.effectAllowed = 'move'
    // Veri taşınmazsa bazı tarayıcılar drag'i iptal eder.
    e.dataTransfer.setData('text/plain', id)
  }

  const onDragOver = (e: DragEvent<HTMLSpanElement>, overId: string) => {
    if (!ribbonEditMode || dragIdRef.current === null) return
    if (dragIdRef.current === overId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e: DragEvent<HTMLSpanElement>, overId: string) => {
    if (!ribbonEditMode) return
    e.preventDefault()
    const dragId = dragIdRef.current
    dragIdRef.current = null
    if (!dragId || dragId === overId) return
    const next = [...visibleOrdered]
    const from = next.indexOf(dragId)
    const to = next.indexOf(overId)
    if (from === -1 || to === -1) return
    next.splice(from, 1)
    next.splice(to, 0, dragId)
    // Sıralama yalnızca görünür butonları içerir; gizlilere dokunulmaz.
    // setRibbonOrder tüm listeyi saklar — gizli id'leri de dahil et ki
    // yeniden gösterildiklerinde sıraları korunup kullanıcı sürpriz yaşamasın.
    const fullOrder = [...next, ...hiddenInContext]
    setRibbonOrder(fullOrder)
  }

  const renderItem = (id: string) => {
    const item = byId.get(id)
    if (!item) return null
    return (
      <span
        key={id}
        className={[styles.ribbonItem, ribbonEditMode ? styles.ribbonItemEditable : '']
          .filter(Boolean)
          .join(' ')}
        draggable={ribbonEditMode}
        onDragStart={e => {
          onDragStart(e, id)
        }}
        onDragOver={e => {
          onDragOver(e, id)
        }}
        onDrop={e => {
          onDrop(e, id)
        }}
      >
        {item.node}
        {ribbonEditMode && (
          <button
            type="button"
            className={styles.removeItemBtn}
            title={t('ribbon.removeFromRibbon')}
            aria-label={t('ribbon.removeFromRibbon')}
            onClick={e => {
              e.stopPropagation()
              toggleRibbonHidden(id)
            }}
            onMouseDown={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {RemoveXGlyph}
          </button>
        )}
      </span>
    )
  }

  const renderAddButton = () => (
    <div className={styles.dropdownContainer} ref={addPopoverRef}>
      <button
        type="button"
        className={[
          styles.btn,
          styles.btnAdd,
          addOpen ? styles.dropdownActive : '',
          ribbonEditMode ? styles.btnAddVisible : ''
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          setAddOpen(o => !o)
        }}
        onMouseDown={e => {
          e.preventDefault()
        }}
        title={t('ribbon.moreButtons')}
        aria-label={t('ribbon.moreButtons')}
        aria-haspopup="true"
        aria-expanded={addOpen}
      >
        <span className={styles.btnIcon}>{AddPlusIcon}</span>
      </button>
      {addOpen && (
        <div className={styles.addPopover}>
          <div className={styles.addPopoverTitle}>{t('ribbon.hiddenButtons')}</div>
          {hiddenInContext.length > 0 ? (
            <div className={styles.addPopoverGrid}>
              {hiddenInContext.map(id => (
                <div
                  key={id}
                  className={styles.addPopoverItem}
                  title={t(`ribbon.names.${id}`, { defaultValue: id })}
                >
                  {byId.get(id)?.node}
                  <button
                    type="button"
                    className={styles.addItemBtn}
                    title={t('ribbon.addToRibbon')}
                    aria-label={t('ribbon.addToRibbon')}
                    onClick={e => {
                      e.stopPropagation()
                      addRibbonItem(id)
                    }}
                    onMouseDown={e => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                  >
                    {AddSmallPlusGlyph}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.addPopoverEmpty}>{t('ribbon.allButtonsVisible')}</div>
          )}
        </div>
      )}
    </div>
  )

  const renderGearContainer = () => (
    <div className={styles.gearContainer}>
      {ribbonEditMode && (
        <button
          type="button"
          className={[styles.btn, styles.btnIcon, ribbonSettings.twoRows ? styles.btnActive : '']
            .filter(Boolean)
            .join(' ')}
          onClick={toggleRibbonTwoRows}
          onMouseDown={e => {
            e.preventDefault()
          }}
          title={t('ribbon.toggleTwoRows')}
          aria-label={t('ribbon.toggleTwoRows')}
          aria-pressed={ribbonSettings.twoRows}
        >
          <span className={styles.btnIcon}>{TwoRowsIcon}</span>
        </button>
      )}
      <button
        type="button"
        className={[styles.btn, styles.btnIcon, ribbonEditMode ? styles.btnActive : '']
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          setRibbonEditMode(!ribbonEditMode)
        }}
        onMouseDown={e => {
          e.preventDefault()
        }}
        title={t('ribbon.customize')}
        aria-label={t('ribbon.customize')}
        aria-pressed={ribbonEditMode}
      >
        <span className={styles.btnIcon}>{GearIcon}</span>
      </button>
    </div>
  )

  if (!ribbonSettings.twoRows) {
    return (
      <div
        className={[styles.ribbon, ribbonEditMode ? styles.ribbonEditMode : '']
          .filter(Boolean)
          .join(' ')}
        role="toolbar"
        aria-label={t('common.ready')}
      >
        <div className={styles.ribbonRow}>
          {visibleOrdered.map(renderItem)}
          {ribbonEditMode && renderAddButton()}
          {renderGearContainer()}
        </div>
      </div>
    )
  }

  const mid = Math.ceil(visibleOrdered.length / 2)
  const row1Items = visibleOrdered.slice(0, mid)
  const row2Items = visibleOrdered.slice(mid)

  return (
    <div
      className={[styles.ribbon, styles.ribbonTwoRows, ribbonEditMode ? styles.ribbonEditMode : '']
        .filter(Boolean)
        .join(' ')}
      role="toolbar"
      aria-label={t('common.ready')}
    >
      <div className={styles.ribbonRow}>{row1Items.map(renderItem)}</div>
      <div className={styles.ribbonRow}>
        {row2Items.map(renderItem)}
        {ribbonEditMode && renderAddButton()}
        {renderGearContainer()}
      </div>
    </div>
  )
}
