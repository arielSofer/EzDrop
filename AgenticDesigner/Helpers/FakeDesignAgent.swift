//
//  FakeDesignAgent.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

// Agent מדומה שמחזיר פעולות קבועות לצורך בדיקת התשתית
enum FakeDesignAgent {
    
    static func generateActions(
        for prompt: String,
        selectedParentId: UUID?
    ) -> [DesignAction] {
        [
            DesignAction(
                type: .createRectangle,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Agent Accent",
                text: nil,
                x: 32,
                y: 48,
                width: 72,
                height: 6,
                fill: "#38BDF8",
                cornerRadius: 3,
                opacity: 1.0,
                fontSize: nil
            ),
            
            DesignAction(
                type: .createText,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Agent Title",
                text: "Welcome Back",
                x: 32,
                y: 80,
                width: 280,
                height: 44,
                fill: "#FFFFFF",
                cornerRadius: nil,
                opacity: 1.0,
                fontSize: 32
            ),
            
            DesignAction(
                type: .createText,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Agent Subtitle",
                text: "Sign in to your account",
                x: 32,
                y: 132,
                width: 280,
                height: 28,
                fill: "#94A3B8",
                cornerRadius: nil,
                opacity: 1.0,
                fontSize: 16
            ),
            
            DesignAction(
                type: .createInput,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Email Input",
                text: "Email address",
                x: 32,
                y: 224,
                width: 326,
                height: 54,
                fill: "#FFFFFF",
                cornerRadius: 14,
                opacity: 1.0,
                fontSize: 15
            ),
            
            DesignAction(
                type: .createInput,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Password Input",
                text: "Password",
                x: 32,
                y: 294,
                width: 326,
                height: 54,
                fill: "#FFFFFF",
                cornerRadius: 14,
                opacity: 1.0,
                fontSize: 15
            ),
            
            DesignAction(
                type: .createRectangle,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Remember Checkbox",
                text: nil,
                x: 32,
                y: 372,
                width: 18,
                height: 18,
                fill: "#1E293B",
                cornerRadius: 5,
                opacity: 1.0,
                fontSize: nil
            ),
            
            DesignAction(
                type: .createText,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Remember Label",
                text: "Remember me",
                x: 60,
                y: 367,
                width: 140,
                height: 28,
                fill: "#CBD5E1",
                cornerRadius: nil,
                opacity: 1.0,
                fontSize: 14
            ),
            
            DesignAction(
                type: .createText,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Forgot Password",
                text: "Forgot password?",
                x: 230,
                y: 367,
                width: 128,
                height: 28,
                fill: "#60A5FA",
                cornerRadius: nil,
                opacity: 1.0,
                fontSize: 14
            ),
            
            DesignAction(
                type: .createButton,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Agent Button",
                text: "Log In",
                x: 32,
                y: 430,
                width: 326,
                height: 56,
                fill: "#2563EB",
                cornerRadius: 16,
                opacity: 1.0,
                fontSize: 16
            ),
            
            DesignAction(
                type: .createText,
                nodeId: nil,
                parentId: selectedParentId,
                name: "Signup Hint",
                text: "New here? Create an account",
                x: 76,
                y: 512,
                width: 240,
                height: 28,
                fill: "#94A3B8",
                cornerRadius: nil,
                opacity: 1.0,
                fontSize: 14
            )
        ]
    }
}
