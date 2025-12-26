import React from 'react';
import { Minus, Square, X, Circle } from 'lucide-react';

const TitleBar = () => {
    // Check if running in Electron
    const isElectron = window.require !== undefined;

    const handleMinimize = () => {
        if (isElectron) {
            window.require('electron').ipcRenderer.send('window:minimize');
        }
    };

    const handleMaximize = () => {
        if (isElectron) {
            window.require('electron').ipcRenderer.send('window:maximize');
        }
    };

    const handleClose = () => {
        if (isElectron) {
            window.require('electron').ipcRenderer.send('window:close');
        }
    };

    return (
        <div
            className="h-8 bg-[#0a0a0a] flex items-center justify-between px-3 border-b border-[#1a1a1a] select-none"
            style={{ WebkitAppRegion: 'drag' }}
        >
            {/* Left - App Name */}
            <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-black">W</span>
                </div>
                <span className="text-[11px] font-semibold text-[#888]">
                    Watch<span className="text-amber-400">.ai</span>
                </span>
                <span className="text-[10px] text-[#444] ml-2">Agent IDE</span>
            </div>

            {/* Center - Optional breadcrumb */}
            <div className="flex-1 flex justify-center">
                {/* Could add file path breadcrumb here */}
            </div>

            {/* Right - Window Controls */}
            {isElectron ? (
                <div
                    className="flex items-center gap-1"
                    style={{ WebkitAppRegion: 'no-drag' }}
                >
                    <button
                        onClick={handleMinimize}
                        className="w-7 h-7 flex items-center justify-center text-[#666] hover:text-white hover:bg-[#333] rounded transition-colors"
                    >
                        <Minus size={14} />
                    </button>
                    <button
                        onClick={handleMaximize}
                        className="w-7 h-7 flex items-center justify-center text-[#666] hover:text-white hover:bg-[#333] rounded transition-colors"
                    >
                        <Square size={10} />
                    </button>
                    <button
                        onClick={handleClose}
                        className="w-7 h-7 flex items-center justify-center text-[#666] hover:text-white hover:bg-red-500 rounded transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            ) : (
                // Web mode - show status indicator
                <div className="flex items-center gap-2 text-[10px] text-[#444]">
                    <Circle size={6} className="fill-green-500 text-green-500" />
                    <span>Web Mode</span>
                </div>
            )}
        </div>
    );
};

export default TitleBar;
