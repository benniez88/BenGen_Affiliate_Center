# ติดตั้ง Task Scheduler ให้เปิด BenGen AutoPost Agent อัตโนมัติ
# - เปิดตอนล็อกอินเข้า Windows (ผู้ใช้ปัจจุบัน ไม่ต้องใช้สิทธิ์ admin)
# - รันแบบไม่มีหน้าต่าง (pythonw.exe) — ดู log ได้ที่ logs\agent.log
# - โปรแกรมตาย → เปิดใหม่เองภายใน 1 นาที (trigger ทำซ้ำทุก 1 นาที), ไม่มีกำหนดเวลาหยุด, รันได้ตอนใช้แบต
# รันซ้ำได้ (จะลบ task เดิมแล้วสร้างใหม่)

$ErrorActionPreference = 'Stop'
$TaskName = 'BenGen AutoPost Agent'
$Dir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script   = Join-Path $Dir 'bengen_agent.py'

$PythonW = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\pythonw.exe'
if (-not (Test-Path $PythonW)) {
    $cmd = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'ไม่พบ pythonw.exe — ติดตั้ง Python ก่อน' }
    $PythonW = $cmd.Source
}
if (-not (Test-Path $Script))                     { throw "ไม่พบ $Script" }

# ถ้ามี Agent ที่เปิดเองค้างอยู่ ตัวที่ Task Scheduler เปิดจะชนกัน (ปิดตัวเองทันที)
# ไม่ปิดให้อัตโนมัติ — ถ้ากำลังโพสต์อยู่ คลิปนั้นจะพังกลางทาง
$running = Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" |
    Where-Object { $_.CommandLine -like '*bengen_agent.py*' -and $_.CommandLine -notlike '*--once*' }
if ($running -and -not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Write-Host '⚠️  มี Agent ที่เปิดเองรันอยู่ — กด Ctrl+C ในหน้าต่างนั้นก่อน (รอให้โพสต์คลิปปัจจุบันเสร็จ) แล้วรันสคริปต์นี้ใหม่'
    exit 1
}
if (-not (Test-Path (Join-Path $Dir 'config.yaml'))) { throw 'ไม่พบ config.yaml' }

$action   = New-ScheduledTaskAction -Execute $PythonW -Argument "`"$Script`"" -WorkingDirectory $Dir
# trigger 1: เปิดตอนล็อกอินเข้า Windows
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# trigger 2: watchdog ทุก 1 นาทีไม่มีวันหมด เริ่มนับตั้งแต่ตอนติดตั้ง — Agent ยังรันอยู่ → ข้าม (IgnoreNew),
# Agent ตาย → เปิดใหม่ (RestartCount ของ Task Scheduler ใช้ได้เฉพาะตอน "เปิดไม่ขึ้น" และ repetition ที่ผูกกับ
# trigger ล็อกอินจะเริ่มนับหลังล็อกอินครั้งถัดไปเท่านั้น จึงต้องแยก trigger เวลาไว้ต่างหาก)
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$trigger  = @($logon, $watchdog)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'BenGen AutoPost: ตรวจเครื่อง + โพสต์ Shopee Video ตามเวลาที่ตั้งในเว็บ' | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ''
Write-Host "✅ ติดตั้ง '$TaskName' แล้ว — สถานะ: $((Get-ScheduledTask -TaskName $TaskName).State)"
Write-Host "   Python : $PythonW"
Write-Host "   Log    : $(Join-Path $Dir 'logs\agent.log')"
Write-Host ''
Write-Host '--- log ล่าสุด ---'
Get-Content (Join-Path $Dir 'logs\agent.log') -Tail 5 -Encoding utf8
