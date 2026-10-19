# Submits the Quantm manifests to microsoft/winget-pkgs with Microsoft's wingetcreate tool.
# The first run asks you to sign in to GitHub in your browser.
$manifest = Join-Path $PSScriptRoot 'manifests\d\drumplayer1234\Quantm\1.1.0'
wingetcreate submit --prtitle 'New package: drumplayer1234.Quantm version 1.1.0' $manifest
