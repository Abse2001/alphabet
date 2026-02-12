import * as opentype from "opentype.js"

export const getFontMetrics = (fontPath: string) => {
  const font = opentype.loadSync(fontPath)
  let maxAdvance = 0

  for (let i = 0; i < font.glyphs.length; i += 1) {
    const glyph = font.glyphs.get(i)
    if (typeof glyph.unicode === "number" && glyph.name !== ".notdef") {
      maxAdvance = Math.max(maxAdvance, glyph.advanceWidth || 0)
    }
  }

  const monoWidthRatio = maxAdvance > 0 ? maxAdvance / font.unitsPerEm : 1
  const ascenderRatio = font.ascender / font.unitsPerEm
  const descenderRatio = Math.abs(font.descender) / font.unitsPerEm
  const heightRatio = ascenderRatio + descenderRatio

  return {
    monoWidthRatio,
    ascenderRatio,
    heightRatio,
  }
}
