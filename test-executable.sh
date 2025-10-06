#!/bin/bash

echo "🧪 Testing Relais Executable"
echo ""

# Check if executable exists
if [ ! -f "dist/relais-win.exe" ]; then
    echo "❌ Executable not found. Please run build first:"
    echo "   npm run build:win-only"
    exit 1
fi

echo "✅ Executable found: dist/relais-win.exe"
echo "📏 Size: $(ls -lh dist/relais-win.exe | awk '{print $5}')"
echo ""

# Test version command (this should work without any dependencies)
echo "🔍 Testing version command..."
if command -v wine &> /dev/null; then
    # If wine is available, test the Windows executable
    echo "🍷 Using Wine to test Windows executable..."
    wine dist/relais-win.exe --version
    if [ $? -eq 0 ]; then
        echo "✅ Version command works!"
    else
        echo "❌ Version command failed"
    fi
else
    echo "ℹ️  Wine not available - cannot test Windows executable on this system"
    echo "ℹ️  Please test on a Windows machine with:"
    echo "     dist\\relais-win.exe --version"
    echo "     dist\\relais-win.exe --help"
fi

echo ""
echo "🎯 Manual testing on Windows:"
echo "1. Copy dist/relais-win.exe to a Windows machine"
echo "2. Test basic commands:"
echo "   dist\\relais-win.exe --version"
echo "   dist\\relais-win.exe --help"
echo "   dist\\relais-win.exe tunnel --help"
echo "   dist\\relais-win.exe deploy --help"
echo ""
echo "3. Test full functionality:"
echo "   dist\\relais-win.exe set-token YOUR_TOKEN"
echo "   dist\\relais-win.exe tunnel -p 3000"
echo ""

