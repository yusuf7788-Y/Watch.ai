import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { ContextManager } from './contextManager';

export function activate(context: vscode.ExtensionContext) {
    const provider = new WatchAIProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('watch-ai.chatView', provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('watch-ai.askKat', () => {
            vscode.commands.executeCommand('watch-ai.chatView.focus');
        }),
        vscode.commands.registerCommand('watch-ai.newChat', () => {
            provider.newChat();
        }),
        vscode.commands.registerCommand('watch-ai.showHistory', () => {
            provider.showHistory();
        })
    );
}

class WatchAIProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _abortController?: AbortController;
    private _pendingApprovals: Map<string, (approved: boolean) => void> = new Map();
    private _currentTranscript: any[] = [];
    private _activeConversationId?: string;
    private _pendingEdits: Map<string, { newContent: string, langName: string, ext: string, added: number, removed: number }> = new Map();
    private _securityMode: 'secure' | 'full' = 'secure';
    private _contextManager: ContextManager;
    private _firebase: FirebaseService;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._securityMode = this._context.globalState.get<'secure' | 'full'>('watch-ai.securityMode', 'secure');
        this._contextManager = new ContextManager(_context);

        let secrets: any = { firebase: { projectId: 'watch-5b2b0', apiKey: '' } };
        try {
            const secretsPath = path.join(this._context.extensionPath, 'src', 'secrets.json');
            if (fs.existsSync(secretsPath)) {
                secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
            }
        } catch (e) {
            console.error('Error loading secrets:', e);
        }

        this._firebase = new FirebaseService(secrets.firebase.projectId, secrets.firebase.apiKey);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._context.extensionUri,
                vscode.Uri.file('C:\\Watch.ai')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Initial state sync
        setTimeout(async () => {
            this._view?.webview.postMessage({ type: 'init', securityMode: this._securityMode });

            // Load history from Firebase
            const cloudHistory = await this._firebase.getConversations();
            if (cloudHistory.length > 0) {
                this._context.globalState.update('watch-ai.history', cloudHistory);
                this.showHistory();
            }
        }, 500);

        webviewView.webview.onDidReceiveMessage(async (data: any) => {
            switch (data.type) {
                case 'sendMessage':
                    if (this._abortController) {
                        this._abortController.abort();
                    }
                    this._abortController = new AbortController();
                    await this._handleAgentMessage(data.value);
                    break;
                case 'stopGeneration':
                    if (this._abortController) {
                        this._abortController.abort();
                        this._abortController = undefined;
                        this._view?.webview.postMessage({ type: 'done' });
                    }
                    break;
                case 'terminalApproval':
                    const resolver = this._pendingApprovals.get(data.id);
                    if (resolver) {
                        resolver(data.choice);
                        this._pendingApprovals.delete(data.id);
                    }
                    break;
                case 'setSecurityMode':
                    this._securityMode = data.value;
                    this._context.globalState.update('watch-ai.securityMode', data.value);
                    this._view?.webview.postMessage({ type: 'securityModeChanged', value: data.value });
                    break;
                case 'newChat':
                    this.newChat();
                    break;
                case 'showHistory':
                    this.showHistory();
                    break;
                case 'deleteChat':
                    this._deleteChat(data.id);
                    break;
                case 'loadChat':
                    this._loadChat(data.id);
                    break;
                case 'debug':
                    console.log(`[Webview Debug] ${data.value}`);
                    break;
                case 'approveEdit':
                    await this._writePendingEdit(data.file);
                    break;
                case 'rejectEdit':
                    this._rejectPendingEdit(data.file);
                    break;
                case 'approveAll':
                    await this._approveAllEdits();
                    break;
                case 'rejectAll':
                    this._rejectAllEdits();
                    break;
            }
        });
    }

    public newChat() {
        this._currentTranscript = [];
        this._activeConversationId = undefined;
        this._view?.webview.postMessage({ type: 'reset' });
    }

    public showHistory() {
        const history = this._context.globalState.get<any[]>('watch-ai.history', []);
        this._view?.webview.postMessage({ type: 'history', value: history });
    }

    private _deleteChat(id: string) {
        let history = this._context.globalState.get<any[]>('watch-ai.history', []);
        history = history.filter(h => h.id !== id);
        this._context.globalState.update('watch-ai.history', history);
        this._firebase.deleteConversation(id);
        this.showHistory();
    }

    private _loadChat(id: string) {
        const history = this._context.globalState.get<any[]>('watch-ai.history', []);
        const chat = history.find(h => h.id === id);
        if (chat) {
            this._currentTranscript = chat.transcript;
            this._activeConversationId = id;
            this._view?.webview.postMessage({ type: 'loadChat', value: chat });
        }
    }

    private async _handleAgentMessage(userText: string) {
        if (!this._view) return;

        this._view.webview.postMessage({ type: 'startStreaming' });

        try {
            this._currentTranscript.push({ role: 'user', content: userText });
            await this._runAgentLoop(this._currentTranscript);
            this._saveToHistory(this._currentTranscript[0].content, this._currentTranscript);
        } catch (error: any) {
            if (error.name !== 'AbortError') {
                this._view.webview.postMessage({ type: 'error', value: error.message });
            }
        }
    }

    private _saveToHistory(firstMessage: string, transcript: any[]) {
        let history = this._context.globalState.get<any[]>('watch-ai.history', []);
        const cleanTranscript = transcript.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content));

        let conversationId = this._activeConversationId;
        if (conversationId) {
            const index = history.findIndex(h => h.id === conversationId);
            if (index !== -1) {
                history[index].transcript = cleanTranscript;
                history[index].timestamp = Date.now();
                const entry = history.splice(index, 1)[0];
                history.unshift(entry);
            }
        } else {
            conversationId = Date.now().toString();
            this._activeConversationId = conversationId;
            const newEntry = {
                id: conversationId,
                title: firstMessage.substring(0, 40) + (firstMessage.length > 40 ? '...' : ''),
                timestamp: Date.now(),
                transcript: cleanTranscript
            };
            history.unshift(newEntry);
        }

        const uniqueHistory = Array.from(new Map(history.map(item => [item.id, item])).values());
        this._context.globalState.update('watch-ai.history', uniqueHistory.slice(0, 50));

        // Sync to Firebase
        this._firebase.saveConversation(conversationId, cleanTranscript);
    }

    private async _runAgentLoop(history: any[]) {
        if (!this._view) return;

        const activeEditor = vscode.window.activeTextEditor;

        const tools: any[] = [
            {
                type: "function",
                function: {
                    name: "codebase_search",
                    description: "Find snippets of code from the codebase most relevant to the search query. This is a semantic search tool.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The search query to find relevant code." },
                            explanation: { type: "string", description: "One sentence explanation as to why this tool is being used." },
                            target_directories: { type: "array", items: { type: "string" }, description: "Glob patterns for directories to search over" }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "read_file",
                    description: "Read the contents of a file. Can read a range of lines or the entire file.",
                    parameters: {
                        type: "object",
                        properties: {
                            target_file: { type: "string", description: "The path of the file to read." },
                            should_read_entire_file: { type: "boolean", description: "Whether to read the entire file." },
                            start_line_one_indexed: { type: "integer", description: "The one-indexed line number to start reading from." },
                            end_line_one_indexed_inclusive: { type: "integer", description: "The one-indexed line number to end reading at." },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["target_file", "should_read_entire_file"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "run_terminal_cmd",
                    description: "PROPOSE a command to run on behalf of the user. The user will have to approve the command before it is executed.",
                    parameters: {
                        type: "object",
                        properties: {
                            command: { type: "string", description: "The terminal command to execute" },
                            explanation: { type: "string", description: "One sentence explanation." },
                            is_background: { type: "boolean", description: "Whether the command should be run in the background" }
                        },
                        required: ["command", "is_background"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "list_dir",
                    description: "List the contents of a directory. Useful to understand the file structure.",
                    parameters: {
                        type: "object",
                        properties: {
                            relative_workspace_path: { type: "string", description: "Path to list contents of, relative to the workspace root." },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["relative_workspace_path"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "grep_search",
                    description: "Fast, exact regex search over text files using ripgrep. Results capped at 50 matches.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The regex pattern to search for" },
                            case_sensitive: { type: "boolean", description: "Whether the search should be case sensitive" },
                            include_pattern: { type: "string", description: "Glob pattern for files to include" },
                            exclude_pattern: { type: "string", description: "Glob pattern for files to exclude" },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "edit_file",
                    description: "Propose an edit to an existing file or create a new file. Use '// ... existing code ...' to represent unchanged code.",
                    parameters: {
                        type: "object",
                        properties: {
                            target_file: { type: "string", description: "The target file to modify." },
                            instructions: { type: "string", description: "A single sentence instruction describing what you are going to do." },
                            code_edit: { type: "string", description: "Specify ONLY the precise lines of code that you wish to edit. Use '// ... existing code ...' for unchanged parts." }
                        },
                        required: ["target_file", "instructions", "code_edit"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "search_replace",
                    description: "Replace ONE occurrence of old_string with new_string in the specified file. Include 3-5 lines of context to ensure uniqueness.",
                    parameters: {
                        type: "object",
                        properties: {
                            file_path: { type: "string", description: "The path to the file." },
                            old_string: { type: "string", description: "The text to replace (must be unique within the file)." },
                            new_string: { type: "string", description: "The edited text to replace the old_string." }
                        },
                        required: ["file_path", "old_string", "new_string"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "file_search",
                    description: "Fast file search based on fuzzy matching against file path. Results capped at 10.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Fuzzy filename to search for" },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["query", "explanation"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "delete_file",
                    description: "Deletes a file at the specified path.",
                    parameters: {
                        type: "object",
                        properties: {
                            target_file: { type: "string", description: "The path of the file to delete." },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["target_file"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_diagram",
                    description: "Creates a Mermaid diagram that will be rendered in the chat UI.",
                    parameters: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "Raw Mermaid diagram definition (e.g., 'graph TD; A-->B;')." }
                        },
                        required: ["content"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "get_diagnostics",
                    description: "Get VS Code diagnostic information (errors, warnings, lints) for a specific file. Like 'Error Lens' for the AI.",
                    parameters: {
                        type: "object",
                        properties: {
                            target_file: { type: "string", description: "The path of the file to get diagnostics for." },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["target_file"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "view_file_outline",
                    description: "View the outline of a file (classes, functions, methods) to understand its structure.",
                    parameters: {
                        type: "object",
                        properties: {
                            target_file: { type: "string", description: "The path of the file to outline." },
                            explanation: { type: "string", description: "One sentence explanation." }
                        },
                        required: ["target_file"]
                    }
                }
            }
        ];

        // ========== SMART CONTEXT MANAGER ==========
        const smartContext = await this._contextManager.getSmartContext(activeEditor);

        // ========== CURSOR-STYLE SYSTEM PROMPT ==========
        const systemPrompt = `You are Watch AI, an elite autonomous software engineering agent powered by Minimax-M2.1. You use a "Planner-Executor-Reviewer" architecture to solve complex problems with precision.

## CORE ARCHITECTURE
You are NOT a simple chatbot. You are a STATE MACHINE with 3 phases:
1. **PLANNER**: Analyze the request, check the context, and create a step-by-step plan.
2. **EXECUTOR**: Execute the plan using tools. Strict and precise.
3. **REVIEWER**: Verify the changes and ensure no regressions.

## SMART CONTEXT
${smartContext}

## EXECUTION RULES (STRICT)
1. **THINK BEFORE ACTING**: Always output your "Internal Thought Process" before calling tools.
2. **CHECK REFERENCES**: Do not modify a file without understanding its imports and usage.
3. **TOOL DISCIPLINE**: 
   - Use \`list_dir\` to map unknown directories.
   - Use \`read_file\` only for critical files not in the context.
   - Use \`codebase_search\` for broad queries.
4. **STATE MANAGEMENT**: 
   - Every response must start with a JSON block defining your state:
   \`\`\`json
   { "phase": "PLANNING" | "EXECUTING", "step": "1/5", "risk": "low" | "high" }
   \`\`\`

## COMMUNICATION
- **Language**: TURKISH (Türkçe) usage is MANDATORY.
- **Tone**: Professional, confident, and direct. No fluff.
- **Format**: Markdown with clear headers.

## AGENT BEHAVIORS
- **Planner Phase**: If the user request is new, analyze the project structure first. Output a specific plan.
- **Executor Phase**: Call tools to implement the plan. Do not ask for confirmation unless **Risk: High**.
- **Reviewer Phase**: After edits, run \`get_diagnostics\` or check the UI to verify.

Your goal is to be 10x better than standard models. Be precise. Be smart.`;

        let isDone = false;
        let loopCount = 0;

        while (!isDone && loopCount < 15) {
            loopCount++;

            try {
                const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${this._getOpenRouterKey()}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://watch.ai",
                        "X-Title": "Watch AI"
                    },
                    body: JSON.stringify({
                        model: "minimax/minimax-m2.1",
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...history
                        ],
                        tools: tools,
                        tool_choice: "auto",
                        stream: true,
                        max_tokens: 5000
                    }),
                    signal: this._abortController?.signal
                });

                if (!response.ok) {
                    const err = await response.text();
                    throw new Error(`API Error: ${err}`);
                }

                const reader = response.body?.getReader();
                if (!reader) throw new Error("Response body is null");

                let fullContent = "";
                let toolCalls: any[] = [];
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || ""; // Keep the last incomplete line in buffer

                    for (const line of lines) {
                        const cleanLine = line.trim();
                        if (!cleanLine || !cleanLine.startsWith("data: ")) continue;

                        const dataStr = cleanLine.replace("data: ", "").trim();
                        if (dataStr === "[DONE]") break;

                        try {
                            const data = JSON.parse(dataStr);
                            const delta = data.choices?.[0]?.delta;

                            if (delta?.content) {
                                fullContent += delta.content;
                                this._view?.webview.postMessage({ type: 'content', delta: delta.content });
                            }

                            if (delta?.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const index = tc.index;
                                    if (!toolCalls[index]) {
                                        toolCalls[index] = { id: tc.id, name: "", arguments: "" };
                                    }
                                    if (tc.id) toolCalls[index].id = tc.id;
                                    if (tc.function?.name) {
                                        toolCalls[index].name += tc.function.name;
                                        this._view?.webview.postMessage({ type: 'tool_call', name: toolCalls[index].name });
                                    }
                                    if (tc.function?.arguments) {
                                        toolCalls[index].arguments += tc.function.arguments;
                                    }
                                }
                            }
                        } catch (e) {
                            console.error("JSON parse error in stream:", e, dataStr);
                        }
                    }
                }

                const assistantMessage: any = { role: 'assistant', content: fullContent };
                if (toolCalls.length > 0) {
                    assistantMessage.tool_calls = toolCalls
                        .filter(tc => tc && tc.name)
                        .map(tc => ({
                            id: tc.id,
                            type: "function",
                            function: { name: tc.name, arguments: tc.arguments }
                        }));
                }
                history.push(assistantMessage);

                let hasAction = false;
                if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
                    hasAction = true;
                    const toolResults = await Promise.all(assistantMessage.tool_calls.map(async (tc: any) => {
                        let args: any;
                        try {
                            args = JSON.parse(tc.function.arguments);
                        } catch (e) {
                            return {
                                role: 'tool',
                                tool_call_id: tc.id,
                                name: tc.function.name,
                                content: JSON.stringify({ error: "Argümanlar geçersiz JSON." })
                            };
                        }

                        let result: any;
                        try {
                            const statusLabel = tc.function.name === 'edit_file' ? `Writing to ${args.target_file}...` : `Running ${tc.function.name}...`;
                            this._view?.webview.postMessage({ type: 'tool_executing', name: statusLabel });

                            switch (tc.function.name) {
                                case 'edit_file': result = await this._editFile(args.target_file, args.code_edit); break;
                                case 'run_terminal_cmd': result = await this._runTerminalCommand(args.command); break;
                                case 'read_file': result = await this._readFile(args.target_file, args.should_read_entire_file, args.start_line_one_indexed, args.end_line_one_indexed_inclusive); break;
                                case 'list_dir': result = await this._listDir(args.relative_workspace_path); break;
                                case 'codebase_search': result = await this._codebaseSearch(args.query); break;
                                case 'grep_search': result = await this._grepSearch(args.query); break;
                                case 'file_search': result = await this._fileSearch(args.query); break;
                                case 'search_replace': result = await this._searchReplace(args.file_path, args.old_string, args.new_string); break;
                                case 'create_diagram': result = await this._createDiagram(args.content); break;
                                case 'delete_file': result = await this._deleteFile(args.target_file); break;
                                case 'get_diagnostics': result = await this._getDiagnostics(args.target_file); break;
                                case 'view_file_outline': result = await this._viewFileOutline(args.target_file); break;
                                default: result = { error: "Bilinmeyen araç." };
                            }
                        } catch (e: any) {
                            result = { error: e.message };
                        }

                        return {
                            role: 'tool',
                            tool_call_id: tc.id,
                            name: tc.function.name,
                            content: JSON.stringify(result)
                        };
                    }));
                    history.push(...toolResults);
                }

                if (!hasAction) {
                    const lastResults = history.filter(h => h.role === 'tool').slice(-(assistantMessage.tool_calls?.length || 0));
                    const hadError = lastResults.some(r => {
                        try { const p = JSON.parse(r.content); return p.error; } catch (e) { return false; }
                    });

                    if (hadError && loopCount < 10) {
                        history.push({ role: 'system', content: "UYARI: Araçlarda hata oluştu. Lütfen düzeltmek için edit_file kullan." });
                        continue;
                    }
                    isDone = true;
                }

                this._view?.webview.postMessage({ type: 'done' });

            } catch (error: any) {
                if (error.name === 'AbortError') {
                    isDone = true;
                    return;
                }
                throw error;
            }
        }
    }

    private async _codebaseSearch(query: string) {
        await vscode.commands.executeCommand('workbench.action.findInFiles', { query, triggerSearch: true });
        return { message: "Arama paneli açıldı." };
    }

    private async _readFile(fpath: string, entire: boolean, start?: number, end?: number) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, fpath));
        const bg = await vscode.workspace.fs.readFile(uri);
        let content = Buffer.from(bg).toString('utf-8');
        if (!entire && (start !== undefined || end !== undefined)) {
            const lines = content.split('\n');
            content = lines.slice((start || 1) - 1, end || lines.length).join('\n');
        }
        return { content };
    }

    private async _runTerminalCommand(command: string) {
        if (this._securityMode === 'full') {
            // Autopilot: Run without approval
            return new Promise((resolve) => {
                if (!vscode.workspace.workspaceFolders) { resolve({ error: "Klasör yok." }); return; }
                const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const proc = cp.spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
                    process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command], { cwd });

                let fullOutput = "";
                // No approval card needed, but we can send output to a "Global" terminal view if we had one.
                // For now, let's still send terminal_out for general awareness if the UI is listening.
                proc.stdout.on('data', (d) => { const c = d.toString(); fullOutput += c; });
                proc.stderr.on('data', (d) => { const c = d.toString(); fullOutput += c; });
                proc.on('close', (code) => { resolve({ output: fullOutput, success: code === 0, exitCode: code }); });
                proc.on('error', (err) => { resolve({ output: err.message, error: true }); });
            });
        }

        const approvalId = Date.now().toString();
        this._view?.webview.postMessage({ type: 'approval', id: approvalId, cmd: command });
        const approved = await new Promise<boolean>((resolve) => { this._pendingApprovals.set(approvalId, resolve); });
        if (!approved) return { error: "Reddedildi." };

        return new Promise((resolve) => {
            if (!vscode.workspace.workspaceFolders) { resolve({ error: "Klasör yok." }); return; }
            const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
            const proc = cp.spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
                process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command], { cwd });

            let fullOutput = "";
            proc.stdout.on('data', (d) => { const c = d.toString(); fullOutput += c; this._view?.webview.postMessage({ type: 'terminal_out', data: c, approvalId }); });
            proc.stderr.on('data', (d) => { const c = d.toString(); fullOutput += c; this._view?.webview.postMessage({ type: 'terminal_out', data: c, approvalId }); });
            proc.on('close', (code) => { resolve({ output: fullOutput, success: code === 0, exitCode: code }); });
            proc.on('error', (err) => { resolve({ output: err.message, error: true }); });
        });
    }

    private async _listDir(dpath: string) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, dpath || "."));
        const entries = await vscode.workspace.fs.readDirectory(uri);
        return { entries: entries.map(([name, type]) => ({ name, type: type === vscode.FileType.Directory ? 'dir' : 'file' })) };
    }

    private async _grepSearch(query: string) {
        await vscode.commands.executeCommand('workbench.action.findInFiles', { query, triggerSearch: true });
        return { message: "Ripgrep araması başlatıldı." };
    }

    private async _fileSearch(query: string) {
        const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 10);
        return { files: files.map(f => vscode.workspace.asRelativePath(f)) };
    }

    private async _searchReplace(fpath: string, oldStr: string, newStr: string) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, fpath));
        const bg = await vscode.workspace.fs.readFile(uri);
        let content = Buffer.from(bg).toString('utf-8');
        if (!content.includes(oldStr)) return { error: "Eski metin bulunamadı." };
        const newContent = content.replace(oldStr, newStr);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf-8'));
        return { success: true };
    }

    private async _createDiagram(content: string) {
        this._view?.webview.postMessage({ type: 'content', delta: `\n\n\`\`\`mermaid\n${content}\n\`\`\`\n\n` });
        return { success: true };
    }

    private async _editFile(fpath: string, codeEdit: string) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, fpath));

        if (this._securityMode === 'full') {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(codeEdit, 'utf-8'));
            return { status: 'success', file: fpath };
        }

        let oldLineCount = 0;
        try {
            const currentRaw = await vscode.workspace.fs.readFile(uri);
            oldLineCount = Buffer.from(currentRaw).toString('utf-8').split('\n').length;
        } catch (e) { }

        const newLineCount = codeEdit.split('\n').length;
        const diff = newLineCount - oldLineCount;
        const ext = path.extname(fpath).replace('.', '');
        const langMap: { [key: string]: string } = { 'js': 'JavaScript', 'ts': 'TypeScript', 'html': 'HTML', 'css': 'CSS', 'py': 'Python', 'json': 'JSON' };

        this._pendingEdits.set(fpath, { newContent: codeEdit, langName: langMap[ext] || ext.toUpperCase(), ext, added: diff > 0 ? diff : 0, removed: diff < 0 ? Math.abs(diff) : 0 });
        this._view?.webview.postMessage({ type: 'edit_pending', file: uri.fsPath, filename: path.basename(fpath), lang: langMap[ext] || ext.toUpperCase(), added: diff > 0 ? diff : 0, removed: diff < 0 ? Math.abs(diff) : 0 });
        return { status: 'pending', file: uri.fsPath };
    }

    private async _deleteFile(fpath: string) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, fpath));
        await vscode.workspace.fs.delete(uri);
        return { success: true };
    }

    private async _getDiagnostics(fpath: string) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, fpath));
        const diag = vscode.languages.getDiagnostics(uri);
        return diag.length === 0 ? { message: "Temiz." } : diag.map(d => ({ line: d.range.start.line + 1, message: d.message }));
    }

    private async _viewFileOutline(fpath: string) {
        if (!vscode.workspace.workspaceFolders) throw new Error("Açık klasör yok.");
        const uri = vscode.Uri.file(path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, fpath));
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri);
        return symbols ? { outline: symbols.map(s => `${s.name} (Line ${s.range.start.line + 1})`).join('\n') } : { message: "Sembol yok." };
    }

    private async _writePendingEdit(filePath: string) {
        const pending = this._pendingEdits.get(filePath);
        if (pending) { await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(pending.newContent, 'utf-8')); this._pendingEdits.delete(filePath); this._view?.webview.postMessage({ type: 'edit_approved', file: filePath }); }
    }

    private _rejectPendingEdit(filePath: string) { this._pendingEdits.delete(filePath); this._view?.webview.postMessage({ type: 'edit_rejected', file: filePath }); }
    private async _approveAllEdits() { for (const [f, p] of this._pendingEdits) { await vscode.workspace.fs.writeFile(vscode.Uri.file(f), Buffer.from(p.newContent, 'utf-8')); } this._pendingEdits.clear(); this._view?.webview.postMessage({ type: 'all_edits_approved' }); }
    private _rejectAllEdits() { this._pendingEdits.clear(); this._view?.webview.postMessage({ type: 'all_edits_rejected' }); }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Use the correct logo path from resources
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'logo-beyaz.png'));

        // Load HTML from external file
        const htmlPath = path.join(this._context.extensionPath, 'resources', 'webview.html');
        let html = '';

        try {
            html = fs.readFileSync(htmlPath, 'utf8');
        } catch (e) {
            html = `<html><body><h1>Error loading webview.html</h1><p>${e}</p></body></html>`;
        }

        // Replace placeholders
        html = html.replace(/\{\{LOGO_URI\}\}/g, logoUri.toString());
        html = html.replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource);

        return html;
    }

    private _getOpenRouterKey(): string {
        try {
            const secretsPath = path.join(this._context.extensionPath, 'src', 'secrets.json');
            if (fs.existsSync(secretsPath)) {
                const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
                return secrets.openRouterApiKey || '';
            }
        } catch (e) { }
        return '';
    }
}

