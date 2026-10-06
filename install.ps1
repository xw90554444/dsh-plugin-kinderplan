# 把 dsh-plugin-kinderplan 装进 DSH 的 desktop profile。
#
# 做四件事，都是幂等的：
#   1. profile/package.json 加一条 link: 依赖，并把它列进 dsh.profile.bundles
#   2. 用 DSH 自带的 pnpm 在 profile 里 install，建立 node_modules 软链
#   3. profile/cordis.patch.yml 追加一条自己的 id（只加自己，不动任何官方组件）
#   4. 校验软链并打印 bundles
#
# 第 3 步是可选的：插件自带的 cordis.patch.yml 已经声明了自己的条目并在
# package.json 的 dsh.bundle.patch 里注册，DSH 会自动应用。这里追加只是一条显式的
# disabled: false，便于日后要禁用时有个现成的位置。注意 profile 的 patch 层按
# **包名**匹配，而板载条目 id 是 `kinderplan`，两者不同。
#
# 新增 bundle 需要重启 DSH 才会生效。

[CmdletBinding()]
param(
  [string]$PluginDir = $PSScriptRoot,
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

function Write-Step($text) { Write-Host "== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "   $text" -ForegroundColor Yellow }

$PluginDir = (Resolve-Path -LiteralPath $PluginDir).Path
$packageJsonPath = Join-Path $PluginDir 'package.json'
$profilePackagePath = Join-Path $ProfileDir 'package.json'
$profilePatchPath = Join-Path $ProfileDir 'cordis.patch.yml'

foreach ($p in @($packageJsonPath, $profilePackagePath, $profilePatchPath)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "缺少文件：$p" }
}

$pluginName = (Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json).name
if (-not $pluginName) { throw "读不出插件名：$packageJsonPath" }

Write-Step "插件：$pluginName"
Write-Ok "源目录 $PluginDir"
Write-Ok "profile $ProfileDir"

# ---------------------------------------------------------------- 1. package.json

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$profilePackagePath.$stamp.bak"
Copy-Item -LiteralPath $profilePackagePath -Destination $backup
Write-Ok "已备份 profile/package.json -> $(Split-Path -Leaf $backup)"

$raw = Get-Content -LiteralPath $profilePackagePath -Raw -Encoding UTF8
$profile = $raw | ConvertFrom-Json

$linkTarget = "link:$($PluginDir -replace '\\', '/')"
$changed = $false

if (-not $profile.dependencies.PSObject.Properties.Name.Contains($pluginName)) {
  $profile.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue $linkTarget
  $changed = $true
  Write-Ok "dependencies += $pluginName -> $linkTarget"
} else {
  $current = $profile.dependencies.$pluginName
  if ($current -ne $linkTarget) {
    $profile.dependencies.$pluginName = $linkTarget
    $changed = $true
    Write-Ok "dependencies 更新：$pluginName -> $linkTarget"
  } else {
    Write-Ok "dependencies 已包含 $pluginName（未变）"
  }
}

$bundles = @($profile.dsh.profile.bundles)
if ($bundles -notcontains $pluginName) {
  $profile.dsh.profile.bundles = @($bundles + $pluginName)
  $changed = $true
  Write-Ok "dsh.profile.bundles += $pluginName"
} else {
  Write-Ok "dsh.profile.bundles 已包含 $pluginName（未变）"
}

if ($changed) {
  # -Depth 12 保留 dsh 嵌套结构；UTF8 无 BOM，避免 JSON 解析告警。
  $json = $profile | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($profilePackagePath, "$json`n", (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------- 2. cordis.patch.yml

$patchRaw = [System.IO.File]::ReadAllText($profilePatchPath, [System.Text.Encoding]::UTF8)
if ($patchRaw -match "(?m)^\s*-\s*id:\s*$([regex]::Escape($pluginName))\s*$") {
  Write-Ok "cordis.patch.yml 已有 $pluginName 行（未变）"
} else {
  Copy-Item -LiteralPath $profilePatchPath -Destination "$profilePatchPath.$stamp.bak"
  $block = "- id: $pluginName`n  disabled: false`n"
  [System.IO.File]::WriteAllText($profilePatchPath, $patchRaw.TrimEnd() + "`n" + $block, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok "cordis.patch.yml += $pluginName（已备份）"
}

# ---------------------------------------------------------------- 3. pnpm install

if (-not $SkipInstall) {
  Write-Step 'pnpm install'
  # @(...) around the pipeline matters: a single match would otherwise collapse
  # to a bare string, and indexing a string yields its first character — which is
  # how this once silently tried to execute the command "C".
  $pnpmCandidates = @(@(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'),
    (Join-Path ${env:ProgramFiles} 'DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.mjs')
  ) | Where-Object { Test-Path -LiteralPath $_ })

  $nodeCandidates = @(@(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
    (Join-Path ${env:ProgramFiles} 'DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ })

  if ($pnpmCandidates.Count -eq 0) { Write-Warn2 '找不到 DSH 自带的 pnpm，跳过 install。请用 DSH 的插件管理器安装，或手动执行 pnpm install。' }
  elseif ($nodeCandidates.Count -eq 0) { Write-Warn2 '找不到 DSH 自带的 node，跳过 install。' }
  else {
    $node = $nodeCandidates[0]
    $pnpm = $pnpmCandidates[0]
    Write-Ok "node $node"
    Write-Ok "pnpm $pnpm"
    Push-Location -LiteralPath $ProfileDir
    try {
      & $node $pnpm install --config.confirmModulesPurge=false 2>&1 | ForEach-Object { "   $_" }
      if ($LASTEXITCODE -ne 0) { Write-Warn2 "pnpm install 退出码 $LASTEXITCODE" } else { Write-Ok 'install 完成' }
    } finally {
      Pop-Location
    }
  }
}

# ---------------------------------------------------------------- 4. 校验

Write-Step '校验'
$linkPath = Join-Path $ProfileDir "node_modules\$pluginName"
if (Test-Path -LiteralPath $linkPath) {
  $item = Get-Item -LiteralPath $linkPath -Force
  Write-Ok "node_modules/$pluginName 已就位（$($item.LinkType) -> $($item.Target)）"
} else {
  Write-Warn2 "node_modules/$pluginName 还不存在——请用 DSH 插件管理器安装，或手动跑 pnpm install。"
}

$verify = Get-Content -LiteralPath $profilePackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Ok "bundles: $($verify.dsh.profile.bundles -join ', ')"

Write-Host ''
Write-Host '全部就绪。请重启 DSH，侧边栏会出现「幼儿园计划」。' -ForegroundColor Green
