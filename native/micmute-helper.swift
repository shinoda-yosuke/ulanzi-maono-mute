// micmute-helper: lets the plugin's Node.js main service, which cannot call CoreAudio itself,
// read and change the mute of audio input devices. It speaks JSON lines over stdin/stdout:
//
//   → {"id":1,"cmd":"toggleMute","uid":"<device UID>"}            ← {"id":1,"ok":true,"muted":true}
//   → {"id":2,"cmd":"setMute","uid":"<device UID>","muted":false}  ← {"id":2,"ok":true,"muted":false}
//   → {"id":3,"cmd":"list"}                                        ← {"id":3,"ok":true,"devices":[…]}
//   ← {"event":"devices","devices":[…]}  on start and whenever input devices or their mute change
//
// Failed commands answer {"id":…,"ok":false,"error":"not-found" | "not-supported" | "failed" | "bad-request"}.
// Diagnostics go to stderr. The helper exits when stdin closes, so it never outlives the main service.
// `micmute-helper list` prints the input devices once and exits (for troubleshooting).

import CoreAudio
import Foundation

let systemObject = AudioObjectID(kAudioObjectSystemObject)

func address(
    _ selector: AudioObjectPropertySelector,
    _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
    _ element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: element)
}

func sameAddress(_ lhs: AudioObjectPropertyAddress, _ rhs: AudioObjectPropertyAddress) -> Bool {
    lhs.mSelector == rhs.mSelector && lhs.mScope == rhs.mScope && lhs.mElement == rhs.mElement
}

func logError(_ message: String) {
    FileHandle.standardError.write(Data("micmute-helper: \(message)\n".utf8))
}

func readUInt32(_ object: AudioObjectID, _ addr: AudioObjectPropertyAddress) -> UInt32? {
    var addr = addr
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr, let value else { return nil }
    return value.takeRetainedValue() as String
}

func readDeviceIDs() -> [AudioObjectID] {
    var addr = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    var status = AudioObjectGetPropertyDataSize(systemObject, &addr, 0, nil, &size)
    guard status == noErr else {
        logError("cannot list audio devices (OSStatus \(status))")
        return []
    }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    status = AudioObjectGetPropertyData(systemObject, &addr, 0, nil, &size, &ids)
    guard status == noErr else {
        logError("cannot list audio devices (OSStatus \(status))")
        return []
    }
    // The list can shrink between the two calls
    return Array(ids.prefix(Int(size) / MemoryLayout<AudioObjectID>.size))
}

func inputChannelCount(_ device: AudioObjectID) -> Int {
    var addr = address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, raw) == noErr else { return 0 }
    let buffers = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return buffers.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func transportName(_ device: AudioObjectID) -> String {
    switch readUInt32(device, address(kAudioDevicePropertyTransportType)) {
    case kAudioDeviceTransportTypeUSB: return "usb"
    case kAudioDeviceTransportTypeBuiltIn: return "builtin"
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
    case kAudioDeviceTransportTypeVirtual: return "virtual"
    case kAudioDeviceTransportTypeAggregate, kAudioDeviceTransportTypeAutoAggregate: return "aggregate"
    default: return "other"
    }
}

func muteAddress(_ element: AudioObjectPropertyElement) -> AudioObjectPropertyAddress {
    address(kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput, element)
}

/// Elements whose input mute has to change to mute the whole device: the main element when the device has a
/// settable mute there, otherwise every channel. Empty when the device cannot be muted.
func muteElements(_ device: AudioObjectID, channels: Int) -> [AudioObjectPropertyElement] {
    func settable(_ element: AudioObjectPropertyElement) -> Bool {
        var addr = muteAddress(element)
        guard AudioObjectHasProperty(device, &addr) else { return false }
        var settable: DarwinBoolean = false
        return AudioObjectIsPropertySettable(device, &addr, &settable) == noErr && settable.boolValue
    }
    if settable(kAudioObjectPropertyElementMain) { return [kAudioObjectPropertyElementMain] }
    guard channels > 0 else { return [] }
    let perChannel = (1...channels).map { AudioObjectPropertyElement($0) }
    // Muting only some channels would leave the device live
    return perChannel.allSatisfy(settable) ? perChannel : []
}

