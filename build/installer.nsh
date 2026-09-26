; Included by electron-builder's NSIS installer (see `nsis.include` in
; electron-builder.yml).
;
; Stop any running backend before files are copied. Versions up to 0.1.3 left
; the PyInstaller sidecar running after the app closed (only its bootloader was
; killed), and a running zzz-sidecar.exe is locked: the installer would then
; update the frontend but silently keep the *old* backend, and every route the
; new frontend added fails with a 404. /T takes each bootloader's child too.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM zzz-sidecar.exe'
  Pop $0
!macroend
