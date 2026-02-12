import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as opentype from "opentype.js"

import { svgAlphabet } from "../index.ts"

const UNITS_PER_EM = 1000
const DESIGN_HEIGHT = UNITS_PER_EM
const STROKE_WIDTH = 0
const VERTICAL_SCALE = 0.93
const HORIZONTAL_SCALE = 1

type ReferenceMetrics = {
  width: number
  height: number
  advanceWidth: number
  leftSideBearing: number
  rightSideBearing: number
  yMin: number
  yMax: number
}

const REFERENCE_FONT_PATHS = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf",
  "/Library/Fonts/DejaVuSansMono.ttf",
  "C:\\Windows\\Fonts\\DejaVuSansMono.ttf",
]

const findReferenceFontPath = (): string | null => {
  for (const path of REFERENCE_FONT_PATHS) {
    try {
      if (Bun.file(path).size > 0) {
        return path
      }
    } catch {
      // ignore
    }
  }
  return null
}

const referenceFontPath = findReferenceFontPath()
if (!referenceFontPath) {
  throw new Error(
    "DejaVu Sans Mono font not found; cannot generate svg alphabet paths.",
  )
}

const referenceFont = opentype.loadSync(referenceFontPath)
const referenceScale = UNITS_PER_EM / referenceFont.unitsPerEm
const useReferenceSpacing = true

const getReferenceGlyphMetrics = (char: string): ReferenceMetrics | null => {
  const glyph = referenceFont.charToGlyph(char)
  const bbox = glyph.getBoundingBox()
  const width = (bbox.x2 - bbox.x1) * referenceScale
  const height = (bbox.y2 - bbox.y1) * referenceScale
  const advanceWidth = (glyph.advanceWidth || 0) * referenceScale
  const leftSideBearing = bbox.x1 * referenceScale
  const rightSideBearing = advanceWidth - bbox.x2 * referenceScale
  const yMin = bbox.y1 * referenceScale
  const yMax = bbox.y2 * referenceScale

  if (!(width > 0) || !(height > 0) || !(advanceWidth > 0)) {
    return null
  }

  return {
    width,
    height,
    advanceWidth,
    leftSideBearing,
    rightSideBearing,
    yMin,
    yMax,
  }
}

interface Point {
  x: number
  y: number
}

interface Subpath {
  points: Point[]
  closed: boolean
}

