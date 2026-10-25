#!/bin/bash

# WebSocket Control Script for E-commerce MERN Project

echo "🔇 WebSocket Control Center"
echo "=========================="
echo ""
echo "Choose an option:"
echo "1. Stop Backend Server (Stops all WebSockets)"
echo "2. Create .env file to disable WebSockets"
echo "3. Show WebSocket status"
echo "4. Exit"
echo ""

read -p "Enter your choice (1-4): " choice

case $choice in
    1)
        echo "Stopping backend server..."
        pkill -f "node.*server.js"
        echo "✅ Backend server stopped. WebSockets are now disabled."
        ;;
    2)
        echo "Creating .env file to disable WebSockets..."
        echo "VITE_DISABLE_WEBSOCKET=true" >> frontend/.env
        echo "✅ WebSockets disabled via environment variable."
        echo "ℹ️  Restart your frontend server for changes to take effect."
        ;;
    3)
        echo "Checking WebSocket status..."
        echo ""
        echo "Backend server status:"
        if pgrep -f "node.*server.js" > /dev/null; then
            echo "🟢 Backend server is running (WebSockets active)"
            echo "   PID: $(pgrep -f 'node.*server.js')"
        else
            echo "🔴 Backend server is stopped (WebSockets inactive)"
        fi
        echo ""
        echo "Environment variable status:"
        if grep -q "VITE_DISABLE_WEBSOCKET=true" frontend/.env 2>/dev/null; then
            echo "🔴 WebSockets disabled via environment variable"
        else
            echo "🟢 WebSockets enabled via environment variable"
        fi
        ;;
    4)
        echo "Goodbye! 👋"
        exit 0
        ;;
    *)
        echo "❌ Invalid option. Please run the script again."
        ;;
esac 