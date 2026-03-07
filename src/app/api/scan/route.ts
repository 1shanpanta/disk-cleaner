import { NextResponse } from "next/server"
import { exec, execSync } from "child_process"
import { homedir, platform } from "os"
import { join, sep, basename } from "path"
import { readdirSync, statSync } from "fs"
import { promisify } from "util"

const execAsync = promisify(exec)

export interface DiskItem {
  path: string
  size: string
  sizeBytes: number
  type: "directory" | "file"
  deletable: boolean
  needsSudo: boolean
  description: string
}

const IS_WIN = platform() === "win32"
const IS_MAC = platform() === "darwin"

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1) + " TB"
  if (bytes >= 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB"
  return bytes + " B"
}

function getDescription(itemPath: string): string {
  const descriptions: Record<string, string> = {
    "Library/Developer/CoreSimulator": "iOS Simulator runtimes & data",
    "Library/Developer/Xcode": "Xcode derived data & archives",
    "Library/Developer": "Developer tools (Xcode, Simulators)",
    "Library/Containers/com.docker.docker": "Docker images & volumes",
    "Library/Containers": "App containers (Docker, etc.)",
    "Library/Caches": "Application caches",
    "Library/Application Support": "App data (Cursor, Arc, etc.)",
    "Library/Android": "Android SDK",
    "Library/pnpm": "pnpm package store",
    Library: "macOS Library folder",
    AppData: "Windows application data",
    "AppData/Local": "Local app data & caches",
    "AppData/Roaming": "Roaming app data",
    "AppData/Local/Temp": "Temporary files",
    ".local/share": "Application data",
    ".local/share/Trash": "Trash bin",
    Desktop: "Desktop files",
    Documents: "Documents",
    Downloads: "Downloads folder",
    ".cache": "General caches (uv, pip, etc.)",
    ".android": "Android SDK & emulator data",
    ".gradle": "Gradle build cache",
    ".bun": "Bun package cache",
    ".ollama": "Ollama AI models",
    ".lmstudio": "LM Studio models",
    ".cursor": "Cursor editor data",
    ".rustup": "Rust toolchains",
    ".expo": "Expo/React Native cache",
    ".npm": "npm package cache",
    ".nvm": "Node.js versions",
    ".yarn": "Yarn package data",
    ".cargo": "Rust packages",
    ".docker": "Docker config",
    ".vscode": "VS Code extensions & data",
    node_modules: "Node.js dependencies",
  }

  const home = homedir()
  const relative = itemPath.replace(home + sep, "").replace(/\\/g, "/")

  for (const [key, desc] of Object.entries(descriptions)) {
    if (relative === key) return desc
  }

  return basename(itemPath)
}

function needsElevation(itemPath: string): boolean {
  const home = homedir()
  // Anything inside home directory doesn't need sudo
  if (itemPath.startsWith(home + sep)) return false
  // Everything else at root level needs sudo
  return true
}

function isDeletable(itemPath: string): boolean {
  const home = homedir()

  // System-critical paths that should never be deleted
  const systemCritical = [
    "/",
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/cores",
    "/dev",
    "/etc",
    "/private",
    "/tmp",
    "/var",
    "/Users",
    "/Volumes",
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ]
  if (systemCritical.includes(itemPath)) return false

  // Protected user paths
  const protectedPaths = [
    home,
    join(home, "Desktop"),
    join(home, "Documents"),
    join(home, "Downloads"),
    join(home, ".claude"),
    join(home, ".config"),
    join(home, ".ssh"),
  ]
  if (IS_MAC) protectedPaths.push(join(home, "Library"))
  if (IS_WIN) protectedPaths.push(join(home, "AppData"))

  return !protectedPaths.includes(itemPath)
}

async function getDirSize(dirPath: string, timeoutMs: number = 5000): Promise<number> {
  try {
    if (IS_WIN) {
      const { stdout } = await execAsync(
        `powershell -Command "(Get-ChildItem -Path '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { timeout: timeoutMs }
      )
      return parseInt(stdout.trim()) || 0
    }

    const { stdout } = await execAsync(`du -s -k "${dirPath}" 2>/dev/null`, {
      timeout: timeoutMs,
    })
    const match = stdout.match(/^(\d+)/)
    return match ? parseInt(match[1]) * 1024 : 0
  } catch {
    // Timed out or error — estimate from stat
    try {
      const stat = statSync(dirPath)
      return stat.size || 0
    } catch {
      return 0
    }
  }
}

async function scanDirectory(scanPath: string): Promise<DiskItem[]> {
  let entries: string[]
  try {
    entries = readdirSync(scanPath)
  } catch {
    return []
  }

  const fullPaths = entries.map((name) => join(scanPath, name))

  // Run du in parallel for all entries with a per-item timeout
  const sizePromises = fullPaths.map(async (itemPath) => {
    let isDir = false
    try {
      const stat = statSync(itemPath)
      isDir = stat.isDirectory()
      if (!isDir) {
        return { path: itemPath, sizeBytes: stat.size, isDir }
      }
    } catch {
      return { path: itemPath, sizeBytes: 0, isDir: false }
    }

    const sizeBytes = await getDirSize(itemPath)
    return { path: itemPath, sizeBytes, isDir }
  })

  const results = await Promise.all(sizePromises)

  return results
    .filter((r) => r.sizeBytes > 0)
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 40)
    .map((r) => ({
      path: r.path,
      size: formatBytes(r.sizeBytes),
      sizeBytes: r.sizeBytes,
      type: r.isDir ? ("directory" as const) : ("file" as const),
      deletable: isDeletable(r.path),
      needsSudo: needsElevation(r.path),
      description: getDescription(r.path),
    }))
}

function getDiskInfo(): {
  total: string
  used: string
  available: string
  capacity: string
} {
  try {
    if (IS_WIN) {
      const output = execSync(
        `powershell -Command "(Get-PSDrive C).Used, (Get-PSDrive C).Free"`,
        { timeout: 10000 }
      )
        .toString()
        .trim()
        .split("\n")
      const used = parseInt(output[0]) || 0
      const free = parseInt(output[1]) || 0
      const total = used + free
      const capacity = total > 0 ? Math.round((used / total) * 100) : 0
      return {
        total: formatBytes(total),
        used: formatBytes(used),
        available: formatBytes(free),
        capacity: `${capacity}%`,
      }
    }

    // Use df with 1K blocks for raw bytes, then format ourselves
    const dfOutput = execSync(
      IS_MAC
        ? "df -k /System/Volumes/Data 2>/dev/null || df -k / 2>/dev/null"
        : "df -k / 2>/dev/null"
    )
      .toString()
      .split("\n")[1]
    const parts = dfOutput?.trim().split(/\s+/) || []
    const totalKb = parseInt(parts[1]) || 0
    const usedKb = parseInt(parts[2]) || 0
    const availKb = parseInt(parts[3]) || 0
    const capacity = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0

    return {
      total: formatBytes(totalKb * 1024),
      used: formatBytes(usedKb * 1024),
      available: formatBytes(availKb * 1024),
      capacity: `${capacity}%`,
    }
  } catch {
    return {
      total: "unknown",
      used: "unknown",
      available: "unknown",
      capacity: "unknown",
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawPath = searchParams.get("path") || "/"
  const scanPath = rawPath === "HOME" ? homedir() : rawPath

  try {
    const items = await scanDirectory(scanPath)
    const disk = getDiskInfo()

    return NextResponse.json({
      items,
      disk,
      scanPath,
      platform: platform(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to scan disk", details: String(error) },
      { status: 500 }
    )
  }
}
