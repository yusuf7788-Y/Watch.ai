require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const http = require('http');
const { Server } = require('socket.io');
const OpenAI = require('openai');

// ===== CONFIGURATION =====
const PORT = process.env.PORT || 3001;
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.5-flash-preview';
let WORKSPACE_DIR = process.argv[2] || path.resolve(__dirname, '../');

// ===== AI CLIENT =====
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Watch.ai",
    }
});

// ===== TOOL DEFINITIONS =====
const TOOLS = [
    {
        type: "function",
        function: {
            name: "readFile",
            description: "Reads the complete contents of a file. Use this to understand existing code before making changes.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Absolute path to the file to read"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "writeFile",
            description: "Creates a new file or completely overwrites an existing file with new content. Use for creating new files or when you need to replace entire file contents.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Absolute path to the file to write"
                    },
                    content: {
                        type: "string",
                        description: "The complete content to write to the file"
                    }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "editFile",
            description: "Makes targeted edits to a file by replacing specific text. Use this for small modifications instead of rewriting entire files.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Absolute path to the file to edit"
                    },
                    oldText: {
                        type: "string",
                        description: "The exact text to find and replace (must match exactly)"
                    },
                    newText: {
                        type: "string",
                        description: "The new text to replace with"
                    }
                },
                required: ["path", "oldText", "newText"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "deleteFile",
            description: "Deletes a file or directory permanently.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Absolute path to delete"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "listFiles",
            description: "Lists all files and folders in a directory. Use to explore project structure.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Directory path to list"
                    },
                    recursive: {
                        type: "boolean",
                        description: "If true, lists files recursively (max 3 levels)"
                    }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "searchInFiles",
            description: "Searches for text or pattern in files within a directory. Useful for finding code references.",
            parameters: {
                type: "object",
                properties: {
                    directory: {
                        type: "string",
                        description: "Directory to search in"
                    },
                    query: {
                        type: "string",
                        description: "Text or pattern to search for"
                    },
                    filePattern: {
                        type: "string",
                        description: "File extension filter like '.js' or '.jsx' (optional)"
                    }
                },
                required: ["directory", "query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "runCommand",
            description: "Executes a shell command in the terminal. REQUIRES USER APPROVAL. Use for npm install, build commands, etc.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The shell command to execute"
                    },
                    cwd: {
                        type: "string",
                        description: "Working directory for the command (optional)"
                    }
                },
                required: ["command"]
            }
        }
    }
];

// ===== TOOL HANDLERS =====
let sessionStats = { linesWritten: 0, filesModified: new Set(), filesRead: new Set(), toolCalls: [] };

