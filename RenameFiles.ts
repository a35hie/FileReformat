import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

type Format = 'pascal' | 'snake' | 'dash' | 'camel' | 'screaming'

interface RenameOperation {
  directory: string
  oldName: string
  newName: string
}

interface SavedTask {
  version: 2
  directory: string
  format: Format
  operations: RenameOperation[]
}

const LAST_TASK_FILE = path.join(import.meta.dir, 'LastTask.json')

const FORMATS = new Set<Format>([
  'pascal',
  'snake',
  'dash',
  'camel',
  'screaming',
])

const EXTENSION_MAP: Record<string, string> = {
  '.jpg': '.jpeg',
  '.jpeg': '.jpeg',
  '.png': '.png',
  '.gif': '.gif',
  '.tif': '.tiff',
  '.tiff': '.tiff',
  '.bmp': '.bmp',
}

function usage(): never {
  console.error(`
Usage:
  bun RenameFiles.ts <folder> --show [--format=pascal|snake|dash|camel|screaming]
  bun RenameFiles.ts <folder> --rename [--format=pascal|snake|dash|camel|screaming]
  bun RenameFiles.ts <folder> --rename --yes [--format=...]
  bun RenameFiles.ts --continue
  bun RenameFiles.ts --continue --yes

Options:
  --show       Preview the changes without renaming
  --rename     Rename files
  --continue   Rename the exact operations from the previous preview
  --yes        Skip confirmation
  --format     Output naming format (default: pascal)
`)

  process.exit(1)
}

function parseArgs() {
  const args = process.argv.slice(2)

  const continueTask = args.includes('--continue')
  const rename = args.includes('--rename')
  const show = args.includes('--show')
  const yes = args.includes('--yes')

  if (rename && show) {
    console.error('Error: --show and --rename cannot be used together.')
    process.exit(1)
  }

  const formatArg = args.find((arg: string) => arg.startsWith('--format='))

  const format = (formatArg?.slice('--format='.length).toLowerCase() ||
    'pascal') as Format

  if (!FORMATS.has(format)) {
    console.error(`Error: unknown format "${format}".`)
    process.exit(1)
  }

  const folder = args.find(
    (arg: string) => !arg.startsWith('--') && arg !== formatArg
  )

  return {
    folder,
    continueTask,
    mode: rename ? '--rename' : show ? '--show' : undefined,
    format,
    yes,
  }
}

/**
 * Split a filename into semantic words.
 *
 * Handles:
 *
 *   hello-world
 *   hello_world
 *   hello.world
 *   hello world
 *   helloWorld
 *   HelloWorld
 *   XMLParser
 *   HTTPServer
 *   parser2D
 *   version2File
 *   foo (copy)
 *
 * Examples:
 *
 *   "myXMLParser2D" -> ["my", "xml", "parser", "2", "d"]
 *   "HTTPServer"    -> ["http", "server"]
 *   "helloWorld"    -> ["hello", "world"]
 */
