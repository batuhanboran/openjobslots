Option Explicit

Dim shell
Dim filesystem
Dim scriptDirectory
Dim trayScriptPath
Dim powershellPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set filesystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = filesystem.GetParentFolderName(WScript.ScriptFullName)
trayScriptPath = filesystem.BuildPath(scriptDirectory, "backend-tray.ps1")

If Not filesystem.FileExists(trayScriptPath) Then
  WScript.Quit 0
End If

powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Len(powershellPath) = 0 Or powershellPath = "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" Then
  powershellPath = "powershell.exe"
End If

command = """" & powershellPath & """ -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & trayScriptPath & """"
shell.Run command, 0, False
