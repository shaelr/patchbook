// Draws the Patchbook app icon (same design as web/public/icon.svg) into an .iconset folder.
// Usage: swift mac/make-icon.swift <output.iconset>

import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

func draw(size: Int) -> Data? {
  let s = CGFloat(size)
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
  else { return nil }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  // The SVG is drawn on a 64-unit grid; macOS icons sit inside a ~80% rounded square.
  let inset = s * 0.1
  let box = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
  let unit = box.width / 64
  NSColor(red: 0x14 / 255, green: 0x16 / 255, blue: 0x1a / 255, alpha: 1).setFill()
  NSBezierPath(roundedRect: box, xRadius: 14 * unit, yRadius: 14 * unit).fill()
  // SVG y runs downward; flip into the box.
  func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: box.minX + x * unit, y: box.maxY - y * unit) }
  let yellow = NSColor(red: 0xf5 / 255, green: 0xa5 / 255, blue: 0x24 / 255, alpha: 1)
  let curve = NSBezierPath()
  curve.move(to: point(20, 22))
  curve.curve(to: point(44, 42), controlPoint1: point(32, 22), controlPoint2: point(32, 42))
  curve.lineWidth = 3 * unit
  yellow.setStroke()
  curve.stroke()
  yellow.setFill()
  for (x, y) in [(20.0, 22.0), (44.0, 22.0), (20.0, 42.0), (44.0, 42.0)] {
    let c = point(x, y)
    NSBezierPath(ovalIn: NSRect(x: c.x - 5 * unit, y: c.y - 5 * unit, width: 10 * unit, height: 10 * unit)).fill()
  }
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])
}

for base in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
    try draw(size: base * scale)!.write(to: output.appendingPathComponent(name))
  }
}