function splitWords(input: string): string[] {
  return input
    .normalize("NFKC")
    .replace(/['’`]/gu, "")
    // XMLParser -> XML Parser
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    // helloWorld -> hello World
    .replace(/(\p{Ll}|\p{Nd})(\p{Lu})/gu, "$1 $2")
    // file2 -> file 2
    .replace(/(\p{L})(\p{Nd})/gu, "$1 $2")
    .replace(/(\p{Nd})(\p{L})/gu, "$1 $2")
    // Common filename separators
    .replace(/[\s_.\-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function capitalize(word: string): string {
  return word.length === 0 ? '' : word[0].toUpperCase() + word.slice(1)
}

function toPascalCase(name: string): string {
  return splitWords(name).map(capitalize).join('')
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name)

  return pascal.length === 0 ? '' : pascal[0].toLowerCase() + pascal.slice(1)
}

function toSnakeCase(name: string): string {
  return splitWords(name).join('_')
}

function toDashCase(name: string): string {
  return splitWords(name).join('-')
}

function toScreamingCase(name: string): string {
  return splitWords(name)
    .map((word) => word.toUpperCase())
    .join('_')
}

function normalizeExtension(extension: string): string {
  if (!extension) return ''

  const lower = extension.toLowerCase()

  return EXTENSION_MAP[lower] ?? lower
}

function formatBaseName(name: string, format: Format): string {
  switch (format) {
    case 'snake':
      return toSnakeCase(name)

    case 'dash':
      return toDashCase(name)

    case 'camel':
      return toCamelCase(name)

    case 'screaming':
      return toScreamingCase(name)

    case 'pascal':
      return toPascalCase(name)
  }
}

function formatFilename(filename: string, format: Format): string {
  const extension = path.extname(filename)
  const base = path.basename(filename, extension)

  const formatted = formatBaseName(base, format)
  const normalizedExtension = normalizeExtension(extension)

  // Don't create files with an empty name.
  if (!formatted) {
    return filename
  }

  return `${formatted}${normalizedExtension}`
}

/**
 * Recursively collect files.
 *
 * Hidden files/directories are ignored.
 * Symlinks are ignored to prevent accidental traversal outside the folder.
 */
function walkDirectory(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, {
    withFileTypes: true,
  })) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const fullPath = path.join(directory, entry.name)

    if (entry.isSymbolicLink()) {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath))
      continue
    }

    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

function buildPlan(files: string[], format: Format): RenameOperation[] {
  const operations: RenameOperation[] = []

  for (const file of files) {
    const directory = path.dirname(file)
    const oldName = path.basename(file)
    const newName = formatFilename(oldName, format)

    if (oldName === newName) {
      continue
    }

    operations.push({
      directory,
      oldName,
      newName,
    })
  }

  return operations
}

/**
 * Validate the entire rename plan before touching the filesystem.
 *
 * This catches:
 *
 *   file A -> file B where B already exists
 *   file A -> file B
 *   file C -> file B
 *
 * and rename cycles such as:
 *
 *   foo -> bar
 *   bar -> foo
 */
function validatePlan(operations: RenameOperation[]): void {
  const destinations = new Map<string, RenameOperation>()
  const sources = new Set<string>()

  for (const operation of operations) {
    const source = path.join(operation.directory, operation.oldName)
    const destination = path.join(operation.directory, operation.newName)

    sources.add(path.resolve(source))

    const existing = destinations.get(path.resolve(destination))

    if (existing) {
      throw new Error(
        [
          'Rename collision detected:',
          `  ${path.join(existing.directory, existing.oldName)} -> ${existing.newName}`,
          `  ${source} -> ${operation.newName}`,
        ].join('\n')
      )
    }

    destinations.set(path.resolve(destination), operation)
  }

  for (const operation of operations) {
    const destination = path.join(operation.directory, operation.newName)

    if (!existsSync(destination)) {
      continue
    }

    const resolvedDestination = path.resolve(destination)

    // It's okay if the destination is itself being renamed away.
    if (sources.has(resolvedDestination)) {
      continue
    }

    throw new Error(`Destination already exists:\n  ${destination}`)
  }
}

/**
 * Rename through temporary filenames first.
 *
 * This makes swaps and chains safe:
 *
 *   a -> b
 *   b -> a
 *
 * Without this, the first rename could destroy the second source.
 */
function executePlan(operations: RenameOperation[]): void {
  if (operations.length === 0) {
    return
  }

  const temporaryOperations: {
    tempPath: string
    finalPath: string
  }[] = []

  // Phase 1: move everything to unique temporary names.
  for (const operation of operations) {
    const oldPath = path.join(operation.directory, operation.oldName)

    const finalPath = path.join(operation.directory, operation.newName)

    const tempPath = path.join(
      operation.directory,
      `.rename-tmp-${process.pid}-${crypto.randomUUID()}`
    )

    renameSync(oldPath, tempPath)

    temporaryOperations.push({
      tempPath,
      finalPath,
    })

    console.log(`Prepared: ${oldPath} -> ${operation.newName}`)
  }

  // Phase 2: move temporary names to final names.
  try {
    for (const operation of temporaryOperations) {
      renameSync(operation.tempPath, operation.finalPath)

      console.log(`Renamed: ${operation.finalPath}`)
    }
  } catch (error) {
    console.error('\nA rename failed while applying the final names.')

    console.error(
      'Temporary files may remain. They are intentionally not deleted.'
    )

    throw error
  }
}

function saveTask(
  directory: string,
  format: Format,
  operations: RenameOperation[]
): void {
  const task: SavedTask = {
    version: 2,
    directory,
    format,
    operations,
  }

  writeFileSync(LAST_TASK_FILE, JSON.stringify(task, null, 2), 'utf8')
}

function loadTask(): SavedTask {
  if (!existsSync(LAST_TASK_FILE)) {
    throw new Error(`No ${path.basename(LAST_TASK_FILE)} found to continue.`)
  }

  let task: SavedTask

  try {
    task = JSON.parse(readFileSync(LAST_TASK_FILE, 'utf8'))
  } catch {
    throw new Error(`${path.basename(LAST_TASK_FILE)} is not valid JSON.`)
  }

  if (task.version !== 2 || !Array.isArray(task.operations)) {
    throw new Error(
      `${path.basename(LAST_TASK_FILE)} is from an unsupported task format.`
    )
  }

  return task
}

function printPlan(operations: RenameOperation[]): void {
  if (operations.length === 0) {
    console.log('No files need renaming.')
    return
  }

  let currentDirectory: string | undefined

  for (const operation of operations) {
    if (operation.directory !== currentDirectory) {
      currentDirectory = operation.directory

      console.log(`\ndirectory: ${currentDirectory}`)
    }

    console.log(`  ${operation.oldName} → ${operation.newName}`)
  }

  console.log()
  console.log(
    `${operations.length} file${operations.length === 1 ? '' : 's'} will be renamed.`
  )
}

function confirm(): boolean {
  if (!process.stdin.isTTY) {
    return false
  }

  process.stdout.write('Confirm? (y/N): ')

  const answer = prompt('')?.trim().toLowerCase()

  return answer === 'y' || answer === 'yes'
}

function main(): void {
  const { folder, continueTask, mode, format, yes } = parseArgs()

  if (continueTask) {
    const task = loadTask()

    console.log(`Continuing previous task in: ${task.directory}`)

    console.log(`Format: ${task.format}`)

    console.log()

    printPlan(task.operations)

    if (task.operations.length === 0) {
      rmSync(LAST_TASK_FILE, { force: true })
      return
    }

    validatePlan(task.operations)

    if (!yes && !confirm()) {
      console.log('Aborted.')
      return
    }

    executePlan(task.operations)

    rmSync(LAST_TASK_FILE, { force: true })

    console.log('\n✨ All done!')
    return
  }

  if (!folder || !mode) {
    usage()
  }

  const absoluteFolder = path.resolve(folder)

  if (!existsSync(absoluteFolder)) {
    console.error(`Error: folder does not exist:\n  ${absoluteFolder}`)

    process.exit(1)
  }

  if (!statSync(absoluteFolder).isDirectory()) {
    console.error(`Error: not a directory:\n  ${absoluteFolder}`)

    process.exit(1)
  }

  const files = walkDirectory(absoluteFolder)
  const operations = buildPlan(files, format)

  console.log(`Found ${files.length} file${files.length === 1 ? '' : 's'}.`)

  console.log(`Format: ${format}`)

  printPlan(operations)

  if (mode === '--show') {
    validatePlan(operations)

    saveTask(absoluteFolder, format, operations)

    console.log(`Preview saved to ${path.basename(LAST_TASK_FILE)}.`)

    console.log(`Run "bun RenameFiles.ts --continue" to apply it.`)

    return
  }

  validatePlan(operations)

  if (operations.length === 0) {
    console.log('Nothing to rename.')
    return
  }

  if (!yes && !confirm()) {
    console.log('Aborted.')
    return
  }

  executePlan(operations)

  // If an old preview exists, it has now been superseded.
  rmSync(LAST_TASK_FILE, { force: true })

  console.log('\n✓ All done!')
}

try {
  main()
} catch (error) {
  console.error(`\n× ${error instanceof Error ? error.message : String(error)}`)

  process.exit(1)
}
