import { expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import * as opentype from "opentype.js"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { svgAlphabet } from "../index.ts"
import { getFontMetrics } from "./helpers/get-monospace-width"

test("renders monospace grid with background squares", async () => {
  const chars = Object.keys(svgAlphabet)
    .filter(Boolean)
    .sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0))

  const fontSize = 60
  const columns = 16
  const rows = Math.ceil(chars.length / columns)
  const padding = fontSize * 0.9

  const fontPath = join(process.cwd(), "TscircuitAlphabet.ttf")
  const { monoWidthRatio, ascenderRatio, heightRatio } =
    getFontMetrics(fontPath)
  const font = opentype.loadSync(fontPath)
  const fontScale = fontSize / font.unitsPerEm
  const monoWidth = monoWidthRatio * fontSize
  const cellWidth = monoWidth
  const glyphHeight = heightRatio * fontSize
  let maxGlyphHeight = 0
  for (const char of chars) {
    const glyph = font.charToGlyph(char)
    const bbox = glyph.getBoundingBox()
    maxGlyphHeight = Math.max(maxGlyphHeight, (bbox.y2 - bbox.y1) * fontScale)
  }
  const cellHeight = Math.max(glyphHeight, maxGlyphHeight)

  const width = padding * 2 + columns * cellWidth
  const height = padding * 2 + rows * cellHeight

  const escapeXml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")

  const squares: string[] = []
  const labels: string[] = []
  for (let i = 0; i < rows * columns; i++) {
    const row = Math.floor(i / columns)
    const col = i % columns
    const x = padding + col * cellWidth
    const y = padding + row * cellHeight
    const fill = (row + col) % 2 === 0 ? "#f2f2f2" : "#ffffff"

    squares.push(
      `<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${fill}" stroke="#d0d0d0" stroke-width="1"/>`,
    )

    const char = chars[i]
    if (char) {
      const glyph = font.charToGlyph(char)
      const bbox = glyph.getBoundingBox()
      const glyphCenter = (bbox.x1 + bbox.x2) / 2
      const glyphX = x + cellWidth / 2 - glyphCenter * fontScale
      labels.push(
        `<text x="${glyphX}" y="${
          y + cellHeight / 2
        }" font-family="TscircuitAlphabet" font-size="${fontSize}" fill="black" dominant-baseline="central">${escapeXml(
          char,
        )}</text>`,
      )
    }
  }

  const svgString = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
  ${squares.join("\n  ")}
  ${labels.join("\n  ")}
</svg>`

  const resvg = new Resvg(svgString, {
    font: {
      fontFiles: [fontPath],
      loadSystemFonts: false,
      defaultFontFamily: "TscircuitAlphabet",
    },
  })

  const pngData = resvg.render()
  const pngBuffer = pngData.asPng()

  const snapshotDir = join(process.cwd(), "tests", "__snapshots__")
  mkdirSync(snapshotDir, { recursive: true })
  const pngPath = join(snapshotDir, "font-monospace-grid.png")
  writeFileSync(pngPath, pngBuffer)

  expect(pngBuffer.length).toBeGreaterThan(1000)
  console.log(`PNG snapshot saved to ${pngPath} (${pngBuffer.length} bytes)`)
})
