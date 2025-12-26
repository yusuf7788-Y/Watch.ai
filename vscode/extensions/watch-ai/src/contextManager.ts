import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ContextManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async getSmartContext(editor: vscode.TextEditor | undefined): Promise<string> {
        if (!editor) {
            return await this.getWorkspaceOverview();
        }

        const document = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const relativePath = workspaceFolder
            ? path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath)
            : document.uri.fsPath;

        let context = `## ACTIVE CONTEXT\n`;
        context += `- **Current File:** ${relativePath}\n`;
        context += `- **Language:** ${document.languageId}\n`;

        // 1. Diagnostics (Errors/Warnings)
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        if (diagnostics.length > 0) {
            context += `\n### 🚨 PROBLEMS (${diagnostics.length})\n`;
            diagnostics.slice(0, 5).forEach(d => {
                context += `- [Line ${d.range.start.line + 1}] ${d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning'}: ${d.message}\n`;
            });
        }

        // 2. Active File Content (Structured)
        context += `\n### 📄 ACTIVE FILE CONTENT\n`;
        context += `${this.formatFileContent(relativePath, document.getText())}\n`;

        // 3. Related Files (Imports/References)
        const relatedFiles = await this.findRelatedFiles(document);
        if (relatedFiles.length > 0) {
            context += `\n### 🔗 RELATED FILES (Context)\n`;
            for (const file of relatedFiles) {
                context += `${this.formatFileContent(file.path, file.content, true)}\n`;
            }
        }

        // 4. Workspace Structure (Top level)
        context += `\n${await this.getWorkspaceOverview()}\n`;

        return context;
    }

    private formatFileContent(path: string, content: string, truncate: boolean = false): string {
        const createCodeBlock = (code: string) => {
            return `\`\`\`typescript\n// ${path}\n${code}\n\`\`\``;
        };

        if (!truncate) {
            return createCodeBlock(content);
        }

        // Smart truncation for related files: Header + Imports + Interfaces + Top 50 lines
        const lines = content.split('\n');
        const preview = lines.slice(0, 50).join('\n');
        return createCodeBlock(`${preview}\n// ... (truncated for context)`);
    }

    private async findRelatedFiles(document: vscode.TextDocument): Promise<{ path: string, content: string }[]> {
        const related: { path: string, content: string }[] = [];
        const text = document.getText();
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

        if (!workspaceFolder) return [];

        // Simple regex to find imports (JS/TS/Python style)
        // Matches: import ... from 'path'; or require('path') or import "path"
        const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"])|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:import\s+['"]([^'"]+)['"])/g;

        let match;
        const processedPaths = new Set<string>();

        while ((match = importRegex.exec(text)) !== null) {
            if (related.length >= 3) break; // Limit to 3 related files to save tokens

            let importPath = match[1] || match[2] || match[3];
            if (!importPath || importPath.startsWith('.')) {
                // Resolve relative path
                try {
                    const dir = path.dirname(document.uri.fsPath);
                    let resolvedPath = path.resolve(dir, importPath || '');

                    // Try adding extensions if missing
                    if (!fs.existsSync(resolvedPath)) {
                        for (const ext of ['.ts', '.js', '.jsx', '.tsx', '.json']) {
                            if (fs.existsSync(resolvedPath + ext)) {
                                resolvedPath += ext;
                                break;
                            }
                        }
                    }

                    // Check if file exists and is in workspace
                    if (fs.existsSync(resolvedPath) && resolvedPath.startsWith(workspaceFolder.uri.fsPath) && !processedPaths.has(resolvedPath)) {
                        const content = fs.readFileSync(resolvedPath, 'utf8');
                        const relPath = path.relative(workspaceFolder.uri.fsPath, resolvedPath);
                        related.push({ path: relPath, content });
                        processedPaths.add(resolvedPath);
                    }
                } catch (e) {
                    console.log('Error resolving import:', e);
                }
            }
        }

        return related;
    }

    private async getWorkspaceOverview(): Promise<string> {
        if (!vscode.workspace.workspaceFolders) return '';

        const folder = vscode.workspace.workspaceFolders[0];
        let structure = '### 📂 WORKSPACE STRUCTURE\n';

        try {
            // Get top level files/folders, excluding node_modules and .git
            const files = await vscode.workspace.fs.readDirectory(folder.uri);
            const meaningfulFiles = files
                .filter(([name]) => !name.startsWith('.') && name !== 'node_modules' && name !== 'dist' && name !== 'out')
                .slice(0, 15); // Limit limit

            meaningfulFiles.forEach(([name, type]) => {
                structure += `- ${name} ${type === vscode.FileType.Directory ? '/' : ''}\n`;
            });
        } catch (e) {
            return '';
        }

        return structure;
    }
}
