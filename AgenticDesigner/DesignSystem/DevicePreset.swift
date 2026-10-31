import Foundation
import CoreGraphics

// סוגי פלטפורמות שהעורך יודע לעצב עבורן
enum DevicePlatform: String, Codable, CaseIterable {
    case iPhone
    case iPad
    case appleWatch
    case mac
    case custom
}

// Preset של מסך / מכשיר
struct DevicePreset: Identifiable, Codable, Equatable {
    let id: String
    let name: String
    let platform: DevicePlatform
    
    let width: CGFloat
    let height: CGFloat
    
    let cornerRadius: CGFloat
    
    let safeAreaTop: CGFloat
    let safeAreaBottom: CGFloat
    let safeAreaHorizontal: CGFloat
}

enum DevicePresetLibrary {
    
    static let iPhone15Pro = DevicePreset(
        id: "iphone_15_pro",
        name: "iPhone 15 Pro",
        platform: .iPhone,
        width: 393,
        height: 852,
        cornerRadius: 44,
        safeAreaTop: 59,
        safeAreaBottom: 34,
        safeAreaHorizontal: 0
    )
    
    static let iPhoneSE = DevicePreset(
        id: "iphone_se",
        name: "iPhone SE",
        platform: .iPhone,
        width: 375,
        height: 667,
        cornerRadius: 0,
        safeAreaTop: 20,
        safeAreaBottom: 0,
        safeAreaHorizontal: 0
    )
    
    static let iPadPro11 = DevicePreset(
        id: "ipad_pro_11",
        name: "iPad Pro 11",
        platform: .iPad,
        width: 834,
        height: 1194,
        cornerRadius: 24,
        safeAreaTop: 24,
        safeAreaBottom: 20,
        safeAreaHorizontal: 0
    )
    
    static let appleWatch45 = DevicePreset(
        id: "apple_watch_45",
        name: "Apple Watch 45mm",
        platform: .appleWatch,
        width: 396,
        height: 484,
        cornerRadius: 86,
        safeAreaTop: 24,
        safeAreaBottom: 24,
        safeAreaHorizontal: 12
    )
    
    static let macBookPro14 = DevicePreset(
        id: "macbook_pro_14",
        name: "MacBook Pro 14",
        platform: .mac,
        width: 1512,
        height: 982,
        cornerRadius: 16,
        safeAreaTop: 0,
        safeAreaBottom: 0,
        safeAreaHorizontal: 0
    )
    
    static let all: [DevicePreset] = [
        iPhone15Pro,
        iPhoneSE,
        iPadPro11,
        appleWatch45,
        macBookPro14
    ]
    
    static func preset(for id: String) -> DevicePreset? {
        all.first { $0.id == id }
    }
}
