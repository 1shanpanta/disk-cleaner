"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  HardDrive,
  Trash2,
  RefreshCw,
  FolderOpen,
  ArrowLeft,
  Terminal,
  Copy,
  Check,
  Shield,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Square,
  CheckSquare,
  ChevronDown,
  Home,
  Monitor,
  Database,
  Folder,
} from "lucide-react"

interface DiskItem {
  path: string
  size: string
  sizeBytes: number
  type: string
  deletable: boolean
  needsSudo: boolean
  description: string
}

interface DiskInfo {
  total: string
  used: string
  available: string
  capacity: string
}

interface ScanResult {
  items: DiskItem[]
  disk: DiskInfo
  scanPath: string
  platform: string
}

const SCAN_TIPS = [
  "Analyzing folder sizes...",
  "Calculating disk usage...",
  "Reading directory tree...",
  "Measuring space consumption...",
  "Almost there, crunching numbers...",
]

function formatTotalSize(items: DiskItem[]): string {
  const total = items.reduce((sum, i) => sum + i.sizeBytes, 0)
  if (total >= 1024 * 1024 * 1024)
    return (total / (1024 * 1024 * 1024)).toFixed(1) + " GB"
  if (total >= 1024 * 1024)
    return (total / (1024 * 1024)).toFixed(1) + " MB"
  return (total / 1024).toFixed(1) + " KB"
}

