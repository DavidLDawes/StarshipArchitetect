# Build System

This project uses a Node.js-based build system to minify HTML, JavaScript, and CSS files for production deployment.

## Prerequisites

- Node.js (v14 or later)
- npm

## Setup

Install the build dependencies:

```bash
npm install
```

This installs:
- `html-minifier` - HTML minification
- `terser` - JavaScript minification
- `clean-css` - CSS minification

## Build Commands

### Build for Production

Minifies all files and outputs to `dist/` directory:

```bash
npm run build
```

Output:
- Minified HTML files
- Minified JavaScript files (without name mangling to preserve module compatibility)
- Minified CSS files
- Copied CSV and documentation files

### Clean Build Directory

Remove the `dist/` directory:

```bash
npm run clean
```

### Local Development Server

Run a local HTTP server for development:

```bash
npm run serve
```

Then open http://localhost:8000

### Test Production Build

Run a local HTTP server for the production build:

```bash
npm run serve:dist
```

Then open http://localhost:8000

## Build Configuration

The build script (`build.js`) automatically:

1. Discovers all `.html`, `.js`, and `.css` files in the project root
2. Minifies HTML with whitespace removal and comment stripping
3. Minifies JavaScript with compression (but no name mangling for module compatibility)
4. Minifies CSS with level 2 optimizations
5. Copies CSV and markdown files as-is
6. Reports size savings and compression statistics

## Build Output

The `dist/` directory contains:
- All minified HTML, JS, and CSS files
- Original CSV data files
- Documentation files (README.md, CLAUDE.md)

Typical compression results:
- HTML: ~40-50% size reduction
- JavaScript: ~40-50% size reduction
- CSS: ~20-30% size reduction
- Overall: ~40-45% size reduction

## Deployment

To deploy the application:

1. Run `npm run build`
2. Upload the contents of the `dist/` directory to your web server
3. No server-side processing is required - this is a static site

## Notes

- The build system does NOT mangle JavaScript variable/function names because the code is organized in separate modules loaded via HTML script tags
- If HTML minification fails on a file (due to parse errors), the original file is copied to maintain functionality
- The `dist/` and `node_modules/` directories are excluded from git via `.gitignore`
