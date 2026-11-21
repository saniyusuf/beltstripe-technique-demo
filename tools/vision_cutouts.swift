// Fighter cut-outs + body-pose keypoints with Apple Vision (on-device, free).
//
// Usage (from the repo root):
//   swift tools/vision_cutouts.swift [frames-dir] [move-step ...]
//
// For every frames/<move>-<step>/NN.jpg it writes:
//   cutouts/<move>-<step>/NN.webp  fighters only, transparent background, 1px feathered edge
//   pose/<move>-<step>.json        {"w","h","frames":[[{"joints":{name:[x,y,c]}}...people]...frames]}
//   qa/<move>-<step>.jpg           contact sheet (every 8th frame, grey bg, skeletons drawn)
//   qa/stats/<move>-<step>.json    per-frame instance / pose counts and mask coverage
//
// Needs cwebp on PATH for WebP (brew install webp); falls back to PNG otherwise.

import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let FILE_MANAGER = FileManager.default
let ROOT = URL(fileURLWithPath: FILE_MANAGER.currentDirectoryPath)
let ARGS = Array(CommandLine.arguments.dropFirst())
let FRAMES_DIR = ROOT.appendingPathComponent(ARGS.first ?? "frames")
let ONLY_POSES = Set(ARGS.dropFirst())
let CI_CONTEXT = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
let SRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func findTool(_ NAME: String) -> String? {
  for DIR in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
    let PATH = "\(DIR)/\(NAME)"
    if FILE_MANAGER.isExecutableFile(atPath: PATH) { return PATH }
  }
  return nil
}
let CWEBP = findTool("cwebp")

// Vision joint -> snake_case name used in the JSON.
let JOINTS: [(VNHumanBodyPoseObservation.JointName, String)] = [
  (.nose, "nose"), (.leftEye, "left_eye"), (.rightEye, "right_eye"),
  (.leftEar, "left_ear"), (.rightEar, "right_ear"), (.neck, "neck"),
  (.leftShoulder, "left_shoulder"), (.rightShoulder, "right_shoulder"),
  (.leftElbow, "left_elbow"), (.rightElbow, "right_elbow"),
  (.leftWrist, "left_wrist"), (.rightWrist, "right_wrist"), (.root, "root"),
  (.leftHip, "left_hip"), (.rightHip, "right_hip"),
  (.leftKnee, "left_knee"), (.rightKnee, "right_knee"),
  (.leftAnkle, "left_ankle"), (.rightAnkle, "right_ankle"),
]
let BONES: [(String, String)] = [
  ("nose", "neck"), ("neck", "left_shoulder"), ("neck", "right_shoulder"),
  ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"),
  ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
  ("neck", "root"), ("root", "left_hip"), ("root", "right_hip"),
  ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
  ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
  ("nose", "left_eye"), ("nose", "right_eye"), ("left_eye", "left_ear"), ("right_eye", "right_ear"),
]
let MIN_JOINT_CONFIDENCE: Float = 0.1   // kept in the JSON
let DRAW_JOINT_CONFIDENCE = 0.3          // drawn on the QA sheet

typealias Person = [String: [Double]]

struct FrameResult {
  let CUTOUT: CGImage
  let PEOPLE: [Person]
  let INSTANCES: Int
  let COVERAGE: Double
  let METHOD: String
}

// MARK: - Masks

func personMask(_ HANDLER: VNImageRequestHandler, _ W: Int, _ H: Int) throws -> (CIImage, Int, String) {
  if #available(macOS 14.0, *) {
    let REQUEST = VNGeneratePersonInstanceMaskRequest()
    try HANDLER.perform([REQUEST])
    if let OBS = REQUEST.results?.first, !OBS.allInstances.isEmpty {
      // Merge every person instance into one mask so both fighters stay, even when grappling.
      let BUFFER = try OBS.generateScaledMaskForImage(forInstances: OBS.allInstances, from: HANDLER)
      let INSTANCE_MASK = CIImage(cvPixelBuffer: BUFFER)
      // The instance model sometimes drops a body part where fighters overlap; union with the
      // whole-scene person segmentation to fill those gaps.
      if let SEG = try? segmentationMask(HANDLER, W, H) {
        return (INSTANCE_MASK.applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: SEG]),
                OBS.allInstances.count, "instance+segmentation")
      }
      return (INSTANCE_MASK, OBS.allInstances.count, "instance")
    }
  }
  if let SEG = try segmentationMask(HANDLER, W, H) { return (SEG, -1, "segmentation") }
  return (CIImage(color: .black).cropped(to: CGRect(x: 0, y: 0, width: W, height: H)), 0, "none")
}

