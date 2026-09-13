# FileReformat
FileReformat is a recursive file renaming utility that helps you **slay your messy file names**. 
It converts them into consistent formats, normalizes extensions, and gives you a preview before renaming anything.

## Features

```sh
bun run RenameFiles.ts <directory-to-rename>
```

- Convert file names to different formats: `[--format=pascal|snake|dash|camel|screaming]`
  - `pascal` (default) → `MyFileName.txt`
  - `camel` → `myFileName.txt`
  - `snake` → `my_file_name.txt`
  - `dash` → `my-file-name.txt`
  - `screaming` → `MY_FILE_NAME.TXT`
- Normalizes file extensions by default (`JPG → jpeg`, `PNG → png`, etc.)
- Ignore dotfiles/folders to keep them safe (`.gitignore`, `.idea`)
- Preview changes before renaming: `--show`
  - Also saves a `LastTask.json` in the script directory for continuation
- Rename files recursively: `--rename`
- Continue a previous task (--continue)
  - Reads `LastTask.json`, prompts for confirmation, renames files, then deletes the JSON

## Installation
Make sure you have [Bun](https://bun.sh/) installed.

```sh
git clone https://github.com/a35hie/FileReformat
cd FileReformat
bun i
```