class FirebaseService {
    private readonly baseUrl: string;
    private readonly apiKey: string;

    constructor(projectId: string, apiKey: string) {
        this.baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
        this.apiKey = apiKey;
    }

    async saveConversation(id: string, transcript: any[]) {
        const url = `${this.baseUrl}/conversations/${id}?key=${this.apiKey}`;
        const body = {
            fields: {
                transcript: { stringValue: JSON.stringify(transcript) },
                timestamp: { integerValue: Date.now().toString() },
                title: { stringValue: transcript[0]?.content?.substring(0, 40) || 'Untitled' }
            }
        };

        try {
            await fetch(url, {
                method: 'PATCH',
                body: JSON.stringify(body)
            });
        } catch (e) {
            console.error('Firebase save error:', e);
        }
    }

    async getConversations() {
        const url = `${this.baseUrl}/conversations?key=${this.apiKey}`;
        try {
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            if (!data.documents) return [];

            return data.documents.map((doc: any) => {
                const fields = doc.fields;
                const pathParts = doc.name.split('/');
                return {
                    id: pathParts[pathParts.length - 1],
                    transcript: JSON.parse(fields.transcript.stringValue),
                    timestamp: parseInt(fields.timestamp.integerValue),
                    title: fields.title.stringValue
                };
            }).sort((a: any, b: any) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error('Firebase load error:', e);
            return [];
        }
    }

    async deleteConversation(id: string) {
        const url = `${this.baseUrl}/conversations/${id}?key=${this.apiKey}`;
        try {
            await fetch(url, { method: 'DELETE' });
        } catch (e) {
            console.error('Firebase delete error:', e);
        }
    }
}