func segmentationMask(_ HANDLER: VNImageRequestHandler, _ W: Int, _ H: Int) throws -> CIImage? {
  let REQUEST = VNGeneratePersonSegmentationRequest()
  REQUEST.qualityLevel = .accurate
  REQUEST.outputPixelFormat = kCVPixelFormatType_OneComponent8
  try HANDLER.perform([REQUEST])
  guard let OBS = REQUEST.results?.first else { return nil }
  let MASK = CIImage(cvPixelBuffer: OBS.pixelBuffer)
  return MASK.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / MASK.extent.width,
                                                y: CGFloat(H) / MASK.extent.height))
}

func maskCoverage(_ MASK: CIImage) -> Double {
  let AVG = CIFilter.areaAverage()
  AVG.inputImage = MASK
  AVG.extent = MASK.extent
  var PIXEL = [Float](repeating: 0, count: 4)
  CI_CONTEXT.render(AVG.outputImage!, toBitmap: &PIXEL, rowBytes: 16,
                    bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBAf, colorSpace: nil)
  return Double(PIXEL[0])
}

// MARK: - Per frame

func processFrame(_ URL_IN: URL) throws -> FrameResult {
  let SOURCE = CIImage(contentsOf: URL_IN)!
  let W = Int(SOURCE.extent.width), H = Int(SOURCE.extent.height)
  let RECT = CGRect(x: 0, y: 0, width: W, height: H)
  let HANDLER = VNImageRequestHandler(url: URL_IN, options: [:])

  let (RAW_MASK, INSTANCES, METHOD) = try personMask(HANDLER, W, H)
  // Vision's mask is soft (body pixels often < 1), which would leave the fighters see-through.
  // Harden it with a contrast curve around 0.5 (<=0.375 -> 0, >=0.625 -> 1), then feather the edge by ~1px.
  let HARD = RAW_MASK.applyingFilter("CIColorMatrix", parameters: [
    "inputRVector": CIVector(x: 4, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 4, y: 0, z: 0, w: 0),
    "inputBVector": CIVector(x: 4, y: 0, z: 0, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
    "inputBiasVector": CIVector(x: -1.5, y: -1.5, z: -1.5, w: 0),
  ]).applyingFilter("CIColorClamp")
  let FEATHERED = HARD.clampedToExtent().applyingGaussianBlur(sigma: 0.8).cropped(to: RECT)
  let BLEND = CIFilter.blendWithMask()
  BLEND.inputImage = SOURCE
  BLEND.backgroundImage = CIImage(color: .clear).cropped(to: RECT)
  BLEND.maskImage = FEATHERED
  let CUTOUT = CI_CONTEXT.createCGImage(BLEND.outputImage!, from: RECT, format: .RGBA8, colorSpace: SRGB)!

  let POSE = VNDetectHumanBodyPoseRequest()
  try HANDLER.perform([POSE])
  var PEOPLE: [Person] = []
  for OBS in POSE.results ?? [] {
    var PERSON: Person = [:]
    for (JOINT, NAME) in JOINTS {
      guard let P = try? OBS.recognizedPoint(JOINT), P.confidence >= MIN_JOINT_CONFIDENCE else { continue }
      PERSON[NAME] = [(P.location.x * Double(W) * 10).rounded() / 10,
                      ((1 - P.location.y) * Double(H) * 10).rounded() / 10,
                      (Double(P.confidence) * 1000).rounded() / 1000]
    }
    if !PERSON.isEmpty { PEOPLE.append(PERSON) }
  }
  return FrameResult(CUTOUT: CUTOUT, PEOPLE: PEOPLE, INSTANCES: INSTANCES,
                     COVERAGE: maskCoverage(RAW_MASK.cropped(to: RECT)), METHOD: METHOD)
}

func writeImage(_ IMAGE: CGImage, to URL_OUT: URL, type: UTType, quality: Double? = nil) {
  let DEST = CGImageDestinationCreateWithURL(URL_OUT as CFURL, type.identifier as CFString, 1, nil)!
  var PROPS: [CFString: Any] = [:]
  if let Q = quality { PROPS[kCGImageDestinationLossyCompressionQuality] = Q }
  CGImageDestinationAddImage(DEST, IMAGE, PROPS as CFDictionary)
  CGImageDestinationFinalize(DEST)
}

func saveCutout(_ IMAGE: CGImage, _ OUT_BASE: URL) {
  let PNG = OUT_BASE.appendingPathExtension("png")
  writeImage(IMAGE, to: PNG, type: .png)
  guard let CWEBP else { return }
  let WEBP = OUT_BASE.appendingPathExtension("webp")
  let PROC = Process()
  PROC.executableURL = URL(fileURLWithPath: CWEBP)
  PROC.arguments = ["-quiet", "-q", "82", "-alpha_q", "90", PNG.path, "-o", WEBP.path]
  try! PROC.run()
  PROC.waitUntilExit()
  if PROC.terminationStatus == 0 { try? FILE_MANAGER.removeItem(at: PNG) }
}

// MARK: - QA contact sheet

let PERSON_COLOURS: [CGColor] = [
  CGColor(red: 1.0, green: 0.25, blue: 0.2, alpha: 1), CGColor(red: 0.1, green: 0.6, blue: 1.0, alpha: 1),
  CGColor(red: 1.0, green: 0.8, blue: 0.0, alpha: 1), CGColor(red: 0.2, green: 0.85, blue: 0.3, alpha: 1),
]

func contactSheet(_ CELLS: [(Int, CGImage, [Person], Int)], W: Int, H: Int, title: String) -> CGImage {
  let COLS = 4, TILE_W = 400
  let TILE_H = TILE_W * H / W
  let LABEL_H = 18, HEADER_H = 30
  let ROWS = (CELLS.count + COLS - 1) / COLS
  let SHEET_W = COLS * TILE_W, SHEET_H = HEADER_H + ROWS * (TILE_H + LABEL_H)
  let CTX = CGContext(data: nil, width: SHEET_W, height: SHEET_H, bitsPerComponent: 8, bytesPerRow: 0,
                      space: SRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  CTX.setFillColor(CGColor(gray: 0.5, alpha: 1))
  CTX.fill(CGRect(x: 0, y: 0, width: SHEET_W, height: SHEET_H))
  NSGraphicsContext.current = NSGraphicsContext(cgContext: CTX, flipped: false)
  let ATTRS: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 13), .foregroundColor: NSColor.white]
  (title as NSString).draw(at: CGPoint(x: 8, y: SHEET_H - HEADER_H + 8),
                           withAttributes: [.font: NSFont.boldSystemFont(ofSize: 16), .foregroundColor: NSColor.white])
  let SCALE = Double(TILE_W) / Double(W)
  for (I, (FRAME, IMAGE, PEOPLE, INSTANCES)) in CELLS.enumerated() {
    let OX = (I % COLS) * TILE_W
    let OY = SHEET_H - HEADER_H - (I / COLS + 1) * (TILE_H + LABEL_H)
    CTX.draw(IMAGE, in: CGRect(x: OX, y: OY, width: TILE_W, height: TILE_H))
    CTX.setStrokeColor(CGColor(gray: 0.35, alpha: 1)); CTX.setLineWidth(1)
    CTX.stroke(CGRect(x: OX, y: OY, width: TILE_W, height: TILE_H + LABEL_H))
    for (P, PERSON) in PEOPLE.enumerated() {
      let COLOUR = PERSON_COLOURS[P % PERSON_COLOURS.count]
      func pt(_ J: [Double]) -> CGPoint { CGPoint(x: Double(OX) + J[0] * SCALE, y: Double(OY) + (Double(H) - J[1]) * SCALE) }
      CTX.setStrokeColor(COLOUR); CTX.setLineWidth(2)
      for (A, B) in BONES { if let JA = PERSON[A], let JB = PERSON[B], JA[2] >= DRAW_JOINT_CONFIDENCE, JB[2] >= DRAW_JOINT_CONFIDENCE { CTX.move(to: pt(JA)); CTX.addLine(to: pt(JB)); CTX.strokePath() } }
      CTX.setFillColor(COLOUR)
      for J in PERSON.values where J[2] >= DRAW_JOINT_CONFIDENCE { let C = pt(J); CTX.fillEllipse(in: CGRect(x: C.x - 2.5, y: C.y - 2.5, width: 5, height: 5)) }
    }
    let LABEL = String(format: "#%02d  people(mask)=%@  skeletons=%d", FRAME, INSTANCES < 0 ? "?" : "\(INSTANCES)", PEOPLE.count)
    (LABEL as NSString).draw(at: CGPoint(x: OX + 6, y: OY + TILE_H + 2), withAttributes: ATTRS)
  }
  NSGraphicsContext.current = nil
  return CTX.makeImage()!
}

