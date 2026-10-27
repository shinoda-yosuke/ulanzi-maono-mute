// maono-hid — a short-lived helper that mutes a Maono microphone over HID, the real mute that lights the
// device's LED, without Maono Link. It prints one JSON line and exits; the plugin spawns it per action.
//
//   maono-hid status        -> {"devices":[{"id":"sn:MCT250728274","product":"Maono Wireless Mic RX",
//                               "serial":"MCT250728274","location":"02132000","muted":false}]}
//   maono-hid set 0|1 <id>  -> {"ok":true,"muted":true} | {"ok":false,"reason":"not-found|ambiguous|busy|failed"}
//
// Several receivers can be connected at once, so each is named by an id: "sn:<USB serial number>", or, for one
// that reports no serial, "loc:<USB location>" (the port it is plugged into). "status" lists every receiver with
// its mute; one that another app holds exclusively — Maono Link does while its panel shows that microphone — is
// listed with "busy":true instead.
//
// How it works (found by observing Maono Link, see README): the receiver ignores control writes until it is
// "woken" by a single control-mode write to register 0x000b (value 3). After that kick, a write to the mute
// register 0x207d (1 = mute, 0 = unmute) reaches the microphone and its LED, and the state latches even after
// the device is closed. So each run is: open -> kick -> read/write 0x207d -> close. Reports are sent exactly
// as Maono Link sends them: report ID 0, a 64-byte buffer whose first byte is 0xC4.
import IOKit.hid
import Foundation

let VENDOR = 0x352F            // Shenzhen Maono Technology
let PRODUCT = 0x040E           // Maono Wireless Mic RX, the PD200W's receiver: the only model this was verified on
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

func property<T>(_ device: IOHIDDevice, _ key: String) -> T? {
    IOHIDDeviceGetProperty(device, key as CFString) as? T
}

/// A connected receiver, as the system lists it (listing does not open it).
struct Receiver {
    let device: IOHIDDevice
    let product: String
    let serial: String
    let location: Int

    var locationHex: String { String(format: "%08x", location) }
    var id: String { serial.isEmpty ? "loc:\(locationHex)" : "sn:\(serial)" }
}

// Lives for the whole run: it owns the device references it lists
let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))

/// Every connected receiver, ordered by USB location so the order is stable from run to run.
func receivers() -> [Receiver] {
    IOHIDManagerSetDeviceMatching(manager, [
        kIOHIDVendorIDKey: VENDOR, kIOHIDProductIDKey: PRODUCT, kIOHIDPrimaryUsagePageKey: USAGE_PAGE,
    ] as CFDictionary)
    let devices = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
    return devices.map { device in
        Receiver(
            device: device,
            product: property(device, kIOHIDProductKey) ?? "Maono Wireless Mic RX",
            serial: (property(device, kIOHIDSerialNumberKey) ?? "").trimmingCharacters(in: .whitespaces),
            location: property(device, kIOHIDLocationIDKey) ?? 0
        )
    }.sorted { $0.location < $1.location }
}

/// One receiver, opened and woken. Replies to reads arrive as input reports while the run loop runs.
final class Session {
    let device: IOHIDDevice
    /// The mute read back from the receiver, once its reply has arrived
    var muted: Bool?
    private let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 64)

    /// nil when the receiver cannot be opened and woken: another app (Maono Link) holds it exclusively.
    init?(_ device: IOHIDDevice) {
        self.device = device
        guard IOHIDDeviceOpen(device, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess else { return nil }
        IOHIDDeviceRegisterInputReportCallback(device, buffer, 64, { context, _, _, _, _, rpt, len in
            // A reply to a read is a 0x0b frame carrying the register and its value
            guard let context, len > 8, rpt[1] == 0x0b else { return }
            guard (UInt16(rpt[5]) | (UInt16(rpt[6]) << 8)) == MUTE_REG else { return }
            Unmanaged<Session>.fromOpaque(context).takeUnretainedValue().muted =
                (UInt16(rpt[7]) | (UInt16(rpt[8]) << 8)) == 1
        }, Unmanaged.passUnretained(self).toOpaque())
        IOHIDDeviceScheduleWithRunLoop(device, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
        // If even the kick cannot be written, the device is not really ours (treat it as busy)
        guard send(KICK_HEX) else { close(); return nil }
    }

    deinit { buffer.deallocate() }

    func send(_ hex: String) -> Bool {
        let bytes = report(hex)
        let result = bytes.withUnsafeBufferPointer {
            IOHIDDeviceSetReport(device, kIOHIDReportTypeOutput, 0, $0.baseAddress!, bytes.count)
        }
        CFRunLoopRunInMode(.defaultMode, 0.06, false)
        return result == kIOReturnSuccess
    }

    /// Reads 0x207d back; nil if the receiver does not answer in time.
    func readMute() -> Bool? {
        guard send(READ_HEX) else { return nil }
        let deadline = Date().addingTimeInterval(0.4)
        while muted == nil && Date() < deadline { CFRunLoopRunInMode(.defaultMode, 0.02, false) }
        return muted
    }

    func close() {
        IOHIDDeviceUnscheduleFromRunLoop(device, CFRunLoopGetCurrent(), CFRunLoopMode.defaultMode.rawValue)
        IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone))
    }
}

let args = CommandLine.arguments
switch args.count >= 2 ? args[1] : "" {
case "status":
    let devices: [[String: Any]] = receivers().map { receiver in
        var entry: [String: Any] = [
            "id": receiver.id, "product": receiver.product, "serial": receiver.serial, "location": receiver.locationHex,
        ]
        if let session = Session(receiver.device) {
            if let muted = session.readMute() { entry["muted"] = muted } else { entry["muted"] = NSNull() }
            session.close()
        } else {
            entry["busy"] = true
        }
        return entry
    }
    emit(["devices": devices])

case "set":
    guard args.count >= 4, let value = Int(args[2]), value == 0 || value == 1 else {
        emit(["ok": false, "reason": "bad-request"]); exit(64)
    }
    // Never guess: with no receiver of that id, or several reporting the same serial, leave the mute alone
    let matches = receivers().filter { $0.id == args[3] }
    guard matches.count == 1 else { emit(["ok": false, "reason": matches.isEmpty ? "not-found" : "ambiguous"]); exit(0) }
    guard let session = Session(matches[0].device) else { emit(["ok": false, "reason": "busy"]); exit(0) }
    let ok = session.send(value == 1 ? MUTE_HEX : UNMUTE_HEX)
    CFRunLoopRunInMode(.defaultMode, 0.2, false) // let it settle before we close
    session.close()
    emit(ok ? ["ok": true, "muted": value == 1] : ["ok": false, "reason": "failed"])

default:
    emit(["ok": false, "reason": "bad-request"])
    exit(64)
}
