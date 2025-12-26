import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import 'xterm/css/xterm.css';

const Terminal = () => {
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);
    const socketRef = useRef(null);

    useEffect(() => {
        // Initialize xterm
        const xterm = new XTerm({
            theme: {
                background: '#0a0a0a',
                foreground: '#e0e0e0',
                cursor: '#fbbf24',
                cursorAccent: '#0a0a0a',
                selectionBackground: 'rgba(251, 191, 36, 0.3)',
                black: '#1a1a1a',
                red: '#f87171',
                green: '#4ade80',
                yellow: '#fbbf24',
                blue: '#60a5fa',
                magenta: '#c084fc',
                cyan: '#22d3ee',
                white: '#e0e0e0',
                brightBlack: '#555555',
                brightRed: '#fca5a5',
                brightGreen: '#86efac',
                brightYellow: '#fde047',
                brightBlue: '#93c5fd',
                brightMagenta: '#d8b4fe',
                brightCyan: '#67e8f9',
                brightWhite: '#ffffff'
            },
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            fontSize: 13,
            lineHeight: 1.2,
            cursorBlink: true,
            cursorStyle: 'bar',
            scrollback: 5000,
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;

        // Mount terminal
        if (terminalRef.current) {
            xterm.open(terminalRef.current);

            // Delay fit to ensure container is sized
            setTimeout(() => {
                try {
                    fitAddon.fit();
                } catch (e) {
                    console.error('Fit error:', e);
                }
            }, 100);
        }

        // Connect to socket
        const socket = io('http://localhost:3001');
        socketRef.current = socket;

        socket.on('connect', () => {
            xterm.writeln('\x1b[1;32m✓ Terminal connected\x1b[0m');
            xterm.writeln('\x1b[90m' + '─'.repeat(50) + '\x1b[0m');
            xterm.writeln('');
        });

        socket.on('terminal:output', (data) => {
            xterm.write(data);
        });

        socket.on('disconnect', () => {
            xterm.writeln('\n\x1b[1;31m✗ Terminal disconnected\x1b[0m');
        });

        // Send input to backend
        xterm.onData((data) => {
            socket.emit('terminal:input', data);
        });

        // Handle resize
        const handleResize = () => {
            setTimeout(() => {
                try {
                    fitAddon.fit();
                    socket.emit('terminal:resize', {
                        cols: xterm.cols,
                        rows: xterm.rows
                    });
                } catch (e) {
                    console.error('Resize error:', e);
                }
            }, 50);
        };

        const resizeObserver = new ResizeObserver(handleResize);
        if (terminalRef.current) {
            resizeObserver.observe(terminalRef.current);
        }

        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => {
            socket.disconnect();
            xterm.dispose();
            resizeObserver.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    return (
        <div
            ref={terminalRef}
            className="h-full w-full overflow-hidden"
            style={{ padding: '8px' }}
        />
    );
};

export default Terminal;
