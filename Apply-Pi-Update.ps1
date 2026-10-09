[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$Repository = 'D:\EZPlayer')
$ErrorActionPreference = 'Stop'
if (!(Test-Path (Join-Path $Repository '.git'))) { throw 'Choose the EZPlayer GitHub repository folder.' }
$Repository = (Resolve-Path $Repository).Path
$files = @(
    '.github/workflows/pi-build.yml',
    'apps/ezplayer-ui-electron/main.ts',
    'apps/ezplayer-ui-electron/mainsrc/data/pi-import-files.test.ts',
    'apps/ezplayer-ui-electron/mainsrc/data/pi-import-files.ts',
    'apps/ezplayer-ui-electron/mainsrc/ipcezplayer.ts',
    'apps/ezplayer-ui-electron/mainsrc/pi-client.ts',
    'apps/ezplayer-ui-electron/mainsrc/piSystem.ts',
    'apps/ezplayer-ui-electron/mainsrc/workers/pi-api.test.ts',
    'apps/ezplayer-ui-electron/mainsrc/workers/pi-api.ts',
    'apps/ezplayer-ui-electron/mainsrc/workers/pi-registration.test.ts',
    'apps/ezplayer-ui-electron/mainsrc/workers/server-worker.ts',
    'apps/ezplayer-ui-electron/showfolder.ts',
    'apps/ezplayer-ui-electron/src/components/PiSettings.tsx',
    'apps/ezplayer-ui-electron/src/components/piRegistration.ts',
    'apps/ezplayer-ui-electron/src/modules/Welcome/WelcomeScreen.tsx',
    'apps/ezplayer-ui-embedded/src/router/router.tsx',
    'packages/player-ui-components/src/components/playback-settings/SettingsDrawer.tsx',
    'packages/player-ui-components/src/components/song/SongList.tsx',
    'pi-appliance/PI-SETTINGS-UPDATE.md',
    'pi-appliance/README.md',
    'pi-appliance/TETHERING.md',
    'pi-appliance/ezplayer-pi.service',
    'pi-appliance/ezplayer-setup-portal.service',
    'pi-appliance/initialize_show.py',
    'pi-appliance/install-pi.sh',
    'pi-appliance/pi_clock.py',
    'pi-appliance/pi_hotspot.py',
    'pi-appliance/pi_service.py',
    'pi-appliance/prepare-pi-gen.sh',
    'pi-appliance/setup_portal.py',
    'pi-appliance/tests/test_clock.py',
    'pi-appliance/tests/test_hotspot.py',
    'pi-appliance/tests/test_initialize_show.py',
    'pi-appliance/tests/test_pi_service.py'
)
foreach ($relative in $files) {
    $source = Join-Path $PSScriptRoot $relative
    $destination = Join-Path $Repository $relative
    if (!(Test-Path $source)) { throw "Update file missing: $relative" }
    if ([IO.Path]::GetFullPath($source) -ne [IO.Path]::GetFullPath($destination) -and $PSCmdlet.ShouldProcess($destination, 'Copy update file')) {
        New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}
$retired = @(
    'apps/ezplayer-ui-electron/mainsrc/data/pi-show-folder.ts',
    'apps/ezplayer-ui-electron/mainsrc/data/pi-show-folder.test.ts'
)
foreach ($relative in $retired) {
    $destination = Join-Path $Repository $relative
    if ((Test-Path $destination) -and $PSCmdlet.ShouldProcess($destination, 'Remove retired Pi show-folder helper')) {
        Remove-Item -LiteralPath $destination
    }
}
Write-Host 'Update applied. Review Changes in GitHub Desktop, then commit and Push origin.'
