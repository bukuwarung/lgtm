// lgtm's app icon: a diff (a removed line, two added) stamped LGTM, on macOS's icon tile (824pt on the 1024pt canvas).
// arg 1: stamplight (the icon) or stamp (its dark look, for a light/dark icon later); arg 2: out.png, 1024².
import AppKit
let which = CommandLine.arguments[1]
func c(_ h: Int, _ a: CGFloat = 1) -> NSColor { NSColor(srgbRed: CGFloat(h >> 16 & 255) / 255, green: CGFloat(h >> 8 & 255) / 255, blue: CGFloat(h & 255) / 255, alpha: a) }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let T = NSRect(x: 100, y: 110, width: 824, height: 824) // the tile (y up)
let tile = NSBezierPath(roundedRect: T, xRadius: 185, yRadius: 185)
func top(_ y: CGFloat) -> CGFloat { T.maxY - y } // y measured down from the tile's top
let sh = NSShadow(); sh.shadowOffset = NSSize(width: 0, height: -10); sh.shadowBlurRadius = 28; sh.shadowColor = NSColor(white: 0, alpha: 0.3)
func base(_ a: Int, _ b: Int) { NSGraphicsContext.saveGraphicsState(); sh.set(); c(a).setFill(); tile.fill(); NSGraphicsContext.restoreGraphicsState(); NSGradient(starting: c(a), ending: c(b))!.draw(in: tile, angle: -90) }
func rr(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ col: NSColor) { col.setFill(); NSBezierPath(roundedRect: NSRect(x: T.minX + x, y: top(y + h), width: w, height: h), xRadius: r, yRadius: r).fill() }
// Diff rows: kind 0 context, 1 removed, 2 added; widths of the "code" in each.
func diff(dark: Bool, rows: [(Int, [CGFloat])], y0: CGFloat, rowH: CGFloat = 92) {
  for (i, (k, ws)) in rows.enumerated() {
    let y = y0 + CGFloat(i) * rowH
    if k > 0 { rr(0, y, 824, rowH, 0, k == 1 ? c(0xf85149, dark ? 0.22 : 0.16) : c(0x3fb950, dark ? 0.22 : 0.18)) }
    let ink = k == 1 ? c(0xf85149) : k == 2 ? c(0x3fb950) : (dark ? c(0xffffff, 0.28) : c(0x1f2328, 0.22))
    // the gutter sign
    if k > 0 { ink.setFill(); rr(64, y + rowH / 2 - 7, 40, 14, 7, ink); if k == 2 { rr(77, y + rowH / 2 - 20, 14, 40, 7, ink) } }
    var x: CGFloat = 140
    for w in ws { rr(x, y + rowH / 2 - 16, w, 32, 16, k == 0 ? ink : ink.withAlphaComponent(0.9)); x += w + 24 }
  }
}
NSGraphicsContext.saveGraphicsState(); 
switch which {
case "stamp", "stamplight":
  let light = which == "stamplight"
  if light { base(0xffffff, 0xeef1f4) } else { base(0x22272e, 0x16191d) }
  tile.addClip()
  diff(dark: !light, rows: [(0, [120, 260]), (1, [180, 300]), (2, [180, 210, 90]), (2, [90, 330]), (0, [210]), (0, [150, 120])], y0: 130)
  // the stamp: a green ring and LGTM, turned a little, as if pressed on the diff
  let ctx = NSGraphicsContext.current!.cgContext
  ctx.saveGState(); ctx.translateBy(x: T.minX + 560, y: top(560)); ctx.rotate(by: 0.26)
  let ink = light ? c(0x1a7f37) : c(0x3fb950)
  ink.setStroke(); let ring = NSBezierPath(ovalIn: NSRect(x: -205, y: -205, width: 410, height: 410)); ring.lineWidth = 30; 
  (light ? c(0xffffff, 0.88) : c(0x16191d, 0.85)).setFill(); ring.fill(); ring.stroke()
  let inner = NSBezierPath(ovalIn: NSRect(x: -165, y: -165, width: 330, height: 330)); inner.lineWidth = 10; inner.stroke()
  let f = NSFont.systemFont(ofSize: 128, weight: .black)
  let s = NSAttributedString(string: "LGTM", attributes: [.font: f, .foregroundColor: ink, .kern: -2])
  let sz = s.size(); s.draw(at: NSPoint(x: -sz.width / 2, y: -sz.height / 2 + 6))
  ctx.restoreGState()
default: break
}
NSGraphicsContext.restoreGraphicsState()
NSColor(white: 0, alpha: 0.12).setStroke(); NSBezierPath(roundedRect: T.insetBy(dx: 0.5, dy: 0.5), xRadius: 184.5, yRadius: 184.5).stroke()
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
