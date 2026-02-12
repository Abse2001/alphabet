import { expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { getFontMetrics } from "./helpers/get-monospace-width"

test("renders all characters grid", async () => {
  // Multi-line text to show all characters
  const lines = [
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    ".,*()-+=_[]<>'\"/\\ #^",
    "23+39=62",
    "43 + 17 = 60",
    "43-17 = 26",
    "4*5=20",
    "45 * 2 = 90",
  ]
  const fontSize = 60
  const lineHeight = fontSize * 1.8
  const padding = fontSize * 0.9
  const fontPath = join(process.cwd(), "TscircuitAlphabet.ttf")
  const { monoWidthRatio, ascenderRatio } = getFontMetrics(fontPath)
  // Calculate width based on longest line using actual monospace width
  const maxLineLength = Math.max(...lines.map((l) => l.length))
  const width = maxLineLength * fontSize * monoWidthRatio + padding * 2
  const height = lineHeight * lines.length + padding * 2

  // Escape special XML characters
  const escapeXml = (str: string) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")

  const svgString = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="white"/>
  ${lines
    .map(
      (line, i) =>
        `<text x="${padding}" y="${
          padding + ascenderRatio * fontSize + i * lineHeight
        }" font-family="TscircuitAlphabet" font-size="${fontSize}" fill="black">${escapeXml(
          line,
        )}</text>`,
    )
    .join("\n  ")}
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
  const pngPath = join(snapshotDir, "font-all-characters.png")
  writeFileSync(pngPath, pngBuffer)

  expect(pngBuffer.length).toBeGreaterThan(1000)
  console.log(`PNG snapshot saved to ${pngPath} (${pngBuffer.length} bytes)`)
})
