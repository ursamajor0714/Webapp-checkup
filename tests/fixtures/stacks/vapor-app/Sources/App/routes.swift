import Vapor

struct CreateUser: Content { var name: String }

func routes(_ app: Application) throws {
    let api = app.grouped("api")
    api.get("users") { req async throws -> [String] in [] }
    api.post("users") { req async throws -> String in let u = try req.content.decode(CreateUser.self); return u.name }
    api.get("users", ":id") { req -> String in req.parameters.get("id") ?? "" }
    app.get("health") { _ in "ok" }
}