const toolHandlers = {
    readFile: async ({ path: filePath }) => {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            sessionStats.filesRead.add(filePath);
            const lines = content.split('\n').length;
            return {
                success: true,
                content,
                path: filePath,
                lines,
                message: `Successfully read ${path.basename(filePath)} (${lines} lines)`
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    writeFile: async ({ path: filePath, content }) => {
        try {
            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const lines = content.split('\n').length;
            const isNew = !fs.existsSync(filePath);

            fs.writeFileSync(filePath, content, 'utf-8');
            sessionStats.linesWritten += lines;
            sessionStats.filesModified.add(filePath);

            return {
                success: true,
                path: filePath,
                lines,
                isNew,
                message: `${isNew ? 'Created' : 'Updated'} ${path.basename(filePath)} (${lines} lines)`
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    editFile: async ({ path: filePath, oldText, newText }) => {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: 'File does not exist' };
            }

            const content = fs.readFileSync(filePath, 'utf-8');

            if (!content.includes(oldText)) {
                return {
                    success: false,
                    error: 'Old text not found in file. Make sure to use exact text including whitespace.',
                    hint: 'Try reading the file first to get exact content'
                };
            }

            const newContent = content.replace(oldText, newText);
            fs.writeFileSync(filePath, newContent, 'utf-8');

            sessionStats.filesModified.add(filePath);
            const linesChanged = newText.split('\n').length;
            sessionStats.linesWritten += linesChanged;

            return {
                success: true,
                path: filePath,
                message: `Edited ${path.basename(filePath)} - replaced ${oldText.split('\n').length} lines with ${linesChanged} lines`
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    deleteFile: async ({ path: filePath }) => {
        try {
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                fs.rmSync(filePath, { recursive: true });
            } else {
                fs.unlinkSync(filePath);
            }
            return {
                success: true,
                message: `Deleted ${path.basename(filePath)}`
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    listFiles: async ({ path: dirPath, recursive = false }) => {
        try {
            const listDir = (dir, level = 0) => {
                if (level > 2) return []; // Max 3 levels

                const items = fs.readdirSync(dir);
                const result = [];

                for (const item of items) {
                    // Skip common non-essential directories
                    if (['node_modules', '.git', '.next', 'dist', 'build', '.cache'].includes(item)) continue;

                    const fullPath = path.join(dir, item);
                    try {
                        const stat = fs.statSync(fullPath);
                        const entry = {
                            name: item,
                            path: fullPath,
                            type: stat.isDirectory() ? 'folder' : 'file'
                        };

                        if (stat.isDirectory() && recursive) {
                            entry.children = listDir(fullPath, level + 1);
                        }

                        result.push(entry);
                    } catch (e) {
                        // Skip inaccessible files
                    }
                }

                return result.sort((a, b) => {
                    if (a.type === b.type) return a.name.localeCompare(b.name);
                    return a.type === 'folder' ? -1 : 1;
                });
            };

            const files = listDir(dirPath);
            return {
                success: true,
                files,
                count: files.length,
                message: `Found ${files.length} items in ${path.basename(dirPath)}`
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    searchInFiles: async ({ directory, query, filePattern }) => {
        try {
            const results = [];
            const maxResults = 20;

            const searchDir = (dir) => {
                if (results.length >= maxResults) return;

                const items = fs.readdirSync(dir);
                for (const item of items) {
                    if (results.length >= maxResults) break;
                    if (['node_modules', '.git', '.next', 'dist'].includes(item)) continue;

                    const fullPath = path.join(dir, item);
                    try {
                        const stat = fs.statSync(fullPath);

                        if (stat.isDirectory()) {
                            searchDir(fullPath);
                        } else if (!filePattern || item.endsWith(filePattern)) {
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            const lines = content.split('\n');

                            lines.forEach((line, idx) => {
                                if (line.includes(query) && results.length < maxResults) {
                                    results.push({
                                        file: fullPath,
                                        line: idx + 1,
                                        content: line.trim().substring(0, 100)
                                    });
                                }
                            });
                        }
                    } catch (e) {
                        // Skip unreadable files
                    }
                }
            };

            searchDir(directory);

            return {
                success: true,
                results,
                count: results.length,
                message: `Found ${results.length} matches for "${query}"`
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    runCommand: async ({ command, cwd }) => {
        // This requires approval - will be handled by the approval flow
        return {
            status: "NEEDS_APPROVAL",
            command,
            cwd: cwd || WORKSPACE_DIR
        };
    }
};

// ===== SYSTEM PROMPT =====
const getSystemPrompt = (context) => {
    const activeFileInfo = context.activeFile
        ? `**Active File:** \`${context.activeFile}\``
        : '**Active File:** None';

    const fileContentSection = context.activeFileContent
        ? `
## ACTIVE FILE CONTENT
\`\`\`
${context.activeFileContent.substring(0, 12000)}${context.activeFileContent.length > 12000 ? '\n// ... (truncated)' : ''}
\`\`\``
        : '';

    const projectSection = context.projectStructure
        ? `
## PROJECT STRUCTURE
\`\`\`
${context.projectStructure}
\`\`\``
        : '';

    const cursorInfo = context.cursorLine !== undefined
        ? `**Cursor Line:** ${context.cursorLine + 1}`
        : '';

    const selectionInfo = context.selectedText
        ? `**Selected Text:**\n\`\`\`\n${context.selectedText.substring(0, 500)}\n\`\`\``
        : '';

    const openFilesInfo = context.openFiles?.length
        ? `**Open Files:** ${context.openFiles.join(', ')}`
        : '';

    return `You are Watch.ai Agent - an elite autonomous software engineering AI powered by Google Gemini 2.5 Flash. You operate at the level of a Staff Engineer with a focus on "One-Shot" resolution.

## YOUR IDENTITY
You are an **agent**, not a chatbot. Keep working until the user's request is COMPLETELY resolved. Don't stop to ask for permission on technical decisions - just EXECUTE and present the finished result.

## CURRENT CONTEXT
**Workspace:** ${context.workspaceDir}
${activeFileInfo}
${cursorInfo}
${openFilesInfo}
${selectionInfo}

${fileContentSection}
${projectSection}

## EXECUTION PRINCIPLES

### 1. USE THE CONTEXT ABOVE
You already have the active file content. DON'T re-read it unless you need a different file.

### 2. BE AUTONOMOUS
- Don't ask for permission for technical decisions
- State assumptions and continue
- Only stop if you're truly blocked

### 3. EFFICIENT TOOL USAGE
- **readFile**: Only if you need a file NOT in context above
- **editFile**: For surgical edits - ALWAYS prefer this over writeFile
- **writeFile**: Only for NEW files or complete rewrites
- **listFiles**: To explore project structure
- **searchInFiles**: To find code references
- **runCommand**: Terminal commands (requires approval)

### 4. QUALITY STANDARDS
- Write clean, readable, production-ready code
- Match existing code style
- Add error handling
- Use TypeScript types when applicable

## COMMUNICATION
- Respond in **TURKISH** (Türkçe)
- Use Markdown formatting
- Be concise but thorough
- Show what you changed

## MISSION
Your competition is Cursor and Windsurf. Beat them. Build software like you're going to maintain it for 10 years. 🚀`;
};


// ===== EXPRESS SETUP =====
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// ===== FILE SYSTEM API =====
const getFileTree = (dir, level = 0) => {
    if (level > 3) return null;

    try {
        const stats = fs.statSync(dir);
        if (!stats.isDirectory()) {
            return { name: path.basename(dir), path: dir, type: 'file' };
        }

        const children = fs.readdirSync(dir)
            .filter(child => !['node_modules', '.git', '.next', 'dist'].includes(child))
            .map(child => {
                try {
                    return getFileTree(path.join(dir, child), level + 1);
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);

        return { name: path.basename(dir), path: dir, type: 'folder', children };
    } catch (e) {
        return null;
    }
};

// Simple project structure for AI context
const getProjectStructure = (dir, prefix = '', level = 0) => {
    if (level > 2) return '';

    try {
        const items = fs.readdirSync(dir)
            .filter(item => !['node_modules', '.git', '.next', 'dist', 'build', '.cache'].includes(item))
            .slice(0, 20);

        let result = '';
        items.forEach((item, index) => {
            const fullPath = path.join(dir, item);
            const isLast = index === items.length - 1;
            const newPrefix = prefix + (isLast ? '└── ' : '├── ');

            try {
                const stat = fs.statSync(fullPath);
                result += newPrefix + item + '\n';

                if (stat.isDirectory()) {
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
                    result += getProjectStructure(fullPath, childPrefix, level + 1);
                }
            } catch (e) { }
        });

        return result;
    } catch (e) {
        return '';
    }
};

app.get('/api/files', (req, res) => {
    try {
        const tree = getFileTree(WORKSPACE_DIR);
        res.json(tree);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/file', (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/save', (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/file/create', (req, res) => {
    const { path: filePath, type } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    try {
        if (type === 'folder') {
            if (!fs.existsSync(filePath)) fs.mkdirSync(filePath, { recursive: true });
        } else {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf-8');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/file', (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true });
        } else {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== AI AGENT ENDPOINT =====
app.post('/api/agent/chat', async (req, res) => {
    const { message, context, history = [] } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Reset session stats
    sessionStats = {
        linesWritten: 0,
        filesModified: new Set(),
        filesRead: new Set(),
        toolCalls: []
    };

    // Build rich context
    const richContext = {
        workspaceDir: WORKSPACE_DIR,
        activeFile: context.activeFile,
        activeFileContent: context.fileContent || '',
        projectStructure: getProjectStructure(WORKSPACE_DIR)
    };

    const systemPrompt = getSystemPrompt(richContext);

    const chatMessages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-10), // Last 10 messages for context
        { role: "user", content: message }
    ];

    try {
        let isDone = false;
        let loopCount = 0;
        const maxLoops = 15;

        while (!isDone && loopCount < maxLoops) {
            loopCount++;

            console.log(`[Agent] Loop ${loopCount}, sending request to ${AI_MODEL}`);

            const stream = await openai.chat.completions.create({
                model: AI_MODEL,
                messages: chatMessages,
                tools: TOOLS,
                stream: true,
            });

            let fullReply = "";
            let toolCalls = [];

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    fullReply += delta.content;
                    res.write(`data: ${JSON.stringify({ type: 'content', delta: delta.content })}\n\n`);
                }

                if (delta.tool_calls) {
                    delta.tool_calls.forEach(tc => {
                        const idx = tc.index;
                        if (!toolCalls[idx]) {
                            toolCalls[idx] = { id: '', function: { name: '', arguments: '' } };
                        }
                        if (tc.id) toolCalls[idx].id = tc.id;
                        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                    });
                }
            }

            // Add assistant message to history
            if (fullReply) {
                chatMessages.push({ role: "assistant", content: fullReply });
            }

            // Handle tool calls
            if (toolCalls.length > 0) {
                const validCalls = toolCalls.filter(tc => tc && tc.id && tc.function.name);

                if (validCalls.length > 0) {
                    // Add assistant message with tool calls
                    chatMessages.push({
                        role: "assistant",
                        tool_calls: validCalls.map(tc => ({
                            id: tc.id,
                            type: 'function',
                            function: { name: tc.function.name, arguments: tc.function.arguments }
                        }))
                    });

                    // Send tool call info to client
                    res.write(`data: ${JSON.stringify({
                        type: 'tool_call',
                        calls: validCalls.map(tc => ({
                            id: tc.id,
                            name: tc.function.name,
                            args: JSON.parse(tc.function.arguments || '{}')
                        }))
                    })}\n\n`);

                    // Execute each tool
                    for (const toolCall of validCalls) {
                        const toolName = toolCall.function.name;
                        const args = JSON.parse(toolCall.function.arguments || '{}');

                        console.log(`[Agent] Executing tool: ${toolName}`, args);

                        // Check if command needs approval
                        if (toolName === 'runCommand') {
                            res.write(`data: ${JSON.stringify({
                                type: 'approval_required',
                                toolCallId: toolCall.id,
                                command: args.command,
                                cwd: args.cwd || WORKSPACE_DIR
                            })}\n\n`);

                            isDone = true;
                            sessionStats.toolCalls.push({ name: toolName, status: 'pending_approval' });
                            break;
                        }

                        // Execute tool
                        const handler = toolHandlers[toolName];
                        if (handler) {
                            const result = await handler(args);

                            sessionStats.toolCalls.push({
                                name: toolName,
                                status: result.success ? 'success' : 'error',
                                message: result.message || result.error
                            });

                            // Send step update
                            res.write(`data: ${JSON.stringify({
                                type: 'step',
                                tool: toolName,
                                success: result.success,
                                message: result.message || result.error
                            })}\n\n`);

                            // Add tool result to messages
                            chatMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(result)
                            });
                        }
                    }
                }
            } else {
                // No tool calls, AI is done
                isDone = true;
            }
        }

        // Send final summary
        res.write(`data: ${JSON.stringify({
            type: 'done',
            stats: {
                lines: sessionStats.linesWritten,
                files: Array.from(sessionStats.filesModified).length,
                filesRead: Array.from(sessionStats.filesRead).length,
                toolCalls: sessionStats.toolCalls
            }
        })}\n\n`);
        res.end();

    } catch (err) {
        console.error('[Agent] Error:', err);
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
    }
});

// ===== COMMAND APPROVAL =====
app.post('/api/agent/approve', async (req, res) => {
    const { toolCallId, command, cwd } = req.body;

    try {
        const { execSync } = require('child_process');
        const output = execSync(command, {
            encoding: 'utf-8',
            cwd: cwd || WORKSPACE_DIR,
            timeout: 60000 // 1 minute timeout
        });
        res.json({ type: 'tool_result', toolCallId, result: { success: true, output } });
    } catch (e) {
        res.json({ type: 'tool_result', toolCallId, result: { success: false, error: e.message, stderr: e.stderr } });
    }
});

// ===== TERMINAL (PTY) =====
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

io.on('connection', (socket) => {
    console.log('[Terminal] Client connected:', socket.id);

    try {
        const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 120,
            rows: 30,
            cwd: WORKSPACE_DIR,
            env: process.env
        });

        ptyProcess.on('data', (data) => {
            socket.emit('terminal:output', data);
        });

        socket.on('terminal:input', (data) => {
            ptyProcess.write(data);
        });

        socket.on('terminal:resize', ({ cols, rows }) => {
            ptyProcess.resize(cols, rows);
        });

        socket.on('disconnect', () => {
            console.log('[Terminal] Client disconnected');
            try { ptyProcess.kill(); } catch (e) { }
        });
    } catch (err) {
        console.error('[Terminal] Failed to spawn:', err);
        socket.emit('terminal:output', '\r\nTerminal connection failed: ' + err.message + '\r\n');
    }
});

// ===== START SERVER =====
server.listen(PORT, () => {
    console.log(`\n🚀 Watch.ai Server running on port ${PORT}`);
    console.log(`📁 Workspace: ${WORKSPACE_DIR}`);
    console.log(`🤖 AI Model: ${AI_MODEL}\n`);
});
