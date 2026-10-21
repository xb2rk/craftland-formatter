# Package the explicit v5 runtime for local VS Code installation without npm.
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$packageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$extensionRoot = Join-Path $packageRoot 'extension'
$metadata = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
$distRoot = Join-Path $extensionRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'extension.cjs'))) {
  throw 'Build the extension runtime before packaging.'
}

$target = Join-Path $extensionRoot ($metadata.name + '-' + $metadata.version + '.vsix')
if (Test-Path -LiteralPath $target) {
  if ($Force) {
    Remove-Item -LiteralPath $target -Force
  } else {
    throw "VSIX already exists: $target. Run with -Force to overwrite."
  }
}

function Escape-Xml([string] $value) {
  return [System.Security.SecurityElement]::Escape($value)
}

$identity = Escape-Xml $metadata.name
$version = Escape-Xml $metadata.version
$publisher = Escape-Xml $metadata.publisher
$displayName = Escape-Xml $metadata.displayName
$description = Escape-Xml $metadata.description
$engine = Escape-Xml $metadata.engines.vscode
$categories = Escape-Xml ($metadata.categories -join ',')
$iconMeta = if ($metadata.icon) { "    <Icon>extension/$($metadata.icon)</Icon>`n" } else { "" }
$iconAsset = if ($metadata.icon) { "    <Asset Type=`"Microsoft.VisualStudio.Services.Icons.Default`" Path=`"extension/$($metadata.icon)`" Addressable=`"true`" />`n" } else { "" }

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$identity" Version="$version" Publisher="$publisher" />
    <DisplayName>$displayName</DisplayName>
    <Description xml:space="preserve">$description</Description>
$iconMeta    <Tags>ffugclanguage,__ext_fcg,__ext_fcc</Tags>
    <Categories>$categories</Categories>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="$engine" /></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/dist/docs/CHANGELOG.md" Addressable="true" />
$iconAsset  </Assets>
</PackageManifest>
"@

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".cjs" ContentType="application/javascript" />
  <Default Extension=".mjs" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
</Types>
'@

$archive = [System.IO.Compression.ZipFile]::Open($target, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in @(
    @{ Name = 'extension.vsixmanifest'; Value = $manifest },
    @{ Name = '[Content_Types].xml'; Value = $contentTypes }
  )) {
    $entry = $archive.CreateEntry($item.Name)
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $writer.Write($item.Value) } finally { $writer.Dispose() }
  }

  $resourceFiles = if (Test-Path -LiteralPath (Join-Path $extensionRoot 'resources')) {
    Get-ChildItem -LiteralPath (Join-Path $extensionRoot 'resources') -Recurse -File | ForEach-Object FullName
  } else { @() }

  $files = @(
    Join-Path $extensionRoot 'package.json'
    Join-Path $extensionRoot 'README.md'
  ) + $resourceFiles + @(Get-ChildItem -LiteralPath $distRoot -Recurse -File | ForEach-Object FullName)

  foreach ($file in $files) {
    $relative = [System.IO.Path]::GetRelativePath($extensionRoot, $file).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $file, ('extension/' + $relative), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }

} finally {
  $archive.Dispose()
}

Write-Output "Packaged $target"
