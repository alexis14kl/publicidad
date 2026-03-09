Set shell = CreateObject("WScript.Shell")
projectRoot = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
launcher = Chr(34) & projectRoot & "\iniciar_poller_background.bat" & Chr(34)
shell.Run launcher, 0, False
