// micmute-helper: lets the plugin's Node.js main service, which cannot speak USB-HID, mute a Maono microphone
// over HID — the same register write Maono Link's mute button sends, so it works without Maono Link running.
//
// It speaks JSON lines over stdin/stdout:
//   → {"id":1,"cmd":"setMute","muted":true}   ← {"id":1,"ok":true,"muted":true}
//   → {"id":2,"cmd":"list"}                    ← {"id":2,"ok":true,"devices":[…]}
//   ← {"event":"devices","devices":[…]}  on start and whenever a Maono microphone is plugged in or out
// Failed commands answer {"id":…,"ok":false,"error":"no-device" | "busy" | "failed" | "bad-request"}.
// "busy" means Maono Link holds the microphone exclusively right now; the caller should fall back to IPC.
//
// It never holds the device open: it opens only to write and closes immediately, so Maono Link can always
// seize it. Diagnostics go to stderr. It exits when stdin closes, so it never outlives the main service.
//   micmute-helper list   prints the Maono microphones once and exits (for troubleshooting).

import IOKit.hid
import Foundation

// Maono's USB vendor id. The control interface is the Consumer-Control one (usage page 0x0C) whose
// numbered report 0xC4 carries 63-byte register packets.
let MAONO_VENDOR_ID = 0x352F
let CONSUMER_USAGE_PAGE = 0x0C
let REPORT_ID: UInt8 = 0xC4
// Register 0x45 is the microphone mute (value 1 = muted); the same register Maono Link writes.
let MUTE_REGISTER: UInt16 = 0x45

func logError(_ message: String) {
    FileHandle.standardError.write(Data("micmute-helper: \(message)\n".utf8))
}

/// The 63-byte payload of a register write, after the 0xC4 report id, exactly as Maono Link builds it.
/// An additive checksum makes the whole packet sum to zero.
func writePacket(register: UInt16, value: UInt16) -> [UInt8] {
    var p = [UInt8](repeating: 0, count: 63)
    p[0] = 0x0B
    p[3] = 0x03
    p[4] = UInt8(register & 0xff)
    p[5] = UInt8(register >> 8)
    p[6] = UInt8(value & 0xff)
    p[7] = UInt8(value >> 8)
    let sum: Int = 0xD2 + Int(p[4]) + Int(p[5]) + Int(p[6]) + Int(p[7])
    let checksum = UInt16((0x10000 - sum) & 0xffff)
    p[8] = UInt8(checksum & 0xff)
    p[9] = UInt8(checksum >> 8)
    return p
}

func productName(_ device: IOHIDDevice) -> String {
    (IOHIDDeviceGetProperty(device, kIOHIDProductKey as CFString) as? String) ?? "Maono microphone"
}

/// Opens the device, writes the packet, then closes it — so the device is never held between operations.
func writeRegister(_ device: IOHIDDevice, _ payload: [UInt8]) -> IOReturn {
    let opened = IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone))
    guard opened == kIOReturnSuccess else { return opened }
    defer { IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone)) }
    return payload.withUnsafeBufferPointer {
        IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, CFIndex(REPORT_ID), $0.baseAddress!, payload.count)
    }
}

struct MaonoDevice {
    let device: IOHIDDevice
    let name: String
    /// The input mute as last set, or nil when we have not set it yet.
    var muted: Bool?
    /// Whether our last write could open the device (false while Maono Link holds it); optimistic until tried.
    var controllable: Bool

    var json: [String: Any] {
        ["name": name, "controllable": controllable, "muted": muted.map { $0 as Any } ?? NSNull()]
    }
}

/// Tracks the Maono microphones and performs the mute writes. All state lives on the main run loop; the
/// IOHIDManager callbacks and the stdin reader post their work there, so nothing races.
final class Helper {
    let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
    private var devices: [IOHIDDevice: MaonoDevice] = [:]
    private var lastSent: Data?

