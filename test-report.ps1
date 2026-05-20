$report = @()
$script:TOKEN = ""
$script:AUTH = @{}

function Test-Step($name, $scriptBlock) {
    try {
        $result = & $scriptBlock
        $status = "PASS"
        $script:report += [PSCustomObject]@{Name=$name; Status=$status; Detail=$result}
        Write-Host "[PASS] $name - $result" -ForegroundColor Green
    } catch {
        $status = "FAIL"
        $script:report += [PSCustomObject]@{Name=$name; Status=$status; Detail=$_.Exception.Message}
        Write-Host "[FAIL] $name - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "       AI Platform Gong Neng Ce Shi Bao Gao" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
$startTime = Get-Date
Write-Host "Ce Shi Shi Jian: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))"

# 1. Start server
Write-Host "`n>> Qi Dong Fu Wu Qi..." -ForegroundColor Yellow
$proc = Start-Process -NoNewWindow -PassThru -FilePath "node" -ArgumentList "dist/index.js"
Start-Sleep 5

# Get auth token
try {
    $login = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method Post `
        -Body '{"password":"admin123"}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 5
    $script:TOKEN = $login.token
    $script:AUTH = @{"x-auth-token"=$script:TOKEN}
    Write-Host "[INFO] Auth token obtained: $($script:TOKEN.Substring(0,8))..." -ForegroundColor Gray
} catch {
    Write-Host "[WARN] Login failed: $($_.Exception.Message)" -ForegroundColor Yellow
    $script:AUTH = @{}
}

# =======================================
# 1. Web Chat
# =======================================
Write-Host "`n--- 1. Web Chat Mian Ban ---" -ForegroundColor Green

Test-Step "POST /api/chat - Zheng Chang Dui Hua" {
    $chatBody = '{"text":"' + "Hello, please introduce yourself in one sentence." + '"}'
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method Post `
        -Body $chatBody -ContentType "application/json; charset=utf-8" `
        -UseBasicParsing -TimeoutSec 30 -Headers $script:AUTH
    $ok = ($r.ok -eq $true) -and ($r.reply -ne $null) -and ($r.reply.Length -gt 0)
    if (-not $ok) { throw "Response incomplete: $($r | ConvertTo-Json)" }
    "reply len=$($r.reply.Length), userId=$($r.userId)"
}

Test-Step "POST /api/chat - Missing text field" {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method Post `
            -Body '{}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 5 -Headers $script:AUTH
        throw "Should return 400 but got 200"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -ne 400) { throw "Expected 400 got $code" }
        "Correctly returned 400"
    }
}

Test-Step "POST /api/chat - No auth should reject" {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method Post `
            -Body '{"text":"test"}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 5
        throw "Should return 401 but got 200"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -ne 401) { throw "Expected 401 got $code" }
        "Correctly returned 401"
    }
}

# =======================================
# 2. Messages
# =======================================
Write-Host "`n--- 2. Messages Xiao Xi Ji Lu ---" -ForegroundColor Green

Test-Step "GET /api/messages - Get all messages" {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/messages" -UseBasicParsing -TimeoutSec 5 -Headers $script:AUTH
    if ($r -isnot [array]) { throw "Expected array, got $($r.GetType())" }
    "Returned $($r.Count) messages"
}

Test-Step "GET /api/messages?userId= - Filter by user" {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/messages?userId=web_" -UseBasicParsing -TimeoutSec 5 -Headers $script:AUTH
    if ($r -isnot [array]) { throw "Expected array" }
    "Returned $($r.Count) messages"
}

Test-Step "GET /api/messages/users - User list" {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/messages/users" -UseBasicParsing -TimeoutSec 5 -Headers $script:AUTH
    if ($r -isnot [array]) { throw "Expected array" }
    "Returned $($r.Count) users"
}

Test-Step "GET /api/messages - Pagination limit/offset" {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/messages?limit=2&offset=0" -UseBasicParsing -TimeoutSec 5 -Headers $script:AUTH
    if ($r.Count -gt 2) { throw "limit=2 but got $($r.Count) items" }
    "limit=2 returned $($r.Count) items"
}

# =======================================
# 3. Export / Import
# =======================================
Write-Host "`n--- 3. Export / Import ---" -ForegroundColor Green

Test-Step "GET /api/export - Export all data" {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/export" -UseBasicParsing -TimeoutSec 10 -Headers $script:AUTH
    $tables = @('agents','sessions','messages','traces','knowledge_chunks','channels')
    $nullTables = @()
    foreach ($t in $tables) { if ($r.$t -eq $null) { $nullTables += $t } }
    if ($nullTables.Count -gt 0) { throw "Null tables: $($nullTables -join ',')" }
    "7 tables: agents=$($r.agents.Count), sessions=$($r.sessions.Count), messages=$($r.messages.Count), traces=$($r.traces.Count), knowledge_chunks=$($r.knowledge_chunks.Count), channels=$($r.channels.Count)"
}

Test-Step "POST /api/import - Import data" {
    $export = Invoke-RestMethod -Uri "http://localhost:3000/api/export" -UseBasicParsing -TimeoutSec 10 -Headers $script:AUTH
    $importBody = @{ agents = @(); channels = @() }
    if ($export.agents) { $importBody.agents = @($export.agents[0]) }
    $json = $importBody | ConvertTo-Json -Depth 10
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/import" -Method Post `
        -Body $json -ContentType "application/json" `
        -UseBasicParsing -TimeoutSec 10 -Headers $script:AUTH
    if (-not $r.ok) { throw "Import failed: $($r.error)" }
    "Imported: $($r.imported) records"
}

Test-Step "POST /api/import - Invalid data rejected" {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:3000/api/import" -Method Post `
            -Body '{"invalid":true}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 5 -Headers $script:AUTH
        if ($r.ok -eq $true) { throw "Invalid data should not return ok" }
        "Correctly rejected: $($r.error)"
    } catch {
        "Correctly rejected: $($_.Exception.Message)"
    }
}

