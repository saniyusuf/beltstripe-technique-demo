import Foundation
import SceneKit
// usage: obj2usdz <in.obj> <out.usdz>
let scene = try SCNScene(url: URL(fileURLWithPath: CommandLine.arguments[1]), options: nil)
scene.rootNode.enumerateHierarchy { n, _ in
  n.geometry?.materials.forEach { $0.lightingModel = .physicallyBased; $0.roughness.contents = 0.8 }
}
let ok = scene.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: nil, delegate: nil, progressHandler: nil)
print(ok ? "wrote" : "FAILED", CommandLine.arguments[2])
