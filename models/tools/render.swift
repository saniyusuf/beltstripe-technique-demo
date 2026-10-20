import Foundation
import SceneKit
import AppKit
import Metal

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let outPrefix = CommandLine.arguments[2]
let scene = try SCNScene(url: url, options: nil)
var verts = 0, tris = 0
scene.rootNode.enumerateHierarchy { n, _ in
    if let g = n.geometry {
        for s in g.sources(for: .vertex) { verts += s.vectorCount }
        for e in g.elements { tris += e.primitiveCount }
    }
}
let (mn, mx) = scene.rootNode.boundingBox
print("verts \(verts) tris \(tris) bbox min \(mn) max \(mx)")
let c = SCNVector3((mn.x+mx.x)/2, (mn.y+mx.y)/2, (mn.z+mx.z)/2)
let size = max(mx.x-mn.x, mx.y-mn.y, mx.z-mn.z)
let cam = SCNNode(); cam.camera = SCNCamera(); cam.camera!.zFar = Double(size*20); cam.camera!.zNear = Double(size/100)
scene.rootNode.addChildNode(cam)
let amb = SCNNode(); amb.light = SCNLight(); amb.light!.type = .ambient; amb.light!.intensity = 900
scene.rootNode.addChildNode(amb)
scene.background.contents = NSColor(white: 0.85, alpha: 1)
let r = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
r.scene = scene; r.pointOfView = cam
let views: [(String, Float, Float)] = [("front",0,0.15),("side",90,0.15),("back",180,0.15),("left",270,0.15),("top",0,1.4)]
for (name, az, el) in views {
    let a = CGFloat(az * .pi/180); let e = CGFloat(el); let d = CGFloat(size)*1.6
    let px: CGFloat = CGFloat(c.x) + d*sin(a)*cos(e)
    let py: CGFloat = CGFloat(c.y) + d*sin(e)
    let pz: CGFloat = CGFloat(c.z) + d*cos(a)*cos(e)
    cam.position = SCNVector3(px, py, pz)
    cam.look(at: c)
    let img = r.snapshot(atTime: 0, with: CGSize(width: 900, height: 700), antialiasingMode: .multisampling4X)
    let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
    try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outPrefix)-\(name).png"))
}
print("rendered")
