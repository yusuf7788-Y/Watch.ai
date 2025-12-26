import React, { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';

const CodeEditor = ({ code, language, path, onChange }) => {
    const editorRef = useRef(null);

    const handleEditorDidMount = (editor, monaco) => {
        editorRef.current = editor;

        // Define custom theme
        monaco.editor.defineTheme('watch-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
                { token: 'keyword', foreground: 'FF7B72' },
                { token: 'string', foreground: 'A5D6FF' },
                { token: 'number', foreground: '79C0FF' },
                { token: 'function', foreground: 'D2A8FF' },
                { token: 'variable', foreground: 'FFA657' },
                { token: 'type', foreground: '7EE787' },
            ],
            colors: {
                'editor.background': '#0d0d0d',
                'editor.foreground': '#e0e0e0',
                'editor.lineHighlightBackground': '#1a1a1a',
                'editor.selectionBackground': '#3a3a3a',
                'editor.inactiveSelectionBackground': '#2a2a2a',
                'editorLineNumber.foreground': '#444',
                'editorLineNumber.activeForeground': '#888',
                'editorCursor.foreground': '#fbbf24',
                'editor.selectionHighlightBackground': '#fbbf2420',
                'editorBracketMatch.background': '#fbbf2430',
                'editorBracketMatch.border': '#fbbf24',
                'editorIndentGuide.background': '#1a1a1a',
                'editorIndentGuide.activeBackground': '#333',
                'editorGutter.background': '#0d0d0d',
                'scrollbar.shadow': '#00000000',
                'scrollbarSlider.background': '#33333380',
                'scrollbarSlider.hoverBackground': '#44444480',
                'scrollbarSlider.activeBackground': '#55555580',
            }
        });

        monaco.editor.setTheme('watch-dark');

        // Add keyboard shortcuts
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            // Trigger save (you can emit an event here)
            console.log('Save triggered for:', path);
        });
    };

    const handleEditorChange = (value) => {
        onChange?.(value);
    };

    // Update editor when path changes
    useEffect(() => {
        if (editorRef.current) {
            // Editor will auto-update with new code prop
        }
    }, [path]);

    return (
        <div className="h-full w-full">
            <Editor
                height="100%"
                language={language}
                value={code}
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                options={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    fontLigatures: true,
                    lineHeight: 20,
                    padding: { top: 16 },
                    minimap: {
                        enabled: true,
                        scale: 1,
                        showSlider: 'mouseover'
                    },
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    renderLineHighlight: 'all',
                    renderWhitespace: 'selection',
                    bracketPairColorization: { enabled: true },
                    guides: {
                        bracketPairs: true,
                        indentation: true
                    },
                    wordWrap: 'off',
                    automaticLayout: true,
                    tabSize: 2,
                    insertSpaces: true,
                    formatOnPaste: true,
                    formatOnType: true,
                    suggestOnTriggerCharacters: true,
                    acceptSuggestionOnEnter: 'on',
                    quickSuggestions: {
                        other: true,
                        comments: false,
                        strings: true
                    },
                    parameterHints: { enabled: true },
                    folding: true,
                    foldingStrategy: 'indentation',
                    showFoldingControls: 'mouseover',
                    matchBrackets: 'always',
                    occurrencesHighlight: 'singleFile',
                    selectionHighlight: true,
                    links: true,
                    colorDecorators: true,
                    contextmenu: true,
                    mouseWheelZoom: true,
                    overviewRulerBorder: false,
                    hideCursorInOverviewRuler: true,
                    scrollbar: {
                        vertical: 'auto',
                        horizontal: 'auto',
                        verticalScrollbarSize: 10,
                        horizontalScrollbarSize: 10,
                        useShadows: false
                    }
                }}
                loading={
                    <div className="h-full w-full flex items-center justify-center bg-[#0d0d0d] text-[#444]">
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin"></div>
                            <span className="text-xs">Loading editor...</span>
                        </div>
                    </div>
                }
            />
        </div>
    );
};

export default CodeEditor;