# =======================================
# 4. LangGraph ReAct
# =======================================
Write-Host "`n--- 4. LangGraph ReAct ReXun Huan ---" -ForegroundColor Green

Test-Step "POST /api/chat - Multi-step tool call (weather)" {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method Post `
        -Body '{"text":"Beijing weather?"}' -ContentType "application/json" `
        -UseBasicParsing -TimeoutSec 60 -Headers $script:AUTH
    if (-not $r.ok) { throw "Request failed: $($r | ConvertTo-Json)" }
    "reply len=$($r.reply.Length), userId=$($r.userId)"
}

Test-Step "POST /api/chat - Multi-turn context" {
    $r1 = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method Post `
        -Body '{"text":"Hello, my name is XiaoHong"}' -ContentType "application/json; charset=utf-8" `
        -UseBasicParsing -TimeoutSec 60 -Headers $script:AUTH
    $uid = $r1.userId
    $body2 = '{"text":"What is my name?","userId":"' + $uid + '"}'
    $r2 = Invoke-RestMethod -Uri "http://localhost:3000/api/chat" -Method Post `
        -Body $body2 -ContentType "application/json; charset=utf-8" `
        -UseBasicParsing -TimeoutSec 60 -Headers $script:AUTH
    $hasName = $r2.reply -match "[Xx]iao[Hh]ong|XiaoHong|xiao|hong"
    $preview = if ($r2.reply.Length -gt 40) { $r2.reply.Substring(0,40) + '...' } else { $r2.reply }
    "Round1 uid=$uid, Round2 hasName=$hasName, reply=$preview"
}

# =======================================
# 5. Admin UI
# =======================================
Write-Host "`n--- 5. Guan Li Hou Tai UI ---" -ForegroundColor Green

Test-Step "GET / - Home page loads with all UI elements" {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 5
    if ($r.Content.Length -lt 1000) { throw "Page too short: $($r.Content.Length)" }
    $hasChat = $r.Content -match "chat-input|sendChat|在线对话"
    $hasMessages = $r.Content -match "msg-user-filter|loadMessages|消息记录"
    $hasExport = $r.Content -match "exportData|导出"
    $hasImport = $r.Content -match "importData|导入"
    $hasLogs = $r.Content -match "loadLogs|运行日志"
    "size=$($r.Content.Length) chars, chatPanel=$hasChat, messagesPanel=$hasMessages, export=$hasExport, import=$hasImport, logsPanel=$hasLogs"
}

