const fs = require('fs');
const path = require('path');
const { minify: minifyHTML } = require('html-minifier');
const { minify: minifyJS } = require('terser');
const CleanCSS = require('clean-css');

const DIST_DIR = 'dist';
const SOURCE_DIR = '.';

// Files to process - dynamically find all HTML files (exclude test files)
const HTML_FILES = fs.readdirSync(SOURCE_DIR)
    .filter(file => file.endsWith('.html') && !file.startsWith('test-'));

// Dynamically find all JS and CSS files (exclude test files and build script)
const JS_FILES = fs.readdirSync(SOURCE_DIR)
    .filter(file => file.endsWith('.js') && !file.startsWith('test-') && file !== 'build.js');

const CSS_FILES = fs.readdirSync(SOURCE_DIR)
    .filter(file => file.endsWith('.css'));

// Documentation files to include (whitelist approach - only production docs)
// REMOVED: Users can provide their own CSV files at runtime
// Documentation files aren't needed for the deployed application
// const COPY_FILES = [
//     'sample-ship.csv',
//     'transport.csv',
//     'README.md',
//     'CLAUDE.md'
// ];

// Clear and create dist directory
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR);

console.log('🚀 Building Starship Architect for production...');
console.log('📝 Excluding test files and build artifacts from production build\n');

// Track sizes for statistics
let sourceSize = 0;
let distSize = 0;

// Minify HTML files
console.log('📄 Minifying HTML files...');
HTML_FILES.forEach(file => {
    const filePath = path.join(SOURCE_DIR, file);
    if (fs.existsSync(filePath)) {
        try {
            const html = fs.readFileSync(filePath, 'utf8');
            sourceSize += Buffer.byteLength(html, 'utf8');

            const minified = minifyHTML(html, {
                collapseWhitespace: true,
                removeComments: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true,
                useShortDoctype: true,
                minifyCSS: true,
                minifyJS: true,
                continueOnParseError: true // Be more forgiving with HTML errors
            });

            fs.writeFileSync(path.join(DIST_DIR, file), minified);
            distSize += Buffer.byteLength(minified, 'utf8');

            const original = formatBytes(Buffer.byteLength(html, 'utf8'));
            const compressed = formatBytes(Buffer.byteLength(minified, 'utf8'));
            console.log(`  ✓ ${file} (${original} → ${compressed})`);
        } catch (error) {
            // If minification fails, just copy the file as-is
            console.warn(`  ⚠ ${file} - Minification failed, copying original (${error.message})`);
            const html = fs.readFileSync(filePath, 'utf8');
            fs.writeFileSync(path.join(DIST_DIR, file), html);
            distSize += Buffer.byteLength(html, 'utf8');
        }
    }
});

// Minify JavaScript files
console.log('\n📜 Minifying JavaScript files...');
const minifyPromises = JS_FILES.map(async file => {
    const filePath = path.join(SOURCE_DIR, file);
    if (fs.existsSync(filePath)) {
        try {
            const js = fs.readFileSync(filePath, 'utf8');
            sourceSize += Buffer.byteLength(js, 'utf8');

            const result = await minifyJS(js, {
                compress: {
                    dead_code: true,
                    drop_console: false, // Keep console for debugging
                    passes: 2
                },
                mangle: false, // Don't mangle names - these are separate modules loaded in HTML
                output: {
                    comments: false
                }
            });

            if (result.error) {
                throw result.error;
            }

            fs.writeFileSync(path.join(DIST_DIR, file), result.code);
            distSize += Buffer.byteLength(result.code, 'utf8');

            const original = formatBytes(Buffer.byteLength(js, 'utf8'));
            const compressed = formatBytes(Buffer.byteLength(result.code, 'utf8'));
            console.log(`  ✓ ${file} (${original} → ${compressed})`);
        } catch (error) {
            console.error(`  ✗ ${file} - Error: ${error.message}`);
        }
    }
});

Promise.all(minifyPromises).then(() => {
    // Minify CSS files
    console.log('\n🎨 Minifying CSS files...');
    CSS_FILES.forEach(file => {
        const filePath = path.join(SOURCE_DIR, file);
        if (fs.existsSync(filePath)) {
            try {
                const css = fs.readFileSync(filePath, 'utf8');
                sourceSize += Buffer.byteLength(css, 'utf8');

                const result = new CleanCSS({
                    level: 2,
                    compatibility: '*'
                }).minify(css);

                if (result.errors.length > 0) {
                    throw new Error(result.errors.join(', '));
                }

                fs.writeFileSync(path.join(DIST_DIR, file), result.styles);
                distSize += Buffer.byteLength(result.styles, 'utf8');

                const original = formatBytes(Buffer.byteLength(css, 'utf8'));
                const compressed = formatBytes(Buffer.byteLength(result.styles, 'utf8'));
                console.log(`  ✓ ${file} (${original} → ${compressed})`);
            } catch (error) {
                console.error(`  ✗ ${file} - Error: ${error.message}`);
            }
        }
    });

    // Copy CSV and documentation files
    // REMOVED: Production build excludes .md and .csv files
    // Users can provide their own CSV files at runtime (via file upload or URL parameter)
    // console.log('\n📋 Copying data files...');
    // COPY_FILES.forEach(file => {
    //     const filePath = path.join(SOURCE_DIR, file);
    //     if (fs.existsSync(filePath)) {
    //         try {
    //             fs.copyFileSync(filePath, path.join(DIST_DIR, file));
    //             console.log(`  ✓ ${file}`);
    //         } catch (error) {
    //             console.error(`  ✗ ${file} - Error: ${error.message}`);
    //         }
    //     }
    // });

    // Calculate and display statistics
    console.log('\n📊 Build Statistics:');
    const savings = sourceSize > 0 ? ((1 - distSize / sourceSize) * 100).toFixed(1) : 0;

    console.log(`  Source: ${formatBytes(sourceSize)}`);
    console.log(`  Dist:   ${formatBytes(distSize)}`);
    console.log(`  Saved:  ${savings}% reduction`);

    console.log('\n✅ Build complete! Deploy the dist/ directory.\n');
    console.log('To test the build:');
    console.log('  npm run serve:dist');
    console.log('  Then open http://localhost:8000\n');
}).catch(error => {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
});

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
