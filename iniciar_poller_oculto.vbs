Set shell = CreateObject("WScript.Shell")
projectRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
q = Chr(34)
cmd = "cmd.exe /c " & q & "set NO_PAUSE=1 && call " & q & q & projectRoot & "\iniciar_poller.bat" & q & q & q
shell.Run cmd, 0, False
