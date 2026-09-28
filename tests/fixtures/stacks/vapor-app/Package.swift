// swift-tools-version:5.9
import PackageDescription
let package = Package(
    name: "app",
    dependencies: [ .package(url: "https://github.com/vapor/vapor.git", from: "4.99.0") ],
    targets: [ .executableTarget(name: "App", dependencies: [ .product(name: "Vapor", package: "vapor") ]) ]
)
