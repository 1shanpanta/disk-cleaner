import { NextResponse } from "next/server"
import { execSync } from "child_process"
import { homedir, platform } from "os"
import { join } from "path"

const IS_WIN = platform() === "win32"
const IS_MAC = platform() === "darwin"

function getDeleteCommand(targetPath: string): string {
  if (IS_WIN) return `rmdir /s /q "${targetPath}"`
  return `rm -rf "${targetPath}"`
}

function getElevatedDeleteCommand(targetPath: string): string {
  if (IS_WIN) return `runas /user:Administrator "rmdir /s /q \\"${targetPath}\\""`
  return `sudo rm -rf "${targetPath}"`
}

export async function POST(request: Request) {
  const { path: targetPath } = await request.json()

  if (!targetPath || typeof targetPath !== "string") {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 })
  }

  // Prevent path traversal
  if (targetPath.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 })
  }

  const home = homedir()
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

  if (protectedPaths.includes(targetPath)) {
    return NextResponse.json(
      { error: "Cannot delete protected path" },
      { status: 403 }
    )
  }

  // Check if path needs elevation
  const systemPaths = IS_WIN
    ? ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)"]
    : ["/usr/local/", "/opt/", "/Library/", "/usr/", "/etc/", "/var/"]

  if (systemPaths.some((p) => targetPath.startsWith(p))) {
    return NextResponse.json(
      {
        error: "Path requires elevated permissions",
        sudoCommand: getElevatedDeleteCommand(targetPath),
      },
      { status: 403 }
    )
  }

  // Must be within home directory
  if (!targetPath.startsWith(home)) {
    return NextResponse.json(
      {
        error: "Path is outside home directory",
        sudoCommand: getElevatedDeleteCommand(targetPath),
      },
      { status: 403 }
    )
  }

  try {
    execSync(getDeleteCommand(targetPath), { timeout: 120000 })
    return NextResponse.json({ success: true, deleted: targetPath })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to delete",
        details: String(error),
        sudoCommand: getElevatedDeleteCommand(targetPath),
      },
      { status: 500 }
    )
  }
}
