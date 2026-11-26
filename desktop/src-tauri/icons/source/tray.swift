// The menu bar icon: the app icon's LGTM stamp, as a template (black on clear; macOS colours it), 18pt drawn at 36px.
// arg 1: stamp, arg 2: out.png
import AppKit
let a = CommandLine.arguments
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 36, pixelsHigh: 36, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
NSColor.black.setFill(); NSColor.black.setStroke()
func bar(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat = 3) { NSBezierPath(roundedRect: NSRect(x: x, y: 36 - y - h, width: w, height: h), xRadius: h / 2, yRadius: h / 2).fill() }
if a[1] == "stamp" { // the stamp alone: a double ring, turned, with "LGTM" as two lines of ink
  ctx.translateBy(x: 18, y: 18); ctx.rotate(by: 0.26)
  let o = NSBezierPath(ovalIn: NSRect(x: -15.5, y: -15.5, width: 31, height: 31)); o.lineWidth = 3; o.stroke()
  let i = NSBezierPath(ovalIn: NSRect(x: -11, y: -11, width: 22, height: 22)); i.lineWidth = 1.5; i.stroke()
  let s = NSAttributedString(string: "LGTM", attributes: [.font: NSFont.systemFont(ofSize: 9.5, weight: .black), .foregroundColor: NSColor.black, .kern: -0.4])
  let z = s.size(); s.draw(at: NSPoint(x: -z.width / 2, y: -z.height / 2 + 0.5))
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
