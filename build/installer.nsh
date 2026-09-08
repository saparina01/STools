!macro customUnInstall
  # 覆盖升级也会执行卸载段，仅在用户主动卸载时清理开机启动项。
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"

    # 清理由旧版 AppUserModelID 写入的开机启动项。
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "link.eiot.ztools"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "link.eiot.ztools"
  ${endIf}
!macroend
