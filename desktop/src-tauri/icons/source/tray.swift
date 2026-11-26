// The menu bar icon: the app icon's LGTM stamp as a template (black on clear; macOS colours it), 18pt at 36px. At that
// size the letters go on two lines (LG over TM) to stay readable, a little turned as a stamp is, centred by their ink
// (a font's box leaves capitals low). Drawn at 4x and scaled down. arg 1: out.png (36x36)
import AppKit
let tilt: CGFloat = 0.2, size: CGFloat = 12.8, gap: CGFloat = 1.8
func bitmap(_ draw: (CGContext) -> Void) -> NSBitmapImageRep {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 144, pixelsHigh: 144, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let ctx = NSGraphicsContext.current!.cgContext; ctx.scaleBy(x: 4, y: 4); NSColor.black.setFill(); NSColor.black.setStroke(); draw(ctx)
  NSGraphicsContext.restoreGraphicsState(); return rep
}
let font = NSFont.systemFont(ofSize: size, weight: .heavy)
func letters(_ ctx: CGContext, _ dx: CGFloat, _ dy: CGFloat) {
  ctx.saveGState(); ctx.translateBy(x: 18 + dx, y: 18 + dy); ctx.rotate(by: tilt)
  for (t, up) in [("LG", true), ("TM", false)] {
    let s = NSAttributedString(string: t, attributes: [.font: font, .foregroundColor: NSColor.black, .kern: -0.3])
    let base = up ? gap / 2 : -gap / 2 - font.capHeight // each line's baseline, the pair's middle at 0
    s.draw(at: NSPoint(x: -s.size().width / 2, y: base + font.descender))
  }
  ctx.restoreGState()
}
// Where the letters' ink lands, to move it onto the ring's centre.
let probe = bitmap { letters($0, 0, 0) }
var lo = CGPoint(x: 999, y: 999), hi = CGPoint(x: -1, y: -1)
for y in 0..<144 { for x in 0..<144 where probe.colorAt(x: x, y: y)!.alphaComponent > 0.3 { lo.x = min(lo.x, CGFloat(x)); hi.x = max(hi.x, CGFloat(x)); lo.y = min(lo.y, CGFloat(y)); hi.y = max(hi.y, CGFloat(y)) } }
let nudge: CGFloat = 0.75 // and a touch right: by ink alone the pair still looks left of centre (L and T are heavy on their left)
let dx = 18 - (lo.x + hi.x + 1) / 8 + nudge, dy = -(18 - (lo.y + hi.y + 1) / 8) // bitmap rows run down, drawing up
let rep = bitmap { ctx in
  let o = NSBezierPath(ovalIn: NSRect(x: 1.1, y: 1.1, width: 33.8, height: 33.8)); o.lineWidth = 2.2; o.stroke()
  letters(ctx, dx, dy)
}
let out = CommandLine.arguments[1] + ".4x.png"
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
