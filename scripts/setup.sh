#!/bin/bash

# Setup script for rideshare-location-consistency
# This script checks prerequisites and sets up the development environment

set -e

echo "🚀 Rideshare Location Consistency - Setup Script"
echo "================================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to compare versions
version_ge() {
    printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

echo "📋 Checking Prerequisites..."
echo ""

# Check Node.js
echo -n "Checking Node.js... "
if command_exists node; then
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    if version_ge "$NODE_VERSION" "18.0.0"; then
        echo -e "${GREEN}✓${NC} Found $(node --version)"
    else
        echo -e "${RED}✗${NC} Version $NODE_VERSION found, but >= 18.0.0 required"
        echo "  Install from: https://nodejs.org/"
        exit 1
    fi
else
    echo -e "${RED}✗${NC} Not found"
    echo "  Install from: https://nodejs.org/"
    exit 1
fi

# Check npm
echo -n "Checking npm... "
if command_exists npm; then
    NPM_VERSION=$(npm --version)
    if version_ge "$NPM_VERSION" "9.0.0"; then
        echo -e "${GREEN}✓${NC} Found v$NPM_VERSION"
    else
        echo -e "${YELLOW}⚠${NC} Version $NPM_VERSION found, recommend >= 9.0.0"
    fi
else
    echo -e "${RED}✗${NC} Not found (should be installed with Node.js)"
    exit 1
fi

# Check Terraform
echo -n "Checking Terraform... "
if command_exists terraform; then
    TERRAFORM_VERSION=$(terraform version -json | grep -o '"version":"[^"]*' | cut -d'"' -f4)
    if version_ge "$TERRAFORM_VERSION" "1.5.0"; then
        echo -e "${GREEN}✓${NC} Found v$TERRAFORM_VERSION"
    else
        echo -e "${YELLOW}⚠${NC} Version $TERRAFORM_VERSION found, recommend >= 1.5.0"
    fi
else
    echo -e "${RED}✗${NC} Not found"
    echo "  Install from: https://www.terraform.io/downloads"
    exit 1
fi

# Check AWS CLI
echo -n "Checking AWS CLI... "
if command_exists aws; then
    AWS_VERSION=$(aws --version | cut -d' ' -f1 | cut -d'/' -f2)
    echo -e "${GREEN}✓${NC} Found v$AWS_VERSION"
else
    echo -e "${YELLOW}⚠${NC} Not found (optional but recommended)"
    echo "  Install from: https://aws.amazon.com/cli/"
fi

# Check Python (for diagrams)
echo -n "Checking Python... "
if command_exists python3; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    echo -e "${GREEN}✓${NC} Found v$PYTHON_VERSION (for diagrams)"
else
    echo -e "${YELLOW}⚠${NC} Not found (optional, needed for diagram generation)"
fi

echo ""
echo "✅ All required prerequisites are installed!"
echo ""

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

echo ""
echo "📦 Installing CDKTF CLI globally..."
if npm list -g cdktf-cli >/dev/null 2>&1; then
    echo "  CDKTF CLI already installed"
else
    npm install -g cdktf-cli@latest
fi

echo ""
echo "📦 Getting CDKTF providers..."
cdktf get

# Install Python dependencies if Python is available
if command_exists python3; then
    echo ""
    echo "📦 Installing Python dependencies (for diagrams)..."
    pip3 install -r requirements.txt 2>/dev/null || echo "  Note: Some Python packages may require additional system dependencies"
fi

echo ""
echo "🔧 Setup complete!"
echo ""

# Check AWS credentials
echo "🔐 Checking AWS credentials..."
if command_exists aws; then
    if aws sts get-caller-identity >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} AWS credentials configured"
        aws sts get-caller-identity
    else
        echo -e "${YELLOW}⚠${NC} AWS credentials not configured"
        echo ""
        echo "To configure AWS credentials, run:"
        echo "  aws configure"
        echo ""
        echo "You'll need:"
        echo "  - AWS Access Key ID"
        echo "  - AWS Secret Access Key"
        echo "  - Default region (e.g., us-east-1)"
    fi
else
    echo -e "${YELLOW}⚠${NC} AWS CLI not installed, skipping credential check"
fi

echo ""
echo "📚 Next Steps:"
echo ""
echo "1. Configure AWS credentials (if not done):"
echo "   aws configure"
echo ""
echo "2. Review and customize the configuration in src/tap-stack.ts"
echo ""
echo "3. Deploy the infrastructure:"
echo "   cdktf deploy"
echo ""
echo "4. Test the system:"
echo "   npm run simulate -- --drivers 100 --duration 60"
echo ""
echo "5. Generate diagrams (optional):"
echo "   python docs/diagrams/generate_diagrams.py"
echo ""
echo "📖 For detailed instructions, see:"
echo "   - README.md"
echo "   - QUICK_START.md"
echo "   - docs/GETTING_STARTED.md"
echo ""
echo "🎉 Happy building!"
