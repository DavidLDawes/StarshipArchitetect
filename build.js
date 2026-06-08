const fs = require('fs');
const path = require('path');
const { minify: minifyHTML } = require('html-minifier');
const { minify: minifyJS } = require('terser');
const CleanCSS = require('clean-css');

const DIST_DIR = 'dist';

// Clear and create dist directory
if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR);
fs.mkdirSync(path.join(DIST_DIR, 'src'));

console.log('🚀 Building Starship Architect for production...');

// Track sizes for statistics
let sourceSize = 0;
let distSize = 0;

// Minify index.html (root-level only, tests/ is excluded)
console.log('📄 Minifying HTML...');
const htmlFile = 'index.html';
{
    const html = fs.readFileSync(htmlFile, 'utf8');
    sourceSize += Buffer.byteLength(html, 'utf8');
    try {
        const minified = minifyHTML(html, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            useShortDoctype: true,
            minifyCSS: true,
            minifyJS: true,
            continueOnParseError: true
        });
        fs.writeFileSync(path.join(DIST_DIR, htmlFile), minified);
        distSize += Buffer.byteLength(minified, 'utf8');
        console.log(`  ✓ ${htmlFile} (${formatBytes(Buffer.byteLength(html, 'utf8'))} → ${formatBytes(Buffer.byteLength(minified, 'utf8'))})`);
    } catch (error) {
        console.warn(`  ⚠ ${htmlFile} - Minification failed, copying original (${error.message})`);
        fs.writeFileSync(path.join(DIST_DIR, htmlFile), html);
        distSize += Buffer.byteLength(html, 'utf8');
    }
}

// Minify CSS
console.log('\n🎨 Minifying CSS...');
{
    const cssFile = 'styles.css';
    const css = fs.readFileSync(cssFile, 'utf8');
    sourceSize += Buffer.byteLength(css, 'utf8');
    const result = new CleanCSS({ level: 2, compatibility: '*' }).minify(css);
    if (result.errors.length > 0) {
        console.error(`  ✗ ${cssFile} - ${result.errors.join(', ')}`);
    } else {
        fs.writeFileSync(path.join(DIST_DIR, cssFile), result.styles);
        distSize += Buffer.byteLength(result.styles, 'utf8');
        console.log(`  ✓ ${cssFile} (${formatBytes(Buffer.byteLength(css, 'utf8'))} → ${formatBytes(Buffer.byteLength(result.styles, 'utf8'))})`);
    }
}

// Minify JS source modules from src/
console.log('\n📜 Minifying JS modules (src/)...');
const jsFiles = fs.readdirSync('src').filter(f => f.endsWith('.js'));
const minifyPromises = jsFiles.map(async file => {
    const srcPath = path.join('src', file);
    const js = fs.readFileSync(srcPath, 'utf8');
    sourceSize += Buffer.byteLength(js, 'utf8');
    try {
        const result = await minifyJS(js, {
            compress: { dead_code: true, drop_console: false, passes: 2 },
            mangle: false,
            output: { comments: false }
        });
        if (result.error) throw result.error;
        const outPath = path.join(DIST_DIR, 'src', file);
        fs.writeFileSync(outPath, result.code);
        distSize += Buffer.byteLength(result.code, 'utf8');
        console.log(`  ✓ src/${file} (${formatBytes(Buffer.byteLength(js, 'utf8'))} → ${formatBytes(Buffer.byteLength(result.code, 'utf8'))})`);
    } catch (error) {
        console.error(`  ✗ src/${file} - ${error.message}`);
    }
});

Promise.all(minifyPromises).then(() => {
    console.log('\n📊 Build Statistics:');
    const savings = sourceSize > 0 ? ((1 - distSize / sourceSize) * 100).toFixed(1) : 0;
    console.log(`  Source: ${formatBytes(sourceSize)}`);
    console.log(`  Dist:   ${formatBytes(distSize)}`);
    console.log(`  Saved:  ${savings}% reduction`);
    console.log('\n✅ Build complete! Deploy the dist/ directory.');
    console.log('  npm run serve:dist  →  http://localhost:8000\n');
}).catch(error => {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
});

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
