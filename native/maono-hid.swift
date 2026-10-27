// maono-hid — a short-lived helper that mutes a Maono microphone over HID, the real mute that lights the
// device's LED, without Maono Link. It prints one JSON line and exits; the plugin spawns it per action.
//
//   maono-hid get        -> {"available":true,"muted":false} | {"available":false,"reason":"..."}
//   maono-hid set 0|1    -> {"ok":true,"muted":true}         | {"ok":false,"reason":"..."}
//
// How it works (found by observing Maono Link, see README): the receiver ignores control writes until it is
// "woken" by a single control-mode write to register 0x000b (value 3). After that kick, a write to the mute
// register 0x207d (1 = mute, 0 = unmute) reaches the microphone and its LED, and the state latches even after
// the device is closed. So each run is: open -> kick -> read/write 0x207d -> close. Reports are sent exactly
// as Maono Link sends them: report ID 0, a 64-byte buffer whose first byte is 0xC4.
import IOKit.hid
import Foundation

let VENDOR = 0x352F            // Maono Wireless Mic RX
let USAGE_PAGE = 0x0C          // the consumer-control interface Maono Link drives
let MUTE_REG: UInt16 = 0x207d

// Captured verbatim from Maono Link. Each is report ID 0 + a 64-byte buffer beginning with 0xC4.
let KICK_HEX = "c40b0000060b0003001dff"       // write 0x000b = 3 (enter control mode)
let MUTE_HEX = "c40b0000037d20010090fe"       // write 0x207d = 1
let UNMUTE_HEX = "c40b0000037d20000091fe"     // write 0x207d = 0
let READ_HEX = "c4090000047d2092fe"            // read 0x207d (0x09 op)

func report(_ hex: String) -> [UInt8] {
    var out = [UInt8](); var i = hex.startIndex
    while i < hex.endIndex {
        let j = hex.index(i, offsetBy: 2, limitedBy: hex.endIndex) ?? hex.endIndex
        if let b = UInt8(hex[i..<j], radix: 16) { out.append(b) }; i = j
    }
    while out.count < 64 { out.append(0) }
    return Array(out.prefix(64))
}

func emit(_ obj: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: obj)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

let args = CommandLine.arguments
guard args.count >= 2 else { emit(["ok": false, "reason": "bad-request"]); exit(64) }
let cmd = args[1]
let setValue: Int? = cmd == "set" ? (args.count >= 3 ? Int(args[2]) : nil) : nil
if cmd == "set" && setValue == nil { emit(["ok": false, "reason": "bad-request"]); exit(64) }

// Open the receiver. A failure here means Maono Link is holding it exclusively, or it is not connected.
let mgr = IOHIDManagerCreate(kCFAllocatorDefault, 0)
IOHIDManagerSetDeviceMatching(mgr, [kIOHIDVendorIDKey: VENDOR] as CFDictionary)
IOHIDManagerScheduleWithRunLoop(mgr, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
let opened = IOHIDManagerOpen(mgr, 0) == kIOReturnSuccess
let device = (IOHIDManagerCopyDevices(mgr) as? Set<IOHIDDevice>)?.first {
    (IOHIDDeviceGetProperty($0, kIOHIDPrimaryUsagePageKey as CFString) as? Int) == USAGE_PAGE
}
guard opened, let dev = device else {
    let reason = device == nil && opened ? "no-device" : "busy"
    if cmd == "get" { emit(["available": false, "reason": reason]) } else { emit(["ok": false, "reason": reason]) }
    exit(0)
}

func send(_ bytes: [UInt8]) -> Bool {
    let r = bytes.withUnsafeBufferPointer {
        IOHIDDeviceSetReport(dev, kIOHIDReportTypeOutput, 0, $0.baseAddress!, bytes.count)
    }
    CFRunLoopRunInMode(.defaultMode, 0.06, false)
    return r == kIOReturnSuccess
}

// Wake the receiver. If even the kick cannot be written, the device is not really ours (treat as busy).
guard send(report(KICK_HEX)) else {
    if cmd == "get" { emit(["available": false, "reason": "busy"]) } else { emit(["ok": false, "reason": "busy"]) }
    exit(0)
}

if cmd == "set" {
    let ok = send(report(setValue == 0 ? UNMUTE_HEX : MUTE_HEX))
    CFRunLoopRunInMode(.defaultMode, 0.2, false) // let it settle before we close
    emit(ok ? ["ok": true, "muted": setValue == 1] : ["ok": false, "reason": "failed"])
    exit(0)
}

if cmd == "get" {
    // Read 0x207d back; the reply arrives as an input report (0x0b frame with the register and value).
    var muted: Bool? = nil
    final class Box { var v: Bool? = nil }
    let box = Box()
    let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 64)
    let cb: IOHIDReportCallback = { ctx, _, _, _, _, rpt, len in
        guard len > 8, rpt[1] == 0x0b else { return }
        let reg = UInt16(rpt[5]) | (UInt16(rpt[6]) << 8)
        guard reg == MUTE_REG else { return }
        Unmanaged<Box>.fromOpaque(ctx!).takeUnretainedValue().v = (UInt16(rpt[7]) | (UInt16(rpt[8]) << 8)) == 1
    }
    IOHIDDeviceRegisterInputReportCallback(dev, buf, 64, cb, Unmanaged.passUnretained(box).toOpaque())
    _ = send(report(READ_HEX))
    CFRunLoopRunInMode(.defaultMode, 0.4, false)
    muted = box.v
    if let m = muted { emit(["available": true, "muted": m]) } else { emit(["available": true, "muted": NSNull()]) }
    exit(0)
}

emit(["ok": false, "reason": "bad-request"])
exit(64)