    func start() {
        setMatching()
        let added: IOHIDDeviceCallback = { context, _, _, device in
            Unmanaged<Helper>.fromOpaque(context!).takeUnretainedValue().onAdded(device)
        }
        let removed: IOHIDDeviceCallback = { context, _, _, device in
            Unmanaged<Helper>.fromOpaque(context!).takeUnretainedValue().onRemoved(device)
        }
        let context = Unmanaged.passUnretained(self).toOpaque()
        IOHIDManagerRegisterDeviceMatchingCallback(manager, added, context)
        IOHIDManagerRegisterDeviceRemovalCallback(manager, removed, context)
        // Schedule on the main run loop, but do NOT open the manager: opening would seize the device.
        IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue)
        sendDevices()
        readStdin()
    }

    private func setMatching() {
        let matching = [kIOHIDVendorIDKey: MAONO_VENDOR_ID, kIOHIDDeviceUsagePageKey: CONSUMER_USAGE_PAGE]
        IOHIDManagerSetDeviceMatching(manager, matching as CFDictionary)
    }

    private func onAdded(_ device: IOHIDDevice) {
        devices[device] = MaonoDevice(device: device, name: productName(device), muted: nil, controllable: true)
        sendDevices()
    }

    private func onRemoved(_ device: IOHIDDevice) {
        if devices.removeValue(forKey: device) != nil { sendDevices() }
    }

    private func handle(_ line: String) {
        guard let data = line.data(using: .utf8),
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = request["id"]
        else {
            logError("ignored a request without an id: \(line)")
            return
        }
        let reply = { (fields: [String: Any]) in self.writeLine(fields.merging(["id": id]) { $1 }) }

        switch request["cmd"] as? String {
        case "list":
            reply(["ok": true, "devices": devices.values.map(\.json)])
        case "setMute":
            guard let muted = request["muted"] as? Bool else { return reply(["ok": false, "error": "bad-request"]) }
            guard let key = devices.keys.first else { return reply(["ok": false, "error": "no-device"]) }
            var entry = devices[key]!
            let status = writeRegister(entry.device, writePacket(register: MUTE_REGISTER, value: muted ? 1 : 0))
            entry.controllable = status == kIOReturnSuccess
            if status == kIOReturnSuccess { entry.muted = muted }
            devices[key] = entry
            if status == kIOReturnSuccess {
                reply(["ok": true, "muted": muted])
            } else {
                // kIOReturnExclusiveAccess / kIOReturnNotOpen: Maono Link holds it
                reply(["ok": false, "error": status == kIOReturnExclusiveAccess ? "busy" : "failed", "status": Int(status)])
            }
            sendDevices()
        default:
            reply(["ok": false, "error": "bad-request"])
        }
    }

    private func sendDevices() {
        let message: [String: Any] = ["event": "devices", "devices": devices.values.map(\.json)]
        let snapshot = try? JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
        guard snapshot == nil || snapshot != lastSent else { return }
        lastSent = snapshot
        writeLine(message)
    }

    private func writeLine(_ object: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else {
            logError("cannot encode \(object)")
            return
        }
        data.append(0x0A)
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = write(STDOUT_FILENO, raw.baseAddress! + offset, raw.count - offset)
                if n < 0 && errno == EINTR { continue }
                if n <= 0 { exit(0) } // the main service is gone
                offset += n
            }
        }
    }

    private func readStdin() {
        Thread.detachNewThread {
            while let line = readLine() {
                CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) { self.handle(line) }
                CFRunLoopWakeUp(CFRunLoopGetMain())
            }
            // stdin closed: the main service quit
            CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) { exit(0) }
            CFRunLoopWakeUp(CFRunLoopGetMain())
        }
    }

    /// Prints the devices once (for `micmute-helper list`), writing nothing to them.
    func listOnce() {
        setMatching()
        let found = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
        let list = found.map { MaonoDevice(device: $0, name: productName($0), muted: nil, controllable: true).json }
        let data = try! JSONSerialization.data(withJSONObject: list, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        print(String(decoding: data, as: UTF8.self))
    }
}

signal(SIGPIPE, SIG_IGN)

switch CommandLine.arguments.dropFirst().first {
case "list":
    Helper().listOnce()
case nil, "serve":
    Helper().start()
    CFRunLoopRun()
default:
    logError("usage: micmute-helper [serve | list]")
    exit(64)
}
