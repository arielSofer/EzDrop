//
//  APIEndpointConfig.swift
//  AgenticDesigner
//
//  Reusable API endpoint definitions that API blocks can reference.
//

import Foundation

struct APIEndpointConfig: Codable, Identifiable {
    var id: UUID = UUID()
    var name: String = ""
    var baseURL: String = ""
    var path: String = ""
    var method: HTTPMethod = .get
    var headers: [HTTPHeaderField] = []
    var bodyTemplate: String?
    var queryParameters: [HTTPQueryParam] = []
    var responseMapping: [ResponseFieldMapping] = []
    var authentication: APIAuthentication = .none

    var fullURL: String {
        baseURL + path
    }
}

enum HTTPMethod: String, Codable, CaseIterable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

struct HTTPHeaderField: Codable, Identifiable {
    var id: UUID = UUID()
    var key: String = ""
    var value: String = ""
}

struct HTTPQueryParam: Codable, Identifiable {
    var id: UUID = UUID()
    var key: String = ""
    var value: String = ""
}

struct ResponseFieldMapping: Codable, Identifiable {
    var id: UUID = UUID()
    var jsonPath: String = ""
    var variableName: String = ""
}

enum APIAuthentication: String, Codable, CaseIterable {
    case none
    case bearerToken
    case apiKey
    case basicAuth
    case firebaseToken
}