export default function DiskCleaner() {
  const [data, setData] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanTip, setScanTip] = useState(SCAN_TIPS[0])
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [pathHistory, setPathHistory] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDialog, setConfirmDialog] = useState<DiskItem | null>(null)
  const [bulkConfirmDialog, setBulkConfirmDialog] = useState(false)
  const [sudoDialog, setSudoDialog] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pathDropdownOpen, setPathDropdownOpen] = useState(false)
  const [customPath, setCustomPath] = useState("")
  const progressInterval = useRef<NodeJS.Timeout | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const quickPaths = [
    { label: "Root (/)", path: "/", icon: Monitor },
    { label: "Home (~)", path: "HOME", icon: Home },
    { label: "Applications", path: "/Applications", icon: Folder },
    { label: "Library", path: "/Library", icon: Database },
    { label: "Users", path: "/Users", icon: Folder },
    { label: "Volumes", path: "/Volumes", icon: HardDrive },
  ]

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPathDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const startProgress = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current)
    }
    setScanProgress(0)
    setScanTip(SCAN_TIPS[0])
    let tipIndex = 0

    progressInterval.current = setInterval(() => {
      setScanProgress((prev) => {
        // Always move forward, slow down as it approaches 90
        const remaining = 90 - prev
        const step = Math.max(remaining * 0.08, 0.5)
        const next = Math.min(prev + step, 90)

        const newTipIndex = Math.min(
          Math.floor(next / 20),
          SCAN_TIPS.length - 1
        )
        if (newTipIndex !== tipIndex) {
          tipIndex = newTipIndex
          setScanTip(SCAN_TIPS[tipIndex])
        }

        return next
      })
    }, 300)
  }, [])

  const stopProgress = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current)
      progressInterval.current = null
    }
    setScanProgress(100)
  }, [])

  const scan = useCallback(
    async (path?: string) => {
      setLoading(true)
      setError(null)
      setSelected(new Set())
      startProgress()
      try {
        const params = new URLSearchParams()
        if (path) params.set("path", path)
        const res = await fetch(`/api/scan?${params}`)
        const result = await res.json()
        if (result.error) {
          setError(result.error)
        } else {
          setData(result)
          setCurrentPath(result.scanPath)
        }
      } catch {
        setError("Failed to connect to server. Is the app running?")
      } finally {
        stopProgress()
        setLoading(false)
      }
    },
    [startProgress, stopProgress]
  )

  useEffect(() => {
    scan()
  }, [scan])

  const drillDown = (path: string) => {
    if (currentPath) {
      setPathHistory((prev) => [...prev, currentPath])
    }
    scan(path)
  }

  const goBack = () => {
    const prev = pathHistory[pathHistory.length - 1]
    setPathHistory((h) => h.slice(0, -1))
    if (prev) scan(prev)
    else scan()
  }

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectAllDeletable = () => {
    if (!data) return
    const deletable = data.items.filter((i) => i.deletable && !i.needsSudo)
    if (selected.size === deletable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(deletable.map((i) => i.path)))
    }
  }

  const selectedItems = data?.items.filter((i) => selected.has(i.path)) || []
  const selectedHasSudo = selectedItems.some((i) => i.needsSudo)

  const handleDelete = async (item: DiskItem) => {
    if (item.needsSudo) {
      const isWin = data?.platform === "win32"
      const cmd = isWin
        ? `runas /user:Administrator "rmdir /s /q \\"${item.path}\\""`
        : `sudo rm -rf "${item.path}"`
      setSudoDialog(cmd)
      return
    }
    setConfirmDialog(item)
  }

  const confirmDelete = async () => {
    if (!confirmDialog) return
    setDeleting(confirmDialog.path)
    setConfirmDialog(null)

    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: confirmDialog.path }),
      })
      const result = await res.json()

      if (result.sudoCommand) {
        setSudoDialog(result.sudoCommand)
      } else if (result.success) {
        setDeleteSuccess(
          `Deleted ${confirmDialog.size} from ${confirmDialog.path.split("/").pop() || confirmDialog.path}`
        )
        setTimeout(() => setDeleteSuccess(null), 3000)
        scan(currentPath || undefined)
      } else {
        setError(result.error || "Failed to delete")
        setTimeout(() => setError(null), 5000)
      }
    } catch {
      setError("Failed to delete. Check permissions.")
      setTimeout(() => setError(null), 5000)
    } finally {
      setDeleting(null)
    }
  }

  const confirmBulkDelete = async () => {
    setBulkConfirmDialog(false)
    setBulkDeleting(true)

    const directItems = selectedItems.filter((i) => !i.needsSudo)
    const sudoItems = selectedItems.filter((i) => i.needsSudo)

    let deletedCount = 0
    let deletedSize = 0

    for (const item of directItems) {
      setDeleting(item.path)
      try {
        const res = await fetch("/api/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.path }),
        })
        const result = await res.json()
        if (result.success) {
          deletedCount++
          deletedSize += item.sizeBytes
        }
      } catch {
        // continue with next item
      }
    }

    setDeleting(null)
    setBulkDeleting(false)
    setSelected(new Set())

    if (deletedCount > 0) {
      const sizeStr =
        deletedSize >= 1024 * 1024 * 1024
          ? (deletedSize / (1024 * 1024 * 1024)).toFixed(1) + " GB"
          : (deletedSize / (1024 * 1024)).toFixed(1) + " MB"
      setDeleteSuccess(`Deleted ${deletedCount} items (${sizeStr} freed)`)
      setTimeout(() => setDeleteSuccess(null), 4000)
    }

    if (sudoItems.length > 0) {
      const isWin = data?.platform === "win32"
      const cmds = sudoItems
        .map((i) =>
          isWin
            ? `rmdir /s /q "${i.path}"`
            : `sudo rm -rf "${i.path}"`
        )
        .join(isWin ? " && " : " && ")
      setSudoDialog(cmds)
    }

    scan(currentPath || undefined)
  }

  const copyCommand = async (command: string) => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const capacityPercent = data?.disk.capacity
    ? parseInt(data.disk.capacity)
    : 0

  const elevatedLabel = data?.platform === "win32" ? "Admin" : "Sudo"
  const pathSep = data?.platform === "win32" ? "\\" : "/"

  const deletableCount = data?.items.filter((i) => i.deletable && !i.needsSudo).length || 0

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/10 rounded-lg">
              <HardDrive className="h-6 w-6 text-yellow-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Disk Cleaner</h1>
              <p className="text-sm text-neutral-500">
                Find and remove space hogs
              </p>
            </div>
          </div>
          <Button
            onClick={() => scan(currentPath || undefined)}
            variant="outline"
            size="sm"
            disabled={loading}
            className="border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {/* Permanent Deletion Warning */}
        <div className="bg-red-500/5 border border-red-500/15 rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400/80">
            Items are permanently deleted, not moved to Trash. Be careful.
          </p>
        </div>

        {/* Success Toast */}
        {deleteSuccess && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
            <p className="text-sm text-green-300">{deleteSuccess}</p>
          </div>
        )}

        {/* Error Toast */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Disk Usage Bar */}
        {data?.disk && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">
                {data.disk.used} used of {data.disk.total}
              </span>
              <span className="font-medium text-white">
                {data.disk.available} available
              </span>
            </div>
            <div className="h-2.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  capacityPercent > 90
                    ? "bg-red-500"
                    : capacityPercent > 75
                      ? "bg-yellow-400"
                      : "bg-yellow-400"
                }`}
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
            <p className="text-xs text-neutral-500 text-center">
              {data.disk.capacity} used
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-2">
          {pathHistory.length > 0 && (
            <Button
              onClick={goBack}
              variant="ghost"
              size="sm"
              className="text-neutral-400 hover:text-white hover:bg-neutral-800"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}

          {/* Path Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setPathDropdownOpen((p) => !p)}
              className="flex items-center gap-2 text-sm text-neutral-400 bg-neutral-900 px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-neutral-700 hover:text-neutral-300 transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5 text-yellow-400" />
              {currentPath || "/"}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pathDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {pathDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl z-50 overflow-hidden">
                {/* Quick paths */}
                <div className="p-1">
                  {quickPaths.map((qp) => (
                    <button
                      key={qp.path}
                      onClick={() => {
                        setPathDropdownOpen(false)
                        setPathHistory([])
                        scan(qp.path === "HOME" ? undefined : qp.path)
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                        currentPath === qp.path || (qp.path === "HOME" && currentPath?.startsWith("/Users/"))
                          ? "bg-yellow-500/10 text-yellow-400"
                          : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                      }`}
                    >
                      <qp.icon className="h-4 w-4 text-neutral-500" />
                      <span>{qp.label}</span>
                      <span className="ml-auto text-xs text-neutral-600">{qp.path === "HOME" ? "~" : qp.path}</span>
                    </button>
                  ))}
                </div>

                {/* Custom path input */}
                <div className="border-t border-neutral-800 p-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (customPath.trim()) {
                        setPathDropdownOpen(false)
                        setPathHistory([])
                        scan(customPath.trim())
                        setCustomPath("")
                      }
                    }}
                    className="flex gap-1.5"
                  >
                    <input
                      type="text"
                      value={customPath}
                      onChange={(e) => setCustomPath(e.target.value)}
                      placeholder="Custom path..."
                      className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-yellow-500/50"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border-0"
                    >
                      Go
                    </Button>
                  </form>
                </div>
              </div>
            )}
          </div>

          {loading && (
            <span className="text-xs text-neutral-600 ml-2">scanning...</span>
          )}
        </div>

        {/* Selection Action Bar */}
        {selected.size > 0 && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare className="h-5 w-5 text-yellow-400" />
              <span className="text-sm text-yellow-300">
                {selected.size} item{selected.size > 1 ? "s" : ""} selected
                <span className="text-yellow-500 ml-2">
                  ({formatTotalSize(selectedItems)})
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setSelected(new Set())}
                variant="ghost"
                size="sm"
                className="text-neutral-400 hover:text-white hover:bg-neutral-800"
              >
                Clear
              </Button>
              <Button
                onClick={() => setBulkConfirmDialog(true)}
                size="sm"
                disabled={bulkDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {bulkDeleting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete Selected
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/50">
          {/* Scan Progress Bar */}
          {loading && (
            <div className="bg-neutral-900 border-b border-neutral-800 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-yellow-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1.5">
                    <p className="text-sm text-neutral-300">{scanTip}</p>
                    <span className="text-xs text-neutral-500">
                      {Math.round(scanProgress)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-yellow-400 rounded-full transition-all duration-300"
                      style={{ width: `${scanProgress}%` }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-neutral-600 pl-8">
                This may take a few seconds depending on the number of files
              </p>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow className="border-neutral-800 hover:bg-transparent">
                <TableHead className="text-neutral-500 font-medium w-10">
                  <button
                    onClick={selectAllDeletable}
                    className="hover:text-yellow-400 transition-colors"
                    title={selected.size === deletableCount ? "Deselect all" : "Select all deletable"}
                  >
                    {selected.size > 0 && selected.size === deletableCount ? (
                      <CheckSquare className="h-4 w-4 text-yellow-400" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-neutral-500 font-medium">Path</TableHead>
                <TableHead className="text-neutral-500 font-medium w-28">Size</TableHead>
                <TableHead className="text-neutral-500 font-medium w-48">
                  Description
                </TableHead>
                <TableHead className="text-neutral-500 font-medium w-32 text-right">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-neutral-800/50">
                    <TableCell>
                      <div className="h-4 bg-neutral-800 rounded animate-pulse w-4" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-neutral-800 rounded animate-pulse w-64" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 bg-neutral-800 rounded animate-pulse w-16" />
                    </TableCell>
                    <TableCell>
                      <div className="h-4 bg-neutral-800 rounded animate-pulse w-32" />
                    </TableCell>
                    <TableCell>
                      <div className="h-8 bg-neutral-800 rounded animate-pulse w-16 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                data?.items.map((item) => {
                  const isSelected = selected.has(item.path)
                  const canSelect = item.deletable && !item.needsSudo
                  return (
                    <TableRow
                      key={item.path}
                      className={`border-neutral-800/50 transition-all ${
                        loading ? "opacity-50" : "opacity-100"
                      } ${isSelected ? "bg-yellow-500/5" : "hover:bg-neutral-800/30"}`}
                    >
                      <TableCell>
                        {canSelect ? (
                          <button
                            onClick={() => toggleSelect(item.path)}
                            className="hover:text-yellow-400 transition-colors"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-yellow-400" />
                            ) : (
                              <Square className="h-4 w-4 text-neutral-700" />
                            )}
                          </button>
                        ) : (
                          <Square className="h-4 w-4 text-neutral-800" />
                        )}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => drillDown(item.path)}
                          className="flex items-center gap-2 text-left hover:text-yellow-400 transition-colors group"
                        >
                          <FolderOpen className="h-4 w-4 text-neutral-600 group-hover:text-yellow-400 flex-shrink-0" />
                          <span className="text-sm truncate max-w-md text-neutral-200">
                            {item.path.replace(
                              currentPath ? currentPath + pathSep : "",
                              ""
                            )}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            item.sizeBytes > 10 * 1024 * 1024 * 1024
                              ? "bg-red-500/15 text-red-400 border border-red-500/20"
                              : item.sizeBytes > 1024 * 1024 * 1024
                                ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
                                : "bg-neutral-800 text-neutral-400 border border-neutral-700"
                          }`}
                        >
                          {item.size}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-neutral-500">
                        {item.description}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.deletable ? (
                          <Button
                            onClick={() => handleDelete(item)}
                            variant="ghost"
                            size="sm"
                            disabled={deleting === item.path}
                            className={`text-neutral-500 ${
                              item.needsSudo
                                ? "hover:text-yellow-400 hover:bg-yellow-500/10"
                                : "hover:text-red-400 hover:bg-red-500/10"
                            }`}
                          >
                            {deleting === item.path ? (
                              <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
                            ) : item.needsSudo ? (
                              <>
                                <Terminal className="h-4 w-4 mr-1" />
                                {elevatedLabel}
                              </>
                            ) : (
                              <>
                                <Trash2 className="h-4 w-4 mr-1" />
                                Delete
                              </>
                            )}
                          </Button>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-neutral-700 text-neutral-600 text-xs"
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            Protected
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Confirm Delete Dialog (single) */}
        <Dialog
          open={!!confirmDialog}
          onOpenChange={() => setConfirmDialog(null)}
        >
          <DialogContent className="text-neutral-200">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                Confirm Deletion
              </DialogTitle>
              <DialogDescription className="text-neutral-500">
                Are you sure? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <code className="block bg-black border border-neutral-800 rounded-lg p-3 text-sm text-red-400 break-all">
                {confirmDialog?.path}
              </code>
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">{confirmDialog?.description}</span>
                <Badge
                  variant="secondary"
                  className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
                >
                  {confirmDialog?.size}
                </Badge>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setConfirmDialog(null)}
                className="text-neutral-400 hover:text-white hover:bg-neutral-800"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Forever
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm Bulk Delete Dialog */}
        <Dialog
          open={bulkConfirmDialog}
          onOpenChange={() => setBulkConfirmDialog(false)}
        >
          <DialogContent className="text-neutral-200">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
                Delete {selected.size} Items
              </DialogTitle>
              <DialogDescription className="text-neutral-500">
                Are you sure? This will permanently delete all selected items.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedItems.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center justify-between bg-black border border-neutral-800 rounded-lg px-3 py-2"
                >
                  <span className="text-sm text-neutral-300 truncate mr-3">
                    {item.path.split(pathSep).pop()}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.needsSudo && (
                      <Badge variant="outline" className="border-yellow-500/30 text-yellow-500 text-xs">
                        sudo
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="bg-red-500/15 text-red-400 border border-red-500/20 text-xs"
                    >
                      {item.size}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-sm border-t border-neutral-800 pt-3">
              <span className="text-neutral-500">Total to free</span>
              <span className="text-yellow-400 font-medium">
                {formatTotalSize(selectedItems)}
              </span>
            </div>
            {selectedHasSudo && (
              <p className="text-xs text-yellow-500">
                Some items require sudo — you&apos;ll get terminal commands for those.
              </p>
            )}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setBulkConfirmDialog(false)}
                className="text-neutral-400 hover:text-white hover:bg-neutral-800"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmBulkDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete All Selected
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sudo/Admin Command Dialog */}
        <Dialog open={!!sudoDialog} onOpenChange={() => setSudoDialog(null)}>
          <DialogContent className="text-neutral-200">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <Terminal className="h-5 w-5 text-yellow-400" />
                {data?.platform === "win32"
                  ? "Administrator Required"
                  : "Sudo Required"}
              </DialogTitle>
              <DialogDescription className="text-neutral-500">
                This path requires elevated permissions. Copy and run this
                command in your terminal:
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <code className="block bg-black border border-neutral-800 rounded-lg p-3 text-sm text-yellow-400 pr-12 break-all">
                {sudoDialog}
              </code>
              <Button
                onClick={() => copyCommand(sudoDialog!)}
                variant="ghost"
                size="sm"
                className="absolute top-2 right-2 text-neutral-500 hover:text-white hover:bg-neutral-800"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setSudoDialog(null)
                  setTimeout(() => scan(currentPath || undefined), 1000)
                }}
                variant="ghost"
                className="text-neutral-400 hover:text-white hover:bg-neutral-800"
              >
                Done — Refresh
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="text-center text-xs text-neutral-700">
          {data?.items.length ?? 0} items found in {currentPath || "/"} — items
          in your home directory can be deleted directly, system paths require{" "}
          {data?.platform === "win32" ? "admin" : "sudo"}
        </p>
      </div>
    </div>
  )
}
