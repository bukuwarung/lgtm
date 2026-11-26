// lgtm's app icon: a diff (a removed line, two added) stamped LGTM.
//   swift draw.swift icon out.png      the whole icon on macOS's tile (824pt on the 1024pt canvas), light: icon.icns
//   swift draw.swift layers <dir>      the parts for ../AppIcon.icon (macOS 26's light, dark and tinted icon), 1024² each,
//                                      without the tile (macOS draws it): diff-{light,dark}.png, stamp-{light,dark}.png
import AppKit
let args = CommandLine.arguments
func c(_ h: Int, _ a: CGFloat = 1) -> NSColor { NSColor(srgbRed: CGFloat(h >> 16 & 255) / 255, green: CGFloat(h >> 8 & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: a) }
func canvas(_ out: String, _ draw: (CGContext) -> Void) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  draw(NSGraphicsContext.current!.cgContext)
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
}
// The art, in the tile's own 824pt square, y measured down from its top.
let S: CGFloat = 824
func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ col: NSColor) { col.setFill(); NSBezierPath(roundedRect: NSRect(x: x, y: S - y - h, width: w, height: h), xRadius: r, yRadius: r).fill() }
func diff(dark: Bool) {
  let rows: [(Int, [CGFloat])] = [(0, [120, 260]), (1, [180, 300]), (2, [180, 210, 90]), (2, [90, 330]), (0, [210]), (0, [150, 120])]
  for (i, (k, ws)) in rows.enumerated() {
    let h: CGFloat = 92, y = 130 + CGFloat(i) * h
    if k > 0 { box(0, y, S, h, 0, k == 1 ? c(0xf85149, dark ? 0.22 : 0.16) : c(0x3fb950, dark ? 0.22 : 0.18)) }
    let ink = k == 1 ? c(0xf85149) : k == 2 ? c(0x3fb950) : (dark ? c(0xffffff, 0.28) : c(0x1f2328, 0.22))
    if k > 0 { box(64, y + h / 2 - 7, 40, 14, 7, ink); if k == 2 { box(77, y + h / 2 - 20, 14, 40, 7, ink) } }
    var x: CGFloat = 140
    for w in ws { box(x, y + h / 2 - 16, w, 32, 16, k == 0 ? ink : ink.withAlphaComponent(0.9)); x += w + 24 }
  }
}
// The stamp: two rings and LG over TM, spaced out, a little turned, as the menu bar's (tray.swift); the letters centred by their ink
// (a font's box leaves capitals low), then a touch right (L and T are heavy on their left).
let stampAt = CGPoint(x: 560, y: 560), stampR: CGFloat = 205, tilt: CGFloat = 0.2
let stampFont = NSFont.systemFont(ofSize: 128, weight: .heavy), lineGap: CGFloat = 26
func letters(_ ctx: CGContext, _ ink: NSColor) {
  ctx.saveGState(); ctx.rotate(by: tilt)
  for (t, up) in [("LG", true), ("TM", false)] {
    let s = NSAttributedString(string: t, attributes: [.font: stampFont, .foregroundColor: ink, .kern: 10])
    s.draw(at: NSPoint(x: -s.size().width / 2, y: (up ? lineGap / 2 : -lineGap / 2 - stampFont.capHeight) + stampFont.descender))
  }
  ctx.restoreGState()
}
// Where the letters' ink lands around the stamp's centre, measured once on a scratch canvas.
let inkShift: CGPoint = {
  let n = 1024, rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let ctx = NSGraphicsContext.current!.cgContext; ctx.translateBy(x: 512, y: 512); letters(ctx, .black)
  NSGraphicsContext.restoreGraphicsState()
  var lo = CGPoint(x: 9999, y: 9999), hi = CGPoint(x: -1, y: -1)
  for y in stride(from: 0, to: n, by: 2) { for x in stride(from: 0, to: n, by: 2) where rep.colorAt(x: x, y: y)!.alphaComponent > 0.3 { lo.x = min(lo.x, CGFloat(x)); hi.x = max(hi.x, CGFloat(x)); lo.y = min(lo.y, CGFloat(y)); hi.y = max(hi.y, CGFloat(y)) } }
  return CGPoint(x: 512 - (lo.x + hi.x) / 2 + stampR * 0.045, y: -(512 - (lo.y + hi.y) / 2)) // bitmap rows run down
}()
func stamp(dark: Bool, _ ctx: CGContext) {
  ctx.saveGState(); ctx.translateBy(x: stampAt.x, y: S - stampAt.y)
  let ink = dark ? c(0x3fb950) : c(0x1a7f37)
  let ring = NSBezierPath(ovalIn: NSRect(x: -stampR, y: -stampR, width: 2 * stampR, height: 2 * stampR)); ring.lineWidth = 34
  (dark ? c(0x16191d, 0.85) : c(0xffffff, 0.88)).setFill(); ring.fill(); ink.setStroke(); ring.stroke()
  let inner = NSBezierPath(ovalIn: NSRect(x: -165, y: -165, width: 330, height: 330)); inner.lineWidth = 10; inner.stroke()
  ctx.translateBy(x: inkShift.x, y: inkShift.y); letters(ctx, ink)
  ctx.restoreGState()
}
if args[1] == "layers" {
  for dark in [false, true] {
    let m = dark ? "dark" : "light"
    canvas("\(args[2])/diff-\(m).png") { ctx in ctx.scaleBy(x: 1024 / S, y: 1024 / S); diff(dark: dark) }
    canvas("\(args[2])/stamp-\(m).png") { ctx in ctx.scaleBy(x: 1024 / S, y: 1024 / S); stamp(dark: dark, ctx) }
  }
} else {
  canvas(args[2]) { ctx in
    let T = NSRect(x: 100, y: 110, width: S, height: S), tile = NSBezierPath(roundedRect: T, xRadius: 185, yRadius: 185)
    let sh = NSShadow(); sh.shadowOffset = NSSize(width: 0, height: -10); sh.shadowBlurRadius = 28; sh.shadowColor = NSColor(white: 0, alpha: 0.3)
    NSGraphicsContext.saveGraphicsState(); sh.set(); NSColor.white.setFill(); tile.fill(); NSGraphicsContext.restoreGraphicsState()
    NSGraphicsContext.saveGraphicsState(); tile.addClip(); NSGradient(starting: .white, ending: c(0xeef1f4))!.draw(in: T, angle: -90)
    ctx.translateBy(x: T.minX, y: T.minY); diff(dark: false); stamp(dark: false, ctx)
    NSGraphicsContext.restoreGraphicsState()
    NSColor(white: 0, alpha: 0.12).setStroke(); NSBezierPath(roundedRect: T.insetBy(dx: 0.5, dy: 0.5), xRadius: 184.5, yRadius: 184.5).stroke()
  }
}