const parsePathData = (pathData: string): Subpath[] => {
  const subpaths: Subpath[] = []
  let current: Subpath | null = null
  let currentPoint: Point | null = null
  let subpathStart: Point | null = null

  const commandTokenRegex = /[MLmlZz]/g
  let lastCommand: { cmd: string; index: number } | null = null
  let match: RegExpExecArray | null

  const flushCurrent = () => {
    if (current && current.points.length > 0) {
      subpaths.push(current)
    }
    current = null
    subpathStart = null
  }

  const ensureCurrent = (point: Point) => {
    if (!current) {
      current = { points: [point], closed: false }
      subpathStart = point
    } else if (current.points.length === 0) {
      current.points.push(point)
      subpathStart = point
    }
  }

  const applyCommand = (cmd: string, data: string) => {
    const command = cmd.toUpperCase()
    if (command === "Z") {
      if (current) {
        current.closed = true
      }
      if (subpathStart) {
        currentPoint = { ...subpathStart }
      }
      return
    }

    const numbers = data.match(/[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g)
    if (!numbers || numbers.length < 2) {
      return
    }

    const isRelative = cmd === cmd.toLowerCase()
    let isFirstPair = true

    for (let i = 0; i + 1 < numbers.length; i += 2) {
      let x = Number.parseFloat(numbers[i])
      let y = Number.parseFloat(numbers[i + 1])

      if (Number.isNaN(x) || Number.isNaN(y)) {
        continue
      }

      if (isRelative && currentPoint) {
        x += currentPoint.x
        y += currentPoint.y
      }

      const nextPoint = { x, y }

      if (command === "M" && isFirstPair) {
        flushCurrent()
        current = { points: [nextPoint], closed: false }
        subpathStart = nextPoint
        currentPoint = nextPoint
        isFirstPair = false
        continue
      }

      if (command === "M" || command === "L") {
        if (!current) {
          current = { points: [nextPoint], closed: false }
          subpathStart = nextPoint
        } else {
          current.points.push(nextPoint)
        }
        currentPoint = nextPoint
      }

      isFirstPair = false
    }
  }

  while (true) {
    match = commandTokenRegex.exec(pathData)
    if (!match) {
      break
    }
    if (lastCommand) {
      const data = pathData.slice(lastCommand.index + 1, match.index)
      applyCommand(lastCommand.cmd, data)
    }
    lastCommand = { cmd: match[0], index: match.index }
  }

  if (lastCommand) {
    const data = pathData.slice(lastCommand.index + 1)
    applyCommand(lastCommand.cmd, data)
  }

  flushCurrent()
  return subpaths
}

const getBoundingBox = (
  subpaths: Subpath[],
): { minX: number; maxX: number; minY: number; maxY: number } => {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const subpath of subpaths) {
    for (const point of subpath.points) {
      const y = 1 - point.y
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  }

  return { minX, maxX, minY, maxY }
}

const formatNumber = (value: number) => {
  const rounded = Number(value.toFixed(6))
  const generated = Object.is(rounded, -0) ? 0 : rounded
  return generated.toString()
}

const serializeSubpaths = (subpaths: Subpath[]): string => {
  const parts: string[] = []

  for (const subpath of subpaths) {
    if (subpath.points.length === 0) {
      continue
    }

    const [first, ...rest] = subpath.points
    parts.push(`M${formatNumber(first.x)} ${formatNumber(first.y)}`)

    for (const point of rest) {
      parts.push(`L${formatNumber(point.x)} ${formatNumber(point.y)}`)
    }

    if (subpath.closed) {
      parts.push("Z")
    }
  }

  return parts.join(" ")
}

const getMaxYFromSubpaths = (subpaths: Subpath[]): number => {
  let maxY = Number.NEGATIVE_INFINITY
  for (const subpath of subpaths) {
    for (const point of subpath.points) {
      maxY = Math.max(maxY, point.y)
    }
  }
  return Number.isFinite(maxY) ? maxY : 0
}

const shiftSubpathsY = (subpaths: Subpath[], deltaY: number): Subpath[] =>
  subpaths.map((subpath) => ({
    closed: subpath.closed,
    points: subpath.points.map((point) => ({
      x: point.x,
      y: point.y + deltaY,
    })),
  }))

const transformSubpaths = (
  subpaths: Subpath[],
  scaleX: number,
  scaleY: number,
  xShift: number,
  yShift: number,
): Subpath[] =>
  subpaths.map((subpath) => ({
    closed: subpath.closed,
    points: subpath.points.map((point) => {
      const yCartesian = 1 - point.y
      const xScaled = point.x * scaleX + xShift
      const yScaled = yCartesian * scaleY + yShift
      return { x: xScaled, y: 1 - yScaled }
    }),
  }))

const generatedAlphabet: Record<string, string> = {}

const REFERENCE_CHAR = "H"
const referenceCharPath = svgAlphabet[REFERENCE_CHAR]
const referenceCharSubpaths = referenceCharPath
  ? parsePathData(referenceCharPath)
  : []
const referenceCharBbox = getBoundingBox(referenceCharSubpaths)
const referenceCharWidth =
  (referenceCharBbox.maxX - referenceCharBbox.minX) * UNITS_PER_EM
const referenceCharHeight =
  (referenceCharBbox.maxY - referenceCharBbox.minY) * DESIGN_HEIGHT
const referenceCharMetrics = getReferenceGlyphMetrics(REFERENCE_CHAR)
const baseScaleX =
  referenceCharMetrics && referenceCharWidth > 0
    ? (referenceCharMetrics.width / referenceCharWidth) * HORIZONTAL_SCALE
    : HORIZONTAL_SCALE
const baseScaleY =
  referenceCharMetrics && referenceCharHeight > 0
    ? (referenceCharMetrics.height / referenceCharHeight) * VERTICAL_SCALE
    : VERTICAL_SCALE

const adjustDotSubpath = (subpaths: Subpath[], char: string): Subpath[] => {
  if (char !== "i" && char !== "j") {
    return subpaths
  }

  let dotIndex = -1
  let dotMinY = Number.POSITIVE_INFINITY
  let dotBbox: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null = null

  for (let i = 0; i < subpaths.length; i += 1) {
    const subpath = subpaths[i]
    if (subpath.points.length === 0) {
      continue
    }
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const point of subpath.points) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
    const width = maxX - minX
    const height = maxY - minY
    if (height === 0 && width > 0 && minY < dotMinY) {
      dotIndex = i
      dotMinY = minY
      dotBbox = { minX, maxX, minY, maxY }
    }
  }

  if (dotIndex < 0 || !dotBbox) {
    return subpaths
  }

  const width = dotBbox.maxX - dotBbox.minX
  if (!(width > 0)) {
    return subpaths
  }

  const targetWidth = Math.min(width, 0.08)
  const scale = targetWidth / width
  const centerX = (dotBbox.minX + dotBbox.maxX) / 2
  const updated = subpaths.map((subpath, index) => {
    if (index !== dotIndex) {
      return subpath
    }
    return {
      closed: subpath.closed,
      points: subpath.points.map((point) => ({
        x: centerX + (point.x - centerX) * scale,
        y: point.y,
      })),
    }
  })

  return updated
}

