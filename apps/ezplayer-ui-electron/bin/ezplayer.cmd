@echo off
rem ---------------------------------------------------------------------------
rem Console entry point for EZPlayer's text-only commands on Windows.
rem
rem EZPlayer.exe is a GUI-subsystem binary, so when cmd.exe launches it directly
rem the shell does not wait for it, and Electron stdio handling leaves standard
rem input unreadable - the interactive prompt and --stdin both hit end-of-input
rem immediately.
rem
rem ELECTRON_RUN_AS_NODE makes the very same binary behave as plain Node, which
rem skips that stdio handling and inherits the console normally. Running it from
rem a batch file means cmd waits for it and reports its exit code, so this
rem behaves like any ordinary console program. No second runtime is shipped.
rem
rem   ezplayer shell --show-folder "D:\Shows\MyShow" --password-file secret.txt
rem   ezplayer discover --networks 192.168.1.0/24
rem
rem KEEP THIS FILE CRLF AND ASCII-ONLY. cmd.exe mis-parses LF-only batch files.
rem ---------------------------------------------------------------------------
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0EZPlayer.exe" "%~dp0resources\app.asar\dist\cli.js" %*
rem endlocal resets ERRORLEVEL, so capture it first and propagate on one line.
set EZP_EXIT=%ERRORLEVEL%
endlocal & exit /b %EZP_EXIT%
