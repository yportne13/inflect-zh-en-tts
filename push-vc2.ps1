$env:GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=60 -o ServerAliveInterval=15 -o ServerAliveCountMax=30'
Set-Location 'F:\projects\python\inflect-nano-chinese-v2\demo'
for ($i=1; $i -le 4; $i++) {
  "attempt $i $(Get-Date -Format HH:mm:ss)" | Out-File -Append logs-push.txt -Encoding utf8
  git push ssh://git@ssh.github.com:443/yportne13/inflect-zh-en-tts.git main *>> logs-push.txt
  if ($LASTEXITCODE -eq 0) { "PUSH OK attempt $i" | Out-File -Append logs-push.txt -Encoding utf8; break }
  Start-Sleep -Seconds 20
}
'done' | Out-File -Append logs-push.txt -Encoding utf8
