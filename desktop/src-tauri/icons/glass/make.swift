// The app icon in the spirit of macOS's Liquid Glass: the character on a frosted glass tile with a lit rim,
// a sheen and depth. Run from this folder: swift make.swift (writes icon-1024.png; ../make.sh builds the sizes).
// A true Liquid Glass icon (with macOS's clear and tinted looks) needs Xcode's Icon Composer and actool.
import AppKit

let S: CGFloat = 1024
let ctx = CGContext(data: nil, width: Int(S), height: Int(S), bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let rgb = { (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) in CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a) }
func gradient(_ stops: [(CGColor, CGFloat)]) -> CGGradient {
  CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: stops.map(\.0) as CFArray, locations: stops.map(\.1))!
}

// The tile: macOS's icon grid (824 of 1024, corners about 22%).
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)

// Its shadow on the desktop.
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 36, color: rgb(0, 20, 60, 0.32))
ctx.addPath(shape); ctx.setFillColor(rgb(220, 232, 248, 1)); ctx.fillPath()
ctx.restoreGState()

// Frosted blue glass, lit from within behind the character, lighter at the top.
ctx.saveGState()
ctx.addPath(shape); ctx.clip()
ctx.drawLinearGradient(gradient([(rgb(206, 228, 255, 1), 0), (rgb(120, 172, 246, 1), 0.6), (rgb(58, 116, 226, 1), 1)]),
                       start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])
ctx.drawRadialGradient(gradient([(rgb(255, 255, 255, 0.7), 0), (rgb(255, 255, 255, 0), 1)]),
                       startCenter: CGPoint(x: 512, y: 540), startRadius: 0, endCenter: CGPoint(x: 512, y: 540), endRadius: 380, options: [])
// Light pooled along the bottom edge, as glass gathers it.
ctx.drawLinearGradient(gradient([(rgb(255, 255, 255, 0), 0.8), (rgb(255, 255, 255, 0.55), 1)]),
                       start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])
ctx.restoreGState()

// The character, lifted off the glass, standing at its bottom edge (the shirt runs off it).
let art = NSImage(contentsOfFile: "character.png")!
var r = CGRect(x: 0, y: 0, width: 512, height: 512)
let cg = art.cgImage(forProposedRect: &r, context: nil, hints: [.interpolation: NSImageInterpolation.high.rawValue])!
ctx.saveGState()
ctx.addPath(shape); ctx.clip()
ctx.interpolationQuality = .high
ctx.setShadow(offset: CGSize(width: 0, height: -16), blur: 28, color: rgb(10, 40, 100, 0.35))
ctx.draw(cg, in: CGRect(x: 127, y: 36, width: 770, height: 770))
ctx.restoreGState()

// The sheen: a soft specular sweep across the top of the glass, over everything.
ctx.saveGState()
ctx.addPath(shape); ctx.clip()
let sheen = CGMutablePath()
sheen.move(to: CGPoint(x: tile.minX, y: tile.maxY))
sheen.addLine(to: CGPoint(x: tile.maxX, y: tile.maxY))
sheen.addLine(to: CGPoint(x: tile.maxX, y: tile.maxY - 250))
sheen.addCurve(to: CGPoint(x: tile.minX, y: tile.maxY - 330), control1: CGPoint(x: 700, y: tile.maxY - 190), control2: CGPoint(x: 330, y: tile.maxY - 380))
sheen.closeSubpath()
ctx.addPath(sheen); ctx.clip()
ctx.drawLinearGradient(gradient([(rgb(255, 255, 255, 0.42), 0), (rgb(255, 255, 255, 0.0), 1)]),
                       start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.maxY - 250), options: [])
ctx.restoreGState()

// The rim: bright where the light hits (top), fading round to the bottom, with a faint darker edge outside it.
ctx.saveGState()
ctx.addPath(shape); ctx.setLineWidth(3); ctx.setStrokeColor(rgb(40, 80, 140, 0.25)); ctx.strokePath()
let inner = CGPath(roundedRect: tile.insetBy(dx: 5, dy: 5), cornerWidth: 180, cornerHeight: 180, transform: nil)
ctx.addPath(inner); ctx.setLineWidth(7); ctx.replacePathWithStrokedPath(); ctx.clip()
ctx.drawLinearGradient(gradient([(rgb(255, 255, 255, 0.95), 0), (rgb(255, 255, 255, 0.25), 0.5), (rgb(255, 255, 255, 0.7), 1)]),
                       start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])
ctx.restoreGState()

let out = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "icon-1024.png"))
print("icon-1024.png")
