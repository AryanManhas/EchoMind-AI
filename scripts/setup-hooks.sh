#!/bin/sh
# Setup git hooks for the project

HOOKS_DIR=".git/hooks"
if [ ! -d "$HOOKS_DIR" ]; then
  echo "❌ Error: .git directory not found. Please run this from the project root."
  exit 1
fi

echo "Installing pre-commit hook..."
cp scripts/pre-commit "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "✅ Pre-commit hook installed successfully!"
