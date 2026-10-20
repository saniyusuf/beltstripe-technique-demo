import Foundation
import RealityKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: objcap <inputDir> <out.usdz> [reduced|medium|full]"); exit(2) }
let input = URL(fileURLWithPath: args[1], isDirectory: true)
let output = URL(fileURLWithPath: args[2])
let detailArg = args.count > 3 ? args[3] : "reduced"
let detail: PhotogrammetrySession.Request.Detail = detailArg == "medium" ? .medium : (detailArg == "full" ? .full : .reduced)

var config = PhotogrammetrySession.Configuration()
config.featureSensitivity = .high
config.sampleOrdering = .sequential
let session = try PhotogrammetrySession(input: input, configuration: config)
let request = PhotogrammetrySession.Request.modelFile(url: output, detail: detail)
let sem = DispatchSemaphore(value: 0)
var lastPct = -1
Task {
    do {
        for try await o in session.outputs {
            switch o {
            case .processingComplete: print("DONE"); sem.signal()
            case .requestError(_, let e): print("ERR \(e)")
            case .requestComplete(_, let r): print("request complete \(r)")
            case .requestProgress(_, let f):
                let p = Int(f * 100); if p / 10 != lastPct / 10 { print("progress \(p)%"); lastPct = p }
            case .inputComplete: print("input complete")
            case .invalidSample(let id, let reason): print("invalid sample \(id): \(reason)")
            case .skippedSample(let id): print("skipped sample \(id)")
            case .automaticDownsampling: print("automatic downsampling")
            case .processingCancelled: print("cancelled"); sem.signal()
            default: print("other: \(o)")
            }
        }
    } catch { print("stream error \(error)"); sem.signal() }
}
try session.process(requests: [request])
sem.wait()
