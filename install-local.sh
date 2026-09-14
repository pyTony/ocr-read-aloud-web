#!/usr/bin/env bash
set -e

echo "========================================================"
echo " OCR Magazine Read-Aloud - Local Machine Setup Script"
echo " Zero-cost, 100% offline & local testing on your computer"
echo "========================================================"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed."
    echo "👉 Please install Node.js (version 18 or newer) from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js detected: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "📦 Installing application dependencies via npm..."
npm install

echo "--------------------------------------------------------"
echo "Optional: Local AI Proofreading via Ollama (100% Free)"
echo "--------------------------------------------------------"
if command -v ollama &> /dev/null; then
    echo "✅ Ollama is installed on your computer."
    echo "👉 You can run: ollama pull llama3.2 (or ollama pull qwen2.5:7b)"
else
    echo "ℹ️  Ollama is not installed. (Optional for free local LLM proofreading)."
    echo "👉 Install from https://ollama.com if you want local AI dehyphenation."
    echo "👉 The app also includes built-in offline Regex & Word-Repair rules that require zero AI/tokens!"
fi

echo "========================================================"
echo " Setup complete! Starting development server on http://localhost:3000 ..."
echo "========================================================"
npm run dev
