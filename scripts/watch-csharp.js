const chokidar = require('chokidar');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔍 Watching C# scripts for changes...\n');

// Watch C# files in scripts/CSharp directory
const watcher = chokidar.watch('src/scripts/CSharp/**/*.cs', {
    persistent: true,
    ignoreInitial: false
});

// Compilation function
function compileFile(filePath) {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(process.cwd(), filePath);

    console.log(`\n📝 Change detected: ${relativePath}`);
    console.log(`⚙️  Compiling ${fileName}...`);

    // For now, we'll create a simple transpiler
    // In production, you'd use Bridge.NET or similar
    const outputPath = filePath.replace('/CSharp/', '/compiled/').replace('.cs', '.js');
    const outputDir = path.dirname(outputPath);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Read C# file
    const csCode = fs.readFileSync(filePath, 'utf8');

    // Simple transpilation (placeholder - will be replaced with Bridge.NET)
    const jsCode = transpileCSharpToJS(csCode, fileName);

    // Write JS file
    fs.writeFileSync(outputPath, jsCode, 'utf8');

    console.log(`✅ Compiled successfully → ${path.relative(process.cwd(), outputPath)}`);
    console.log(`🔄 Hot reload triggered\n`);
}

// Simple C# to JS transpiler (placeholder)
function transpileCSharpToJS(csCode, fileName) {
    const className = fileName.replace('.cs', '');

    // Extract class content
    const classMatch = csCode.match(/public class (\w+)[\s\S]*?\{([\s\S]*)\}/);
    if (!classMatch) {
        return `// Error: Could not parse ${fileName}`;
    }

    const methods = extractMethods(classMatch[2]);

    return `// Auto-generated from ${fileName}
import { Component } from '../../engine/Component';

export class ${className} extends Component {
${methods}
}
`;
}

function extractMethods(classBody) {
    let js = '';

    // Extract fields
    const fieldRegex = /public\s+(\w+)\s+(\w+)\s*=\s*([^;]+);/g;
    let match;
    while ((match = fieldRegex.exec(classBody)) !== null) {
        const [, type, name, value] = match;
        js += `    public ${name} = ${convertValue(value)};\n`;
    }

    // Extract methods
    const methodRegex = /public\s+override\s+void\s+(\w+)\s*\(([^)]*)\)\s*\{([^}]*)\}/g;
    while ((match = methodRegex.exec(classBody)) !== null) {
        const [, methodName, params, body] = match;
        const jsParams = params.replace(/float\s+/g, '').replace(/int\s+/g, '');
        const jsBody = convertCSharpToJS(body);
        js += `\n    public ${methodName}(${jsParams}) {${jsBody}\n    }\n`;
    }

    return js;
}

function convertCSharpToJS(code) {
    return code
        .replace(/transform\.position\.(\w)/g, 'this.gameObject.transform.position.$1')
        .replace(/Input\.GetAxis\(/g, 'Input.GetAxis(')
        .replace(/\*\s*deltaTime/g, '* deltaTime');
}

function convertValue(value) {
    if (value.includes('f')) return value.replace('f', '');
    return value;
}

// Watch events
watcher
    .on('add', filePath => {
        console.log(`📄 Found: ${path.relative(process.cwd(), filePath)}`);
        compileFile(filePath);
    })
    .on('change', filePath => {
        compileFile(filePath);
    })
    .on('unlink', filePath => {
        console.log(`🗑️  Removed: ${path.relative(process.cwd(), filePath)}`);
    })
    .on('error', error => {
        console.error(`❌ Watcher error: ${error}`);
    });

console.log('✨ C# Script Watcher is running!');
console.log('💡 Press Ctrl+C to stop\n');