struct InputDevice {
    let id: AudioObjectID
    let uid: String
    let name: String
    let manufacturer: String
    let transport: String
    let isDefault: Bool
    let muteElements: [AudioObjectPropertyElement]
    /// nil when the device cannot be muted or its mute could not be read
    let muted: Bool?

    var canMute: Bool { !muteElements.isEmpty }

    var json: [String: Any] {
        [
            "uid": uid,
            "name": name,
            "manufacturer": manufacturer,
            "transport": transport,
            "isDefault": isDefault,
            "canMute": canMute,
            "muted": muted.map { $0 as Any } ?? NSNull(),
        ]
    }
}

func readInputDevices() -> [InputDevice] {
    let defaultInput = readUInt32(systemObject, address(kAudioHardwarePropertyDefaultInputDevice))
    return readDeviceIDs().compactMap { id in
        let channels = inputChannelCount(id)
        // Output-only devices, and devices that vanished while being read
        guard channels > 0, let uid = readString(id, kAudioDevicePropertyDeviceUID) else { return nil }
        let elements = muteElements(id, channels: channels)
        let values = elements.map { readUInt32(id, muteAddress($0)) }
        if values.contains(nil) { logError("cannot read the mute of \(uid)") }
        return InputDevice(
            id: id,
            uid: uid,
            name: readString(id, kAudioObjectPropertyName) ?? uid,
            manufacturer: readString(id, kAudioObjectPropertyManufacturer) ?? "",
            transport: transportName(id),
            isDefault: id == defaultInput,
            muteElements: elements,
            muted: elements.isEmpty || values.contains(nil) ? nil : values.allSatisfy { $0 != 0 }
        )
    }
}

/// Sets the mute of every element; returns the first failing status, or noErr.
func setMute(_ device: InputDevice, _ muted: Bool) -> OSStatus {
    for element in device.muteElements {
        var addr = muteAddress(element)
        var value: UInt32 = muted ? 1 : 0
        let status = AudioObjectSetPropertyData(device.id, &addr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value)
        if status != noErr { return status }
    }
    return noErr
}

func writeLine(_ object: [String: Any]) {
    var data: Data
    do {
        data = try JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes])
    } catch {
        logError("cannot encode \(object): \(error)")
        return
    }
    data.append(0x0A)
    data.withUnsafeBytes { buffer in
        var offset = 0
        while offset < buffer.count {
            let written = write(STDOUT_FILENO, buffer.baseAddress! + offset, buffer.count - offset)
            if written < 0 && errno == EINTR { continue }
            // The main service is gone
            if written <= 0 { exit(0) }
            offset += written
        }
    }
}

/// Serves commands and change notifications. Everything runs on `queue`, so CoreAudio calls and output never interleave.
final class Server {
    let queue = DispatchQueue(label: "micmute-helper")
    private var watched: [AudioObjectID: [AudioObjectPropertyAddress]] = [:]
    private var lastSent: Data?
    private var sendScheduled = false
    // One block object, so that the same listener can be removed again
    private lazy var listener: AudioObjectPropertyListenerBlock = { [unowned self] _, _ in
        self.scheduleSend()
    }

    func start() {
        queue.async {
            for selector in [kAudioHardwarePropertyDevices, kAudioHardwarePropertyDefaultInputDevice] {
                self.listen(systemObject, address(selector))
            }
            self.sendDevices()
        }
        Thread.detachNewThread {
            while let line = readLine() {
                self.queue.async { self.handle(line) }
            }
            // stdin closed: the main service quit or crashed
            self.queue.async { exit(0) }
        }
    }

    private func listen(_ object: AudioObjectID, _ addr: AudioObjectPropertyAddress) {
        var addr = addr
        let status = AudioObjectAddPropertyListenerBlock(object, &addr, queue, listener)
        if status != noErr { logError("cannot watch property \(addr.mSelector) of object \(object) (OSStatus \(status))") }
    }

