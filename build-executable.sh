#!/bin/bash

echo "🏗️ Building Relais Executables"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js $(node -v) found"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📥 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

# Choose build type
echo ""
echo "Select build target:"
echo "1) Windows only"
echo "2) Linux only" 
echo "3) macOS only"
echo "4) All platforms"
echo ""
read -p "Enter choice (1-4): " choice

case $choice in
    1)
        echo "🔨 Building Windows executable..."
        npm run build:win
        ;;
    2)
        echo "🔨 Building Linux executable..."
        npm run build:linux
        ;;
    3)
        echo "🔨 Building macOS executable..."
        npm run build:macos
        ;;
    4)
        echo "🔨 Building all executables..."
        npm run build:all
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build completed successfully!"
    echo "📦 Executables created in: dist/"
    echo ""
    ls -la dist/*.exe dist/relais-* 2>/dev/null | grep -v "\.md$\|\.gitignore$" || echo "No executables found"
    echo ""
    echo "🚀 Usage examples:"
    echo "  ./dist/relais-linux tunnel -p 3000"
    echo "  ./dist/relais-macos deploy ./my-app"
    echo "  dist/relais-win.exe set-token YOUR_TOKEN"
else
    echo "❌ Build failed"
    exit 1
fi

