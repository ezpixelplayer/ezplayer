# EZPlayer Pi upload fix

Apply this source update to the existing codex/ezplayer-pi-appliance branch in D:\EZPlayer. It includes the previous Pi file-copy integration used by the installed Pi settings build.

1. Extract this ZIP into a separate folder.
2. Run Apply-Upload-Fix.ps1 from that folder. If Windows blocks script execution, open PowerShell there and run:

   powershell -ExecutionPolicy Bypass -File .\Apply-Upload-Fix.ps1

3. In GitHub Desktop, review the changes and commit with summary:

   Fix Pi song uploads and add upload progress

4. Push origin. Wait for the Pi ARM64 Build to finish, download its new artifact, and install it on the Pi with EZPlayer stopped. This ZIP contains source changes, not a Pi installer.

## Behavior

- In the local browser interface, Add Song keeps selected files on your computer until Save. Audio, video, and FSEQ files can be selected independently. Save uploads all selected files before committing the song.
- Edit Song also uploads replacements on Save, so you can add another file later without reselecting every file.
- A progress window reports uploaded bytes and remains open until the player finishes saving/importing. Failed uploads keep the dialog open and do not commit an incomplete song record.
- Bulk upload accepts audio-only, video-only, FSEQ-only, or mixed selections. Media-only files are saved on the player and can be selected with On player in Add/Edit Song.
- FSEQs that reference Windows media paths now match the media filename on Linux correctly. Musical FSEQs can be saved before their audio arrives. A later bulk upload attaches exact matching audio to existing local sequences without changing IDs or user settings. Unrelated filenames do not match. You can choose audio manually in Edit Song when filenames differ.
- An audio/video-only song can be saved for later editing. The existing light-playback flow still requires an FSEQ. This change adds video upload/selection; it does not add a new video playback engine.
- Upload filenames must be unique within a bulk/folder selection. Files remain in the player's show folder.
- These uploads use the existing local/LAN file API. Cloud file uploading is not enabled by this update.

## Validation

29 targeted tests passed, covering independent upload order, Windows path matching, preservation of IDs/settings, video-only upload, Save-only transfer, upload failure, progress completion, streaming, and Pi file copying. Electron main and embedded TypeScript checks passed. Shared UI and both desktop/embedded production UI builds passed. This source revision has not yet been built or tested on the physical Pi.
