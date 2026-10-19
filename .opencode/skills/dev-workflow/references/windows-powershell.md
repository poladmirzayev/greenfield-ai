# Windows and PowerShell 5

| Pitfall | Instead |
|---|---|
| `&&` is not a separator | `;` |
| `Join-String` doesn't exist | `-join` |
| `Out-File` / `>` writes a BOM or UTF-16 | Write via Node or `[IO.File]::WriteAllText` (UTF-8, no BOM). `[IO.File]` uses the process dir, not `cd`: pass full paths |
| git `CRLF` warnings | Ignore (`.gitattributes` normalises to LF) |
| `gh api --jq` with spaces breaks | Pipe to `node -e` and parse the JSON |
| `gh` not on `PATH` | Add `%LOCALAPPDATA%\Microsoft\WinGet\Packages\GitHub.cli_*\bin` (`$env:PATH = "<folder>;$env:PATH"`) or set `$env:GH` (the board tool honours it) |
| `git worktree remove`: `Filename too long` | See `worktrees.md` |
| Garbled text in a posted comment | ASCII only, write with `[IO.File]::WriteAllText`, read the comment back |
| `R` is an alias for `Invoke-History` | Don't name helper functions `R` |
