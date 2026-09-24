# ถอน Task Scheduler ของ BenGen AutoPost Agent และหยุด Agent ที่รันอยู่
$TaskName = 'BenGen AutoPost Agent'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "✅ ถอน '$TaskName' แล้ว"
} else {
    Write-Host "ℹ️ ไม่พบ task '$TaskName'"
}
# เผื่อมี Agent ที่เปิดมือค้างอยู่ (pythonw / python ที่รัน bengen_agent.py)
Get-CimInstance Win32_Process -Filter "Name LIKE 'python%'" |
    Where-Object { $_.CommandLine -like '*bengen_agent.py*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "หยุด Agent PID $($_.ProcessId)" }