// MARK: - Main

let POSE_DIRS = try FILE_MANAGER.contentsOfDirectory(atPath: FRAMES_DIR.path)
  .filter { !$0.hasPrefix(".") && (ONLY_POSES.isEmpty || ONLY_POSES.contains($0)) }
  .sorted()
for DIR in ["cutouts", "pose", "qa", "qa/stats"] {
  try FILE_MANAGER.createDirectory(at: ROOT.appendingPathComponent(DIR), withIntermediateDirectories: true)
}
print("cwebp: \(CWEBP ?? "not found, writing PNG")")

for POSE_NAME in POSE_DIRS {
  let START = Date()
  let IN_DIR = FRAMES_DIR.appendingPathComponent(POSE_NAME)
  let OUT_DIR = ROOT.appendingPathComponent("cutouts").appendingPathComponent(POSE_NAME)
  try FILE_MANAGER.createDirectory(at: OUT_DIR, withIntermediateDirectories: true)
  let FILES = try FILE_MANAGER.contentsOfDirectory(atPath: IN_DIR.path).filter { $0.hasSuffix(".jpg") }.sorted()
  var ALL_FRAMES: [[[String: Person]]] = []
  var STATS: [[String: Any]] = []
  var CELLS: [(Int, CGImage, [Person], Int)] = []
  var SIZE = (1152, 768)
  for (INDEX, FILE) in FILES.enumerated() {
    let RESULT = try autoreleasepool { try processFrame(IN_DIR.appendingPathComponent(FILE)) }
    SIZE = (RESULT.CUTOUT.width, RESULT.CUTOUT.height)
    saveCutout(RESULT.CUTOUT, OUT_DIR.appendingPathComponent((FILE as NSString).deletingPathExtension))
    ALL_FRAMES.append(RESULT.PEOPLE.map { ["joints": $0] })
    STATS.append(["frame": INDEX, "instances": RESULT.INSTANCES, "skeletons": RESULT.PEOPLE.count,
                  "coverage": (RESULT.COVERAGE * 10000).rounded() / 10000, "method": RESULT.METHOD])
    if INDEX % 8 == 0 { CELLS.append((INDEX, RESULT.CUTOUT, RESULT.PEOPLE, RESULT.INSTANCES)) }
  }
  let POSE_JSON: [String: Any] = ["w": SIZE.0, "h": SIZE.1, "frames": ALL_FRAMES]
  try JSONSerialization.data(withJSONObject: POSE_JSON, options: [.sortedKeys])
    .write(to: ROOT.appendingPathComponent("pose/\(POSE_NAME).json"))
  try JSONSerialization.data(withJSONObject: STATS, options: [.sortedKeys])
    .write(to: ROOT.appendingPathComponent("qa/stats/\(POSE_NAME).json"))
  let SHEET = contactSheet(CELLS, W: SIZE.0, H: SIZE.1, title: "\(POSE_NAME) — every 8th frame")
  writeImage(SHEET, to: ROOT.appendingPathComponent("qa/\(POSE_NAME).jpg"), type: .jpeg, quality: 0.82)
  let ODD = STATS.filter { ($0["instances"] as! Int) != 2 || ($0["skeletons"] as! Int) != 2 }.map { $0["frame"] as! Int }
  print(String(format: "%@: %d frames in %.1fs; frames without 2 masks + 2 skeletons: %@",
               POSE_NAME, FILES.count, Date().timeIntervalSince(START), ODD.isEmpty ? "none" : "\(ODD)"))
}