for (const [char, pathData] of Object.entries(svgAlphabet)) {
  const subpaths = parsePathData(pathData)
  if (subpaths.length === 0) {
    generatedAlphabet[char] = pathData
    continue
  }

  const bbox = getBoundingBox(subpaths)
  const strokePad = STROKE_WIDTH / 2
  const paddedMinX = bbox.minX - strokePad
  const paddedMaxX = bbox.maxX + strokePad
  const paddedMinY = bbox.minY - strokePad
  const paddedMaxY = bbox.maxY + strokePad
  const referenceMetrics = getReferenceGlyphMetrics(char)
  const scaleX = baseScaleX
  const scaleY = baseScaleY

  const xMinScaled = paddedMinX * scaleX
  const xMaxScaled = paddedMaxX * scaleX
  const yMaxScaled = paddedMaxY * scaleY
  const scaledWidth = xMaxScaled - xMinScaled
  const targetWidth = 1
  const xShift =
    scaledWidth <= targetWidth
      ? (targetWidth - scaledWidth) / 2 - xMinScaled
      : -xMinScaled
  const yShift =
    useReferenceSpacing && referenceMetrics
      ? referenceMetrics.yMax / DESIGN_HEIGHT - yMaxScaled
      : 0

  const transformed = transformSubpaths(
    subpaths,
    scaleX,
    scaleY,
    xShift,
    yShift,
  )

  const adjusted = adjustDotSubpath(transformed, char)
  generatedAlphabet[char] = serializeSubpaths(adjusted)
}

const descenderChars = ["g", "j", "p", "q", "y"]
let descenderTargetY = 0
for (const char of descenderChars) {
  const pathData = generatedAlphabet[char]
  if (!pathData) {
    continue
  }
  const subpaths = parsePathData(pathData)
  descenderTargetY = Math.max(descenderTargetY, getMaxYFromSubpaths(subpaths))
}

const underscorePath = generatedAlphabet["_"]
if (underscorePath && descenderTargetY > 0) {
  const underscoreSubpaths = parsePathData(underscorePath)
  const underscoreMaxY = getMaxYFromSubpaths(underscoreSubpaths)
  const deltaY = descenderTargetY - underscoreMaxY
  if (Math.abs(deltaY) > 1e-6) {
    const shifted = shiftSubpathsY(underscoreSubpaths, deltaY)
    generatedAlphabet["_"] = serializeSubpaths(shifted)
  }
}

const indexPath = join(import.meta.dir, "..", "index.ts")
const indexContent = readFileSync(indexPath, "utf8")
const serializedAlphabet = JSON.stringify(generatedAlphabet, null, 2)
const updatedIndex = indexContent.replace(
  /export const svgAlphabet\s*=\s*\{[\s\S]*?\}\n/,
  `export const svgAlphabet = ${serializedAlphabet}\n`,
)

writeFileSync(indexPath, updatedIndex)
console.log("✓ generated SVG alphabet paths written to index.ts")
