import React, { useState, useEffect, useRef } from 'react';
import { streamAgent, approveCommand } from '../services/agentService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
    Terminal, CheckCircle, Play, XCircle, Loader2, Bot, User,
    ClipboardList, AlertTriangle, FileCode, FolderOpen, Search,
    Pencil, Trash2, Copy, Check, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ChatInterface = ({ activeFile, fileContent }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [currentResponse, setCurrentResponse] = useState('');
    const [currentSteps, setCurrentSteps] = useState([]);
    const [pendingApproval, setPendingApproval] = useState(null);
    const [copiedCode, setCopiedCode] = useState(null);
    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, currentResponse, currentSteps]);

    // Reset copied state after 2 seconds
    useEffect(() => {
        if (copiedCode) {
            const timer = setTimeout(() => setCopiedCode(null), 2000);
            return () => clearTimeout(timer);
        }
    }, [copiedCode]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);
        setCurrentResponse('');
        setCurrentSteps([]);

        const history = messages.slice(-10);
        const context = { activeFile, fileContent };

        try {
            await streamAgent(input, context, history, (chunk) => {
                handleChunk(chunk);
            });
        } catch (err) {
            console.error('Stream error:', err);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `❌ Bağlantı hatası: ${err.message}`,
                isError: true
            }]);
            setIsLoading(false);
        }
    };

    const handleChunk = (chunk) => {
        switch (chunk.type) {
            case 'content':
                setCurrentResponse(prev => prev + chunk.delta);
                break;

            case 'tool_call':
                const newSteps = chunk.calls.map(call => ({
                    id: call.id,
                    name: call.name,
                    args: call.args,
                    status: 'running',
                    icon: getToolIcon(call.name)
                }));
                setCurrentSteps(prev => [...prev, ...newSteps]);
                break;

            case 'step':
                setCurrentSteps(prev => prev.map(step =>
                    step.name === chunk.tool
                        ? { ...step, status: chunk.success ? 'done' : 'error', message: chunk.message }
                        : step
                ));
                break;

            case 'approval_required':
                setPendingApproval({
                    id: chunk.toolCallId,
                    command: chunk.command,
                    cwd: chunk.cwd
                });
                break;

            case 'done':
                finishResponse(chunk.stats);
                break;

            case 'error':
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `❌ Hata: ${chunk.error}`,
                    isError: true
                }]);
                setIsLoading(false);
                break;
        }
    };

    const finishResponse = (stats) => {
        const statsInfo = stats && (stats.files > 0 || stats.toolCalls?.length > 0)
            ? `\n\n---\n📊 **Özet:** ${stats.files} dosya değiştirildi, ${stats.lines} satır yazıldı`
            : '';

        setMessages(prev => [...prev, {
            role: 'assistant',
            content: currentResponse + statsInfo,
            steps: currentSteps
        }]);
        setCurrentResponse('');
        setCurrentSteps([]);
        setIsLoading(false);
    };

    const getToolIcon = (toolName) => {
        switch (toolName) {
            case 'readFile': return FileCode;
            case 'writeFile': return Pencil;
            case 'editFile': return Pencil;
            case 'deleteFile': return Trash2;
            case 'listFiles': return FolderOpen;
            case 'searchInFiles': return Search;
            case 'runCommand': return Terminal;
            default: return Sparkles;
        }
    };

    const handleApproval = async (approved) => {
        const { id, command, cwd } = pendingApproval;
        setPendingApproval(null);

        if (approved) {
            setIsLoading(true);
            setCurrentSteps(prev => [...prev, {
                id,
                name: 'runCommand',
                args: { command },
                status: 'running',
                icon: Terminal
            }]);

            try {
                const data = await approveCommand(id, command, cwd);

                setCurrentSteps(prev => prev.map(step =>
                    step.id === id
                        ? { ...step, status: data.result.success ? 'done' : 'error', message: data.result.output || data.result.error }
                        : step
                ));

                // Resume conversation
                const history = [
                    ...messages,
                    { role: 'assistant', content: currentResponse },
                    { role: 'tool', tool_call_id: id, content: JSON.stringify(data.result) }
                ];

                setMessages(history);
                setCurrentResponse('');
                resumeAgent("Komut çalıştırıldı. Sonuç: " + (data.result.output || data.result.error), history);
            } catch (err) {
                setIsLoading(false);
            }
        } else {
            setCurrentSteps(prev => [...prev, {
                id,
                name: 'runCommand',
                args: { command },
                status: 'error',
                message: 'Kullanıcı tarafından reddedildi'
            }]);
        }
    };

    const resumeAgent = async (msg, customHistory) => {
        const context = { activeFile, fileContent };

        try {
            await streamAgent(msg, context, customHistory, handleChunk);
        } catch (err) {
            console.error('Resume error:', err);
            setIsLoading(false);
        }
    };

    const copyToClipboard = (code) => {
        navigator.clipboard.writeText(code);
        setCopiedCode(code);
    };

    return (
        <div className="flex flex-col h-full bg-gradient-to-b from-[#0d0d0d] to-[#141414] text-[#e0e0e0]">
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#2a2a2a] flex items-center gap-3 bg-[#0d0d0d]/80 backdrop-blur-sm">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <Bot size={18} className="text-white" />
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-white">Watch.ai Agent</h2>
                    <div className="text-[10px] text-[#666] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        Gemini 2.5 Flash
                    </div>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 flex items-center justify-center mb-4">
                            <Sparkles size={28} className="text-amber-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-white mb-2">Watch.ai Agent</h3>
                        <p className="text-sm text-[#666] max-w-xs">
                            Kod yazma, düzenleme ve proje geliştirmede yardımcı olabilirim. Bir görev ver!
                        </p>
                        <div className="mt-6 space-y-2 text-xs text-[#555]">
                            <div className="flex items-center gap-2">
                                <FileCode size={14} /> "Bu dosyayı analiz et"
                            </div>
                            <div className="flex items-center gap-2">
                                <Pencil size={14} /> "Yeni bir component oluştur"
                            </div>
                            <div className="flex items-center gap-2">
                                <Terminal size={14} /> "npm install çalıştır"
                            </div>
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <MessageBubble
                        key={i}
                        message={msg}
                        onCopy={copyToClipboard}
                        copiedCode={copiedCode}
                    />
                ))}

                {/* Current Response Streaming */}
                {(currentResponse || currentSteps.length > 0) && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
                            <Bot size={16} className="text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            {/* Tool Steps */}
                            {currentSteps.length > 0 && (
                                <div className="mb-3 space-y-2">
                                    {currentSteps.map((step, idx) => (
                                        <ToolStep key={idx} step={step} />
                                    ))}
                                </div>
                            )}

                            {/* Streaming Text */}
                            {currentResponse && (
                                <div className="bg-[#1a1a1a]/80 backdrop-blur-sm rounded-xl p-4 border border-[#2a2a2a]">
                                    <ChatContent content={currentResponse} onCopy={copyToClipboard} copiedCode={copiedCode} />
                                    <span className="inline-block w-2 h-4 bg-amber-500 animate-pulse ml-1"></span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && !currentResponse && currentSteps.length === 0 && (
                    <div className="flex items-center gap-3 text-sm text-[#666] ml-11">
                        <Loader2 className="animate-spin" size={16} />
                        Düşünüyor...
                    </div>
                )}

                {/* Approval Modal */}
                <AnimatePresence>
                    {pendingApproval && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="ml-11 p-4 bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] border border-amber-500/30 rounded-xl shadow-xl shadow-amber-500/5"
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold text-amber-500 mb-3">
                                <AlertTriangle size={16} />
                                Komut Onayı Gerekiyor
                            </div>
                            <div className="bg-black/40 p-3 rounded-lg font-mono text-xs text-[#aaa] mb-4 border border-white/5 overflow-x-auto">
                                <span className="text-green-400">$</span> {pendingApproval.command}
                            </div>
                            <div className="flex gap-2 justify-end">
                                <button
                                    onClick={() => handleApproval(false)}
                                    className="px-4 py-2 text-xs bg-[#2a2a2a] hover:bg-[#333] rounded-lg flex items-center gap-2 transition-colors"
                                >
                                    <XCircle size={14} /> Reddet
                                </button>
                                <button
                                    onClick={() => handleApproval(true)}
                                    className="px-4 py-2 text-xs bg-gradient-to-r from-amber-500 to-orange-600 text-black hover:from-amber-400 hover:to-orange-500 rounded-lg font-semibold flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
                                >
                                    <Play size={14} /> Çalıştır
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div ref={scrollRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-[#2a2a2a] bg-[#0d0d0d]/80 backdrop-blur-sm">
                <div className="relative">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder="Bir görev tanımla veya soru sor..."
                        className="w-full bg-[#1a1a1a] text-sm text-[#e0e0e0] rounded-xl pl-4 pr-12 py-3 border border-[#2a2a2a] focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/20 resize-none min-h-[48px] max-h-[150px] placeholder-[#555] transition-all"
                        rows={1}
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading || !input.trim()}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 flex items-center justify-center text-black disabled:opacity-30 disabled:cursor-not-allowed hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none"
                    >
                        {isLoading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Play size={14} fill="currentColor" />
                        )}
                    </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[#444]">
                    <span>Shift+Enter: Yeni satır</span>
                    <span>{activeFile ? `📁 ${activeFile.split(/[/\\]/).pop()}` : 'Dosya seçilmedi'}</span>
                </div>
            </div>
        </div>
    );
};

// Message Bubble Component
const MessageBubble = ({ message, onCopy, copiedCode }) => {
    const isUser = message.role === 'user';

    return (
        <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isUser
                    ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                    : 'bg-gradient-to-br from-amber-500 to-orange-600'
                }`}>
                {isUser ? <User size={16} className="text-white" /> : <Bot size={16} className="text-white" />}
            </div>
            <div className={`flex-1 min-w-0 ${isUser ? 'flex justify-end' : ''}`}>
                {/* Tool Steps */}
                {message.steps && message.steps.length > 0 && (
                    <div className="mb-3 space-y-2">
                        {message.steps.map((step, idx) => (
                            <ToolStep key={idx} step={step} />
                        ))}
                    </div>
                )}

                <div className={`rounded-xl p-4 ${isUser
                        ? 'bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-blue-500/20 max-w-[85%]'
                        : message.isError
                            ? 'bg-red-500/10 border border-red-500/20'
                            : 'bg-[#1a1a1a]/80 backdrop-blur-sm border border-[#2a2a2a]'
                    }`}>
                    {isUser ? (
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    ) : (
                        <ChatContent content={message.content} onCopy={onCopy} copiedCode={copiedCode} />
                    )}
                </div>
            </div>
        </div>
    );
};

// Tool Step Component
const ToolStep = ({ step }) => {
    const Icon = step.icon || Sparkles;
    const statusColors = {
        running: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
        done: 'text-green-500 bg-green-500/10 border-green-500/20',
        error: 'text-red-500 bg-red-500/10 border-red-500/20'
    };

    const toolNames = {
        readFile: 'Dosya Okunuyor',
        writeFile: 'Dosya Yazılıyor',
        editFile: 'Dosya Düzenleniyor',
        deleteFile: 'Dosya Siliniyor',
        listFiles: 'Dosyalar Listeleniyor',
        searchInFiles: 'Arama Yapılıyor',
        runCommand: 'Komut Çalıştırılıyor'
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${statusColors[step.status]}`}
        >
            {step.status === 'running' ? (
                <Loader2 size={14} className="animate-spin" />
            ) : step.status === 'done' ? (
                <CheckCircle size={14} />
            ) : (
                <XCircle size={14} />
            )}
            <Icon size={14} />
            <span className="font-medium">{toolNames[step.name] || step.name}</span>
            {step.args?.path && (
                <span className="text-[#666] truncate max-w-[150px]">
                    {step.args.path.split(/[/\\]/).pop()}
                </span>
            )}
            {step.message && step.status !== 'running' && (
                <span className="text-[#666] truncate flex-1">{step.message}</span>
            )}
        </motion.div>
    );
};