    /// Coalesces the bursts of notifications a single change causes (e.g. one per channel).
    private func scheduleSend() {
        guard !sendScheduled else { return }
        sendScheduled = true
        queue.asyncAfter(deadline: .now() + .milliseconds(50)) {
            self.sendScheduled = false
            self.sendDevices()
        }
    }

    private func sendDevices() {
        let devices = readInputDevices()
        watch(devices)
        let message: [String: Any] = ["event": "devices", "devices": devices.map(\.json)]
        // Report changes only; a listener can fire without a visible change, e.g. for another channel
        let snapshot = try? JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
        guard snapshot == nil || snapshot != lastSent else { return }
        lastSent = snapshot
        writeLine(message)
    }

    /// Listens to the mute of current devices and to their channel layout, which decides the mute elements.
    private func watch(_ devices: [InputDevice]) {
        let current = Set(devices.map(\.id))
        for (id, addresses) in watched where !current.contains(id) {
            // Fails when the device is already gone, which takes its listeners with it
            for var addr in addresses { AudioObjectRemovePropertyListenerBlock(id, &addr, queue, listener) }
            watched[id] = nil
        }
        for device in devices {
            var addresses = watched[device.id] ?? []
            let wanted = [address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)]
                + device.muteElements.map(muteAddress)
            for addr in wanted where !addresses.contains(where: { sameAddress($0, addr) }) {
                listen(device.id, addr)
                addresses.append(addr)
            }
            watched[device.id] = addresses
        }
    }

    private func handle(_ line: String) {
        guard let data = line.data(using: .utf8),
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = request["id"]
        else {
            logError("ignored a request without an id: \(line)")
            return
        }
        let reply = { (fields: [String: Any]) in writeLine(fields.merging(["id": id]) { $1 }) }
        let command = request["cmd"] as? String

        switch command {
        case "list":
            reply(["ok": true, "devices": readInputDevices().map(\.json)])
        case "setMute", "toggleMute":
            guard let uid = request["uid"] as? String else { return reply(["ok": false, "error": "bad-request"]) }
            guard let device = readInputDevices().first(where: { $0.uid == uid }) else {
                return reply(["ok": false, "error": "not-found"])
            }
            guard device.canMute else { return reply(["ok": false, "error": "not-supported"]) }
            let muted: Bool
            if command == "toggleMute" {
                guard let current = device.muted else { return reply(["ok": false, "error": "failed"]) }
                muted = !current
            } else if let requested = request["muted"] as? Bool {
                muted = requested
            } else {
                return reply(["ok": false, "error": "bad-request"])
            }
            let status = setMute(device, muted)
            guard status == noErr else { return reply(["ok": false, "error": "failed", "status": Int(status)]) }
            reply(["ok": true, "muted": muted])
            // Do not rely on the listener alone; a driver may notify late or not at all
            scheduleSend()
        default:
            reply(["ok": false, "error": "bad-request"])
        }
    }
}

signal(SIGPIPE, SIG_IGN)
// A NULL run loop lets the HAL deliver notifications on a thread of its own; this tool never runs the main run loop
var noRunLoop: UnsafeRawPointer? = nil
var runLoopAddress = address(kAudioHardwarePropertyRunLoop)
let runLoopStatus = AudioObjectSetPropertyData(
    systemObject, &runLoopAddress, 0, nil, UInt32(MemoryLayout<UnsafeRawPointer?>.size), &noRunLoop)
if runLoopStatus != noErr { logError("cannot detach notifications from the main run loop (OSStatus \(runLoopStatus))") }

switch CommandLine.arguments.dropFirst().first {
case "list":
    let devices = readInputDevices().map(\.json)
    let data = try! JSONSerialization.data(
        withJSONObject: devices, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    print(String(decoding: data, as: UTF8.self))
case nil, "serve":
    let server = Server()
    server.start()
    dispatchMain()
default:
    logError("usage: micmute-helper [serve | list]")
    exit(64)
}