# =======================================
# Cleanup
# =======================================
Write-Host "`n>> Guan Bi Fu Wu Qi..." -ForegroundColor Yellow
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 1

# =======================================
# Summary
# =======================================
Write-Host "`n`n============================================" -ForegroundColor Cyan
Write-Host "              Ce Shi Bao Gao Hui Zong" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

$pass = ($script:report | Where-Object { $_.Status -eq 'PASS' }).Count
$fail = ($script:report | Where-Object { $_.Status -eq 'FAIL' }).Count
$total = $script:report.Count
$rate = if ($total) { [math]::Round($pass/$total*100) } else { 0 }

Write-Host "Zong Ce Shi: $total | Tong Guo: $pass | Shi Bai: $fail | Tong Guo Lv: $rate%" -ForegroundColor $(if($fail -eq 0){'Green'}else{'Red'})
Write-Host "`nXiang Xi Jie Guo:" -ForegroundColor Yellow

$script:report | Format-Table -Property Name, Status, Detail -AutoSize -Wrap

# Generate HTML report
$reportPath = "C:\Users\HUAWEI\AppData\Local\Temp\opencode\ai-platform-test-report.html"
$htmlLines = @()
$htmlLines += "<!DOCTYPE html>"
$htmlLines += "<html lang='zh-CN'>"
$htmlLines += "<head><meta charset='UTF-8'><title>AI Platform Ce Shi Bao Gao</title>"
$htmlLines += "<style>"
$htmlLines += "body{font-family:-apple-system,sans-serif;margin:40px;background:#f8f9fa;color:#333}"
$htmlLines += "h1{color:#2d3436}.pass{color:#00b894;font-weight:bold}.fail{color:#d63031;font-weight:bold}"
$htmlLines += "table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.08);border-radius:8px;overflow:hidden}"
$htmlLines += "th{background:#2d3436;color:#fff;padding:12px 16px;text-align:left}"
$htmlLines += "td{padding:10px 16px;border-bottom:1px solid #eef0f6}"
$htmlLines += ".summary{font-size:1.2rem;margin:20px 0;padding:16px;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08)}"
$htmlLines += "</style></head><body>"
$endTime = Get-Date
$htmlLines += "<h1>AI Platform Gong Neng Ce Shi Bao Gao</h1>"
$htmlLines += "<p>Ce Shi Shi Jian: $($startTime.ToString('yyyy-MM-dd HH:mm:ss')) ~ $($endTime.ToString('HH:mm:ss'))</p>"
$htmlLines += "<div class='summary'>"
$htmlLines += "  Zong Ce Shi: <strong>$total</strong> | "
$htmlLines += "  Tong Guo: <strong style='color:#00b894'>$pass</strong> | "
$htmlLines += "  Shi Bai: <strong style='color:#d63031'>$fail</strong> | "
$htmlLines += "  Tong Guo Lv: <strong>$rate%</strong>"
$htmlLines += "</div>"
$htmlLines += "<table><thead><tr><th>Ce Shi Xiang</th><th>Jie Guo</th><th>Xiang Qing</th></tr></thead><tbody>"

foreach ($r in $script:report) {
    $cls = if ($r.Status -eq 'PASS') { 'pass' } else { 'fail' }
    $htmlLines += "<tr><td>$($r.Name)</td><td class='$cls'>$($r.Status)</td><td>$($r.Detail)</td></tr>"
}

$htmlLines += "</tbody></table>"
$htmlLines += "<p style='margin-top:20px;color:#b2bec3;font-size:.8rem'>AI Platform Test Report</p>"
$htmlLines += "</body></html>"

$htmlLines -join "`n" | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "`n>> Ce Shi Bao Gao Bao Cun Dao: $reportPath" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
