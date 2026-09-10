# Double-click (or run) to (re)start the AMO bot with NO console window.
# Logs go to bot-live.log / bot-live.err.log in this folder.
$ErrorActionPreference = "SilentlyContinue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*dist/index.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2
Start-Process -FilePath "node" -ArgumentList "dist/index.js" `
  -WorkingDirectory $here -WindowStyle Hidden `
  -RedirectStandardOutput "$here\bot-live.log" `
  -RedirectStandardError "$here\bot-live.err.log"
Start-Sleep -Seconds 10
Get-Content -LiteralPath "$here\bot-live.log" | Select-Object -Last 8
