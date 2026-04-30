Option Explicit

Dim shell
Dim filesystem
Dim scriptDirectory
Dim appDirectory
Dim openJobSlotsPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set filesystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = filesystem.GetParentFolderName(WScript.ScriptFullName)
appDirectory = filesystem.GetParentFolderName(scriptDirectory)
openJobSlotsPath = filesystem.BuildPath(appDirectory, "openjobslots.exe")

If Not filesystem.FileExists(openJobSlotsPath) Then
  WScript.Quit 0
End If

command = """" & openJobSlotsPath & """ --backend-startup"
shell.Run command, 0, False
