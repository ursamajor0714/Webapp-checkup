import Foundation

let baseURL = "https://example.com"

func fetchUser(id: Int) async throws -> Data {
    let url = URL(string: "\(baseURL)/api/users/\(id)")!
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
}

func login(token: String) {
    var req = URLRequest(url: URL(string: "\(baseURL)/api/login")!)
    req.httpMethod = "POST"
    UserDefaults.standard.set(token, forKey: "accessToken")
    let data = try! JSONSerialization.data(withJSONObject: [:])
    _ = data
}