// Chat Content with Markdown
const ChatContent = ({ content, onCopy, copiedCode }) => {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const codeString = String(children).replace(/\n$/, '');

                    if (!inline && match) {
                        return (
                            <div className="relative group my-3 rounded-lg overflow-hidden border border-[#2a2a2a]">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1a1a] border-b border-[#2a2a2a]">
                                    <span className="text-[10px] font-mono text-[#666] uppercase">{match[1]}</span>
                                    <button
                                        onClick={() => onCopy(codeString)}
                                        className="text-[10px] text-[#666] hover:text-white flex items-center gap-1 transition-colors"
                                    >
                                        {copiedCode === codeString ? (
                                            <><Check size={12} className="text-green-500" /> Kopyalandı</>
                                        ) : (
                                            <><Copy size={12} /> Kopyala</>
                                        )}
                                    </button>
                                </div>
                                <SyntaxHighlighter
                                    style={oneDark}
                                    language={match[1]}
                                    PreTag="div"
                                    customStyle={{
                                        margin: 0,
                                        padding: '12px',
                                        background: '#0d0d0d',
                                        fontSize: '12px'
                                    }}
                                    {...props}
                                >
                                    {codeString}
                                </SyntaxHighlighter>
                            </div>
                        );
                    }

                    return (
                        <code className="bg-[#2a2a2a] rounded px-1.5 py-0.5 font-mono text-amber-400 text-xs" {...props}>
                            {children}
                        </code>
                    );
                },
                p: ({ children }) => <p className="leading-relaxed mb-2 last:mb-0 text-sm">{children}</p>,
                ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1 text-sm">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1 text-sm">{children}</ol>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
                h1: ({ children }) => <h1 className="text-lg font-bold mb-2 text-white">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-bold mb-2 text-white">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-bold mb-1 text-white">{children}</h3>,
                strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                a: ({ href, children }) => <a href={href} className="text-amber-400 hover:underline">{children}</a>,
                blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-amber-500/50 pl-3 my-2 text-[#888] italic">
                        {children}
                    </blockquote>
                ),
                hr: () => <hr className="border-[#2a2a2a] my-3" />
            }}
        >
            {content}
        </ReactMarkdown>
    );
};

export default ChatInterface;
