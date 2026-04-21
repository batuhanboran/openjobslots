Option Explicit

Dim shell
Dim filesystem
Dim scriptDirectory
Dim trayScriptPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set filesystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = filesystem.GetParentFolderName(WScript.ScriptFullName)
trayScriptPath = filesystem.BuildPath(scriptDirectory, "backend-tray.ps1")

If Not filesystem.FileExists(trayScriptPath) Then
  WScript.Quit 0
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & trayScriptPath & """"
shell.Run command, 0, False
