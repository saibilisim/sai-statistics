; electron-builder NSIS özelleştirmeleri (electron-builder.json → nsis.include).
; Hoş geldiniz sayfası: electron-builder varsayılanında yok; metinleri NSIS'in
; kendi dil dosyalarından gelir (seçilen kurulum diline göre otomatik çevrilir).
; Varsayılan dil İngilizce (1033): NSIS normalde Windows dilini önceden seçer;
; preInit dil seçim penceresinden (MUI_LANGDLL_DISPLAY) hemen önce çalışır.
!macro preInit
  StrCpy $LANGUAGE 1033
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
